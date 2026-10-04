import { getMember, checkOrigin, AuthError } from '@/lib/auth';
import { sqlite, transaction } from '@/db/raw';
import { amountCents, serviceAmount } from '@/lib/pricing';
import { database } from '@/db/raw';
import { billedMinutes, brusselsToday, clockTime, csv, locationLabel, parseTime, validDate } from '@/lib/business';
import type { Member, Entry } from '@/lib/types';
import { partnerStatement } from '@/lib/partner-export';
import { validateGlpiTicketSelection } from '@/lib/glpi';
import { PENDING_TICKET_LABEL, validGlpiTicketId, type TicketSource } from '@/lib/ticket-selection';

export const dynamic = 'force-dynamic';
class HttpError extends Error { constructor(message: string, public status = 400) { super(message); } }
const response = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
function text(value: unknown, label: string, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new HttpError(`${label} est obligatoire (${max} caractères maximum).`);
  return value.trim();
}
async function membership() {
  const member = await getMember();
  if (!member) throw new HttpError('Reconnectez-vous pour continuer.', 401);
  if (member.must_change) throw new HttpError('Changez votre mot de passe provisoire pour continuer.', 403);
  return { member };
}
function admin(member: Member) { if (member.role !== 'admin') throw new HttpError('Cette action est réservée à l’administrateur.', 403); }
function filters(url: URL, member: Member) {
  const from = url.searchParams.get('from') || brusselsToday().slice(0, 7) + '-01';
  const to = url.searchParams.get('to') || brusselsToday();
  if (!validDate(from) || !validDate(to) || from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 365) throw new HttpError('Choisissez une période valide de 366 jours maximum.');
  const conditions = ['e.date >= ?', 'e.date <= ?'];
  const values: (string | number)[] = [from, to];
  if (member.role !== 'admin') { conditions.push('e.member_id = ?'); values.push(member.id); }
  else if (url.searchParams.get('member')) { conditions.push('e.member_id = ?'); values.push(url.searchParams.get('member')!); }
  if (url.searchParams.get('client')) { conditions.push('e.client_id = ?'); values.push(url.searchParams.get('client')!); }
  const status = url.searchParams.get('status');
  if (status === 'open' || status === 'billed') { conditions.push('e.billed = ?'); values.push(status === 'billed' ? 1 : 0); }
  const q = url.searchParams.get('q')?.trim();
  if (q) { if (q.length > 120) throw new HttpError('Recherche trop longue.'); conditions.push('(instr(lower(e.ticket), lower(?)) > 0 OR instr(lower(e.description), lower(?)) > 0)'); values.push(q, q); }
  return { clause: conditions.join(' AND '), values, from, to };
}
async function entriesFor(url: URL, member: Member) {
  const f = filters(url, member);
  const result = await database().prepare(`SELECT e.*, c.name AS client, m.name AS member,
    CASE WHEN e.on_site=1 AND e.id=COALESCE((SELECT a.id FROM entries a WHERE a.id=td.anchor_entry_id AND a.on_site=1 AND a.member_id=e.member_id AND a.client_id=e.client_id AND a.date=e.date), (SELECT t.id FROM entries t WHERE t.member_id=e.member_id AND t.client_id=e.client_id AND t.date=e.date AND t.on_site=1 ORDER BY t.created_at,t.id LIMIT 1)) THEN 1 ELSE 0 END AS travel_counted,
    CASE WHEN e.on_site=1 AND e.id=COALESCE((SELECT a.id FROM entries a WHERE a.id=td.anchor_entry_id AND a.on_site=1 AND a.member_id=e.member_id AND a.client_id=e.client_id AND a.date=e.date), (SELECT t.id FROM entries t WHERE t.member_id=e.member_id AND t.client_id=e.client_id AND t.date=e.date AND t.on_site=1 ORDER BY t.created_at,t.id LIMIT 1)) THEN td.fee_cents ELSE 0 END AS travel_cents
    FROM entries e JOIN clients c ON c.id=e.client_id JOIN members m ON m.id=e.member_id
    LEFT JOIN travel_days td ON td.member_id=e.member_id AND td.client_id=e.client_id AND td.date=e.date WHERE ${f.clause} ORDER BY e.date DESC, e.start DESC LIMIT 5001`).bind(...f.values).all<Entry>();
  if (result.results.length > 5000) throw new HttpError('Plus de 5 000 prestations : réduisez la période ou ajoutez un filtre.');
  return { rows: result.results, ...f };
}
function fail(error: unknown) {
  if (error instanceof HttpError || error instanceof AuthError) return response({ error: error.message, ...('code' in error && error.code ? { code: error.code } : {}) }, error.status);
  console.error('Time API failure', error instanceof Error ? error.message : 'unknown');
  return response({ error: 'Le service est momentanément indisponible. Vos champs sont conservés ; réessayez.' }, 503);
}

export async function GET(request: Request) {
  try {
    const { member } = await membership();
    const db = database();
    const url = new URL(request.url);
    const { rows, from, to } = await entriesFor(url, member);
    if (url.searchParams.has('export')) {
      const kind = url.searchParams.get('export');
      if (!['detail', 'summary', 'client', 'partner'].includes(kind || '')) throw new HttpError('Format d’export non reconnu.');
      const summary = kind === 'summary';
      const clientExport = kind === 'client';
      let table: unknown[][];
      if (kind === 'partner') {
        const partnerId = url.searchParams.get('member') || (member.role === 'admin' ? '' : member.id);
        if (member.role !== 'admin' && partnerId !== member.id) throw new HttpError('Vous ne pouvez exporter que votre propre relevé.', 403);
        if (!partnerId) throw new HttpError('Sélectionnez un partenaire et cliquez sur Appliquer avant de télécharger son relevé.');
        const partner = await db.prepare('SELECT name FROM members WHERE id=?').bind(partnerId).first<{ name: string }>();
        if (!partner) throw new HttpError('Partenaire introuvable.', 404);
        if (url.searchParams.get('status') || url.searchParams.get('q')?.trim()) throw new HttpError('Pour contrôler la facture du partenaire, choisissez Tous les statuts et videz la recherche, puis cliquez sur Appliquer. Cela permet de compter tous les déplacements de la période.');
        if (!rows.length) throw new HttpError('Aucune prestation pour ce partenaire sur la période sélectionnée.');
        table = partnerStatement(rows, partner.name);
      } else if (clientExport) {
        const clientId = url.searchParams.get('client');
        if (!clientId || !await db.prepare('SELECT id FROM clients WHERE id=?').bind(clientId).first()) throw new HttpError('Sélectionnez un client et appliquez les filtres avant de télécharger son relevé.');
        if (rows.some(row => row.on_site === null)) throw new HttpError('Certaines prestations anciennes ont un mode à confirmer. Indiquez À distance ou Sur site avant l’export client.');
        table = [['Date', 'Début', 'Fin', 'Mode de prestation'], ...[...rows].sort((a,b) => a.date.localeCompare(b.date) || a.start-b.start || a.end-b.end).map(e => [e.date, clockTime(e.start), clockTime(e.end), locationLabel(e.on_site)])];
      } else if (summary) {
        const groups = new Map<string, { client: string; member: string; mode: string; real: number; bill: number; count: number; amount: number; missingRate: boolean; travel: number; missingFee: boolean; trips: number }>();
        for (const row of rows) {
          const key = row.client_id + ':' + row.member_id + ':' + String(row.on_site);
          const item = groups.get(key) || { client: row.client, member: row.member, mode: locationLabel(row.on_site), real: 0, bill: 0, count: 0, amount: 0, missingRate: false, travel: 0, missingFee: false, trips: 0 };
          item.real += row.end - row.start; item.bill += billedMinutes(row.start, row.end); item.count++;
          const amount = serviceAmount(row.start, row.end, row.hourly_rate_cents);
          item.amount += amount || 0; item.missingRate ||= amount === null;
          item.travel += row.travel_cents || 0; item.missingFee ||= row.travel_counted === 1 && row.travel_cents === null; item.trips += row.travel_counted;
          groups.set(key, item);
        }
        table = [['Client', 'Partenaire', 'Mode de prestation', 'Prestations', 'Minutes réelles', 'Minutes facturables', 'Heures facturables', 'Montant prestations EUR', 'Déplacements', 'Forfait prestataire EUR'], ...[...groups.values()].map(g => [g.client, g.member, g.mode, g.count, g.real, g.bill, (g.bill / 60).toFixed(2).replace('.', ','), g.missingRate ? '' : (g.amount / 100).toFixed(2).replace('.', ','), g.trips, g.missingFee ? '' : (g.travel / 100).toFixed(2).replace('.', ',')])];
      } else table = [['ID', 'Client', 'Ticket', 'Source ticket', 'Partenaire', 'Date', 'Début', 'Fin', 'Description', 'Minutes réelles', 'Minutes facturables', 'Heures facturables', 'Statut', 'Mode de prestation', 'Tarif horaire EUR', 'Montant prestations EUR', 'Déplacement compté', 'Forfait prestataire EUR'], ...rows.map(e => [e.id, e.client, e.ticket, e.ticket_source === 'glpi' ? 'GLPI vérifié' : e.ticket_source === 'pending' ? PENDING_TICKET_LABEL : 'Historique', e.member, e.date, clockTime(e.start), clockTime(e.end), e.description, e.end - e.start, billedMinutes(e.start, e.end), (billedMinutes(e.start, e.end) / 60).toFixed(2).replace('.', ','), e.billed ? 'Facturé' : 'À facturer', locationLabel(e.on_site), e.hourly_rate_cents === null ? '' : (e.hourly_rate_cents / 100).toFixed(2).replace('.', ','), serviceAmount(e.start, e.end, e.hourly_rate_cents) === null ? '' : (serviceAmount(e.start, e.end, e.hourly_rate_cents)! / 100).toFixed(2).replace('.', ','), e.travel_counted ? 'Oui' : 'Non', e.travel_cents === null ? '' : (e.travel_cents / 100).toFixed(2).replace('.', ',')])];
      return new Response(csv(table), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sumatoni-${kind === 'partner' ? 'releve-partenaire' : clientExport ? 'releve-client' : summary ? 'synthese' : 'detail'}-${from}-${to}.csv"`, 'Cache-Control': 'no-store' } });
    }
    const [clients, members] = await Promise.all([
      db.prepare(member.role === 'admin' ? 'SELECT * FROM clients ORDER BY active DESC, name COLLATE NOCASE' : 'SELECT id,name,active,color,glpi_entity_id,NULL AS hourly_rate_cents,NULL AS onsite_hourly_rate_cents FROM clients ORDER BY active DESC,name COLLATE NOCASE').all(),
      member.role === 'admin' ? db.prepare('SELECT m.id,m.user_id,m.email,m.name,m.role,m.active,m.travel_fee_cents,a.provider,a.login FROM members m LEFT JOIN accounts a ON a.member_id=m.id ORDER BY m.name COLLATE NOCASE').all() : Promise.resolve({ results: [member] }),
    ]);
    return response({ me: member, clients: clients.results, members: members.results, entries: rows });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 10000) throw new HttpError('Requête trop volumineuse.');
    checkOrigin(request);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError('Format de requête non valide.');
    let body;
    try { body = JSON.parse(raw); } catch { throw new HttpError('Requête non valide.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError('Requête non valide.');
    const { member } = await membership();
    const db = database();
    const now = new Date().toISOString();
    if (body.action === 'client') {
      admin(member);
      const name = text(body.name, 'Le nom du client');
      const result = await db.prepare('INSERT INTO clients (id,name,active) SELECT ?,?,1 WHERE NOT EXISTS (SELECT 1 FROM clients WHERE lower(name)=lower(?))').bind(crypto.randomUUID(), name, name).run();
      if (!result.meta.changes) throw new HttpError('Ce client existe déjà.');
    } else if (body.action === 'clientGlpi') {
      admin(member);
      if (body.entity !== null && (!Number.isSafeInteger(body.entity) || body.entity < 0)) throw new HttpError('L’entité GLPI doit être un entier positif ou zéro.');
      const id = text(body.id, 'Le client');
      if (body.entity !== null && await db.prepare('SELECT id FROM clients WHERE glpi_entity_id=? AND id<>?').bind(body.entity, id).first()) throw new HttpError('Cette entité GLPI est déjà associée à un autre client.');
      const result = await db.prepare('UPDATE clients SET glpi_entity_id=? WHERE id=?').bind(body.entity, id).run();
      if (!result.meta.changes) throw new HttpError('Client introuvable.', 404);
    } else if (body.action === 'clientColor') {
      admin(member);
      if (body.color !== null && (typeof body.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(body.color))) throw new HttpError('Choisissez une couleur valide au format #RRGGBB.');
      const result = await db.prepare('UPDATE clients SET color=? WHERE id=?').bind(body.color === null ? null : body.color.toUpperCase(), text(body.id, 'Le client')).run();
      if (!result.meta.changes) throw new HttpError('Client introuvable.', 404);
    } else if (body.action === 'clientRates' || body.action === 'memberFee') {
      admin(member);
      let standard: number | null, onsite: number | null, fee: number | null;
      try { standard = amountCents(body.hourly_rate); onsite = amountCents(body.onsite_hourly_rate); fee = amountCents(body.travel_fee); } catch (e) { throw new HttpError((e as Error).message); }
      if (body.action === 'clientRates') await db.prepare('UPDATE clients SET hourly_rate_cents=?,onsite_hourly_rate_cents=? WHERE id=?').bind(standard, onsite, text(body.id, 'Le client')).run();
      else await db.prepare('UPDATE members SET travel_fee_cents=? WHERE id=?').bind(fee, text(body.id, 'Le prestataire')).run();
    } else if (body.action === 'clientActive') {
      admin(member);
      if (typeof body.active !== 'boolean') throw new HttpError('État non valide.');
      await db.prepare('UPDATE clients SET active=? WHERE id=?').bind(Number(body.active), text(body.id, 'Le client')).run();
    } else if (body.action === 'memberActive') {
      admin(member);
      if (typeof body.active !== 'boolean') throw new HttpError('État non valide.');
      if (body.id === member.id) throw new HttpError('Vous ne pouvez pas désactiver votre propre accès.');
      await db.prepare("UPDATE members SET active=? WHERE id=? AND role='partner'").bind(Number(body.active), text(body.id, 'Le partenaire')).run();
      if (!body.active) sqlite().prepare('DELETE FROM sessions WHERE member_id=?').run(body.id);
    } else if (body.action === 'restoreEntryRange') {
      const id = text(body.id, 'L’identifiant', 60);
      if (!/^[a-f0-9-]{36}$/.test(id)) throw new HttpError('Identifiant non valide.');
      if (!Number.isInteger(body.version) || body.version < 1) throw new HttpError('Version non valide.');
      const date = text(body.date, 'La date', 10);
      if (!validDate(date) || date > brusselsToday()) throw new HttpError('La date doit être valide et ne peut pas être future.');
      let start: number, end: number;
      try { start = parseTime(body.start); end = body.end === '00:00' ? 1440 : parseTime(body.end); } catch (e) { throw new HttpError((e as Error).message); }
      if (end <= start) throw new HttpError('L’heure de fin doit être après le début.');
      const existing = await db.prepare('SELECT * FROM entries WHERE id=?').bind(id).first<Entry>();
      if (!existing || (existing.member_id !== member.id && member.role !== 'admin')) throw new HttpError('Prestation inaccessible.', 403);
      if (existing.billed) throw new HttpError('Cette prestation est facturée. Un administrateur doit d’abord la rouvrir.', 409);
      const overlap = 'NOT EXISTS (SELECT 1 FROM entries WHERE member_id=? AND date=? AND start<? AND end>? AND id<>?)';
      const result = transaction(tx => tx.prepare(`UPDATE entries SET date=?,start=?,end=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND billed=0 AND ${overlap}`).run(date, start, end, now, id, body.version, existing.member_id, date, end, start, id));
      if (!result.changes) throw new HttpError('Ce créneau chevauche une prestation existante, ou la ligne a été modifiée. Actualisez la liste avant de réessayer.', 409);
      return response({ ok: true, version: body.version + 1 });
    } else if (body.action === 'saveEntry') {
      const id = text(body.id, 'L’identifiant', 60);
      if (!/^[a-f0-9-]{36}$/.test(id)) throw new HttpError('Identifiant non valide.');
      const clientId = text(body.client_id, 'Le client');
      const submittedTicket = typeof body.ticket === 'string' ? body.ticket.trim() : '';
      const date = text(body.date, 'La date', 10);
      if (!validDate(date) || date > brusselsToday()) throw new HttpError('La date doit être valide et ne peut pas être future.');
      let start: number, end: number;
      try { start = parseTime(body.start); end = body.end === '00:00' ? 1440 : parseTime(body.end); } catch (e) { throw new HttpError((e as Error).message); }
      if (end <= start) throw new HttpError('L’heure de fin doit être après le début. Pour passer minuit, créez deux prestations.');
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      if (description.length > 2000) throw new HttpError('La description est limitée à 2 000 caractères.');
      const existing = await db.prepare('SELECT * FROM entries WHERE id=?').bind(id).first<Entry>();
      if (body.on_site !== undefined && body.on_site !== null && typeof body.on_site !== 'boolean') throw new HttpError('Le mode Sur site doit être une case cochée ou décochée.');
      if (!existing && body.on_site === null) throw new HttpError('Indiquez le mode de prestation.');
      const onSite = body.on_site === undefined ? (existing ? existing.on_site : 0) : body.on_site === null ? null : Number(body.on_site);
      if (existing && existing.member_id !== member.id && member.role !== 'admin') throw new HttpError('Prestation inaccessible.', 403);
      const claimedSource = body.ticket_source as TicketSource | undefined;
      const claimedGlpiId = body.glpi_ticket_id;
      const claimedTicket = claimedSource === 'pending' && claimedGlpiId == null ? PENDING_TICKET_LABEL
        : claimedSource === 'glpi' && validGlpiTicketId(claimedGlpiId) ? `GLPI-${claimedGlpiId}`
          : claimedSource === 'legacy' && claimedGlpiId == null ? submittedTicket : '';
      if (existing && !body.version) {
        if (existing.member_id === member.id && existing.client_id === clientId && existing.ticket === claimedTicket && existing.ticket_source === claimedSource && existing.glpi_ticket_id === (claimedGlpiId ?? null) && existing.date === date && existing.start === start && existing.end === end && existing.description === description && existing.on_site === onSite) return response({ ok: true });
        throw new HttpError('Cet enregistrement existe déjà. Actualisez la liste.', 409);
      }
      if (body.version && !existing) throw new HttpError('Cette prestation a été supprimée. Actualisez la liste.', 409);
      if (existing && (!Number.isInteger(body.version) || body.version < 1)) throw new HttpError('Version non valide.');
      if (existing?.billed) throw new HttpError('Cette prestation est facturée. Un administrateur doit d’abord la rouvrir.', 409);
      const unchangedIdentity = !!existing && existing.client_id === clientId && existing.ticket === claimedTicket && existing.ticket_source === claimedSource && existing.glpi_ticket_id === (claimedGlpiId ?? null);
      let ticket: string, ticketSource: TicketSource, glpiTicketId: number | null, verifiedEntity: number | null = null;
      if (unchangedIdentity) {
        ticket = existing.ticket; ticketSource = existing.ticket_source; glpiTicketId = existing.glpi_ticket_id;
      } else if (claimedSource === 'pending' && claimedGlpiId == null) {
        ticket = PENDING_TICKET_LABEL; ticketSource = 'pending'; glpiTicketId = null;
      } else if (claimedSource === 'glpi' && validGlpiTicketId(claimedGlpiId)) {
        const verified = await validateGlpiTicketSelection(member.id, claimedGlpiId, clientId);
        ticket = verified.ticket; ticketSource = verified.ticket_source; glpiTicketId = verified.glpi_ticket_id;
        verifiedEntity = verified.entity;
      } else {
        throw new AuthError('Sélectionnez un ticket GLPI proposé ou choisissez explicitement « À compléter ».', 400, { code: 'TICKET_SELECTION_REQUIRED', retryable: false, preserveOperation: true });
      }
      const client = await db.prepare('SELECT active,glpi_entity_id,hourly_rate_cents,onsite_hourly_rate_cents FROM clients WHERE id=?').bind(clientId).first<{ active: number; glpi_entity_id: number | null; hourly_rate_cents: number | null; onsite_hourly_rate_cents: number | null }>();
      if (verifiedEntity !== null && (!client || !client.active || client.glpi_entity_id !== verifiedEntity)) throw new AuthError('Le ticket GLPI ne correspond plus au client actif sélectionné.', 409, { code: 'TICKET_CLIENT_MISMATCH', retryable: false, preserveOperation: true });
      if (!client || (!client.active && existing?.client_id !== clientId)) throw new HttpError('Choisissez un client actif.');
      const owner = existing?.member_id || member.id;
      const overlap = 'NOT EXISTS (SELECT 1 FROM entries WHERE member_id=? AND date=? AND start<? AND end>? AND id<>?)';
      const hourlyRate = existing && existing.client_id === clientId && existing.on_site === onSite ? existing.hourly_rate_cents : onSite === null ? null : onSite ? client.onsite_hourly_rate_cents ?? client.hourly_rate_cents : client.hourly_rate_cents;
      const result = transaction(tx => {
        if (verifiedEntity !== null && !tx.prepare('SELECT id FROM clients WHERE id=? AND active=1 AND glpi_entity_id=?').get(clientId, verifiedEntity)) throw new AuthError('Le ticket GLPI ne correspond plus au client actif sélectionné.', 409, { code: 'TICKET_CLIENT_MISMATCH', retryable: false, preserveOperation: true });
        if (!existing) {
          const live = tx.prepare('SELECT * FROM entries WHERE id=?').get(id) as Entry | undefined;
          if (live) {
            if (live.member_id === owner && live.client_id === clientId && live.ticket === ticket && live.ticket_source === ticketSource && live.glpi_ticket_id === glpiTicketId && live.date === date && live.start === start && live.end === end && live.description === description && live.on_site === onSite) return { meta: { changes: 1 } };
            throw new HttpError('Cet enregistrement existe déjà. Actualisez la liste.', 409);
          }
        }
        const clientGuard = verifiedEntity === null ? '1=1' : 'EXISTS (SELECT 1 FROM clients WHERE id=? AND active=1 AND glpi_entity_id=?)';
        const guardValues = verifiedEntity === null ? [] : [clientId, verifiedEntity];
        const changed = existing
          ? tx.prepare(`UPDATE entries SET client_id=?,ticket=?,ticket_source=?,glpi_ticket_id=?,date=?,start=?,end=?,description=?,on_site=?,hourly_rate_cents=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND billed=0 AND ${clientGuard} AND ${overlap}`).run(clientId, ticket, ticketSource, glpiTicketId, date, start, end, description, onSite, hourlyRate, now, id, body.version, ...guardValues, owner, date, end, start, id)
          : tx.prepare(`INSERT INTO entries (id,member_id,client_id,ticket,ticket_source,glpi_ticket_id,date,start,end,description,on_site,hourly_rate_cents,billed,version,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,0,1,?,? WHERE ${clientGuard} AND ${overlap}`).run(id, owner, clientId, ticket, ticketSource, glpiTicketId, date, start, end, description, onSite, hourlyRate, now, now, ...guardValues, owner, date, end, start, id);
        if (changed.changes && onSite === 1) tx.prepare('INSERT OR IGNORE INTO travel_days (member_id,client_id,date,fee_cents,anchor_entry_id) SELECT ?,?,?,travel_fee_cents,? FROM members WHERE id=?').run(owner, clientId, date, id, owner);
        return { meta: { changes: Number(changed.changes) } };
      });
      if (!result.meta.changes) throw new HttpError('Ce créneau chevauche une prestation existante, ou la ligne a été modifiée. Actualisez la liste avant de réessayer.', 409);
    } else if (body.action === 'deleteEntry' || body.action === 'billed') {
      const id = text(body.id, 'La prestation');
      const e = await db.prepare('SELECT * FROM entries WHERE id=?').bind(id).first<Entry>();
      if (!e || (e.member_id !== member.id && member.role !== 'admin')) throw new HttpError('Prestation inaccessible.', 403);
      if (!Number.isInteger(body.version)) throw new HttpError('Version non valide.');
      let result;
      if (body.action === 'billed') {
        admin(member);
        if (typeof body.billed !== 'boolean') throw new HttpError('État non valide.');
        result = await db.prepare('UPDATE entries SET billed=?,version=version+1,updated_at=? WHERE id=? AND version=?').bind(Number(body.billed), now, id, body.version).run();
      } else {
        if (e.billed) throw new HttpError('Une prestation facturée ne peut pas être supprimée.', 409);
        result = await db.prepare('DELETE FROM entries WHERE id=? AND version=? AND billed=0').bind(id, body.version).run();
      }
      if (!result.meta.changes) throw new HttpError('Cette prestation a changé. Actualisez la liste.', 409);
    } else throw new HttpError('Action non reconnue.');
    return response({ ok: true });
  } catch (error) { return fail(error); }
}
