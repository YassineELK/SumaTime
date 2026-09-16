import { getChatGPTUser } from '../../chatgpt-auth';
import { database } from '@/db/raw';
import { billedMinutes, brusselsToday, clockTime, csv, parseTime, validDate } from '@/lib/business';
import type { Member, Entry } from '@/lib/types';

export const dynamic = 'force-dynamic';
class HttpError extends Error { constructor(message: string, public status = 400) { super(message); } }
const response = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
function text(value: unknown, label: string, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new HttpError(`${label} est obligatoire (${max} caractères maximum).`);
  return value.trim();
}
async function identity() {
  const user = await getChatGPTUser();
  if (!user) throw new HttpError('Reconnectez-vous pour continuer.', 401);
  return user;
}
async function membership() {
  const user = await identity();
  const db = database();
  let member = await db.prepare('SELECT * FROM members WHERE user_id = ?').bind(user.userId).first<Member>();
  if (!member) {
    await db.prepare('UPDATE members SET user_id = ? WHERE email = ? AND user_id IS NULL AND active = 1').bind(user.userId, user.email.toLowerCase()).run();
    member = await db.prepare('SELECT * FROM members WHERE user_id = ?').bind(user.userId).first<Member>();
  }
  return { user, member: member?.active ? member : null };
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
  const result = await database().prepare(`SELECT e.*, c.name AS client, m.name AS member FROM entries e JOIN clients c ON c.id=e.client_id JOIN members m ON m.id=e.member_id WHERE ${f.clause} ORDER BY e.date DESC, e.start DESC LIMIT 5001`).bind(...f.values).all<Entry>();
  if (result.results.length > 5000) throw new HttpError('Plus de 5 000 prestations : réduisez la période ou ajoutez un filtre.');
  return { rows: result.results, ...f };
}
function fail(error: unknown) {
  if (error instanceof HttpError) return response({ error: error.message }, error.status);
  console.error('Time API failure', error instanceof Error ? error.message : 'unknown');
  return response({ error: 'Le service est momentanément indisponible. Vos champs sont conservés ; réessayez.' }, 503);
}

export async function GET(request: Request) {
  try {
    const { user, member } = await membership();
    const db = database();
    if (!member) {
      const count = await db.prepare('SELECT COUNT(*) AS n FROM members').first<{ n: number }>();
      return response({ me: null, setup: count?.n === 0, denied: count?.n !== 0, email: user.email, clients: [], members: [], entries: [] });
    }
    const url = new URL(request.url);
    const { rows, from, to } = await entriesFor(url, member);
    if (url.searchParams.has('export')) {
      const summary = url.searchParams.get('export') === 'summary';
      let table: unknown[][];
      if (summary) {
        const groups = new Map<string, { client: string; member: string; real: number; bill: number; count: number }>();
        for (const row of rows) {
          const key = row.client_id + ':' + row.member_id;
          const item = groups.get(key) || { client: row.client, member: row.member, real: 0, bill: 0, count: 0 };
          item.real += row.end - row.start; item.bill += billedMinutes(row.start, row.end); item.count++; groups.set(key, item);
        }
        table = [['Client', 'Partenaire', 'Prestations', 'Minutes réelles', 'Minutes facturables', 'Heures facturables'], ...[...groups.values()].map(g => [g.client, g.member, g.count, g.real, g.bill, (g.bill / 60).toFixed(2).replace('.', ',')])];
      } else table = [['ID', 'Client', 'Ticket', 'Partenaire', 'Date', 'Début', 'Fin', 'Description', 'Minutes réelles', 'Minutes facturables', 'Heures facturables', 'Statut'], ...rows.map(e => [e.id, e.client, e.ticket, e.member, e.date, clockTime(e.start), clockTime(e.end), e.description, e.end - e.start, billedMinutes(e.start, e.end), (billedMinutes(e.start, e.end) / 60).toFixed(2).replace('.', ','), e.billed ? 'Facturé' : 'À facturer'])];
      return new Response(csv(table), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sumatoni-${summary ? 'synthese' : 'detail'}-${from}-${to}.csv"`, 'Cache-Control': 'no-store' } });
    }
    const [clients, members] = await Promise.all([
      db.prepare('SELECT * FROM clients ORDER BY active DESC, name COLLATE NOCASE').all(),
      member.role === 'admin' ? db.prepare('SELECT id, user_id, email, name, role, active FROM members ORDER BY name COLLATE NOCASE').all() : Promise.resolve({ results: [member] }),
    ]);
    return response({ me: member, clients: clients.results, members: members.results, entries: rows });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 10000) throw new HttpError('Requête trop volumineuse.');
    if (request.headers.get('origin') !== new URL(request.url).origin) throw new HttpError('Origine de la requête non autorisée.', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError('Format de requête non valide.');
    let body;
    try { body = JSON.parse(raw); } catch { throw new HttpError('Requête non valide.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError('Requête non valide.');
    const { user, member } = await membership();
    const db = database();
    const now = new Date().toISOString();
    if (body.action === 'setup') {
      const name = text(body.name, 'Le nom', 100);
      const result = await db.prepare("INSERT INTO members (id,user_id,email,name,role,active,created_at) SELECT ?,?,?,?,'admin',1,? WHERE NOT EXISTS (SELECT 1 FROM members)").bind(crypto.randomUUID(), user.userId, user.email.toLowerCase(), name, now).run();
      if (!result.meta.changes) throw new HttpError('L’espace a déjà été activé.', 409);
      return response({ ok: true });
    }
    if (!member) throw new HttpError('Votre compte n’a pas accès à cet espace.', 403);
    if (body.action === 'client') {
      admin(member);
      const name = text(body.name, 'Le nom du client');
      const result = await db.prepare('INSERT INTO clients (id,name,active) SELECT ?,?,1 WHERE NOT EXISTS (SELECT 1 FROM clients WHERE lower(name)=lower(?))').bind(crypto.randomUUID(), name, name).run();
      if (!result.meta.changes) throw new HttpError('Ce client existe déjà.');
    } else if (body.action === 'clientActive') {
      admin(member);
      if (typeof body.active !== 'boolean') throw new HttpError('État non valide.');
      await db.prepare('UPDATE clients SET active=? WHERE id=?').bind(Number(body.active), text(body.id, 'Le client')).run();
    } else if (body.action === 'invite') {
      admin(member);
      const name = text(body.name, 'Le nom', 100), email = text(body.email, 'L’e-mail', 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError('L’adresse e-mail n’est pas valide.');
      const result = await db.prepare("INSERT INTO members (id,email,name,role,active,created_at) SELECT ?,?,?,'partner',1,? WHERE NOT EXISTS (SELECT 1 FROM members WHERE email=?)").bind(crypto.randomUUID(), email, name, now, email).run();
      if (!result.meta.changes) throw new HttpError('Cette adresse est déjà présente dans l’équipe.');
    } else if (body.action === 'memberActive') {
      admin(member);
      if (typeof body.active !== 'boolean') throw new HttpError('État non valide.');
      if (body.id === member.id) throw new HttpError('Vous ne pouvez pas désactiver votre propre accès.');
      await db.prepare("UPDATE members SET active=? WHERE id=? AND role='partner'").bind(Number(body.active), text(body.id, 'Le partenaire')).run();
    } else if (body.action === 'saveEntry') {
      const id = text(body.id, 'L’identifiant', 60);
      if (!/^[a-f0-9-]{36}$/.test(id)) throw new HttpError('Identifiant non valide.');
      const clientId = text(body.client_id, 'Le client'), ticket = text(body.ticket, 'Le ticket');
      const date = text(body.date, 'La date', 10);
      if (!validDate(date) || date > brusselsToday()) throw new HttpError('La date doit être valide et ne peut pas être future.');
      let start: number, end: number;
      try { start = parseTime(body.start); end = body.end === '00:00' ? 1440 : parseTime(body.end); } catch (e) { throw new HttpError((e as Error).message); }
      if (end <= start) throw new HttpError('L’heure de fin doit être après le début. Pour passer minuit, créez deux prestations.');
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      if (description.length > 2000) throw new HttpError('La description est limitée à 2 000 caractères.');
      const existing = await db.prepare('SELECT * FROM entries WHERE id=?').bind(id).first<Entry>();
      if (existing && existing.member_id !== member.id && member.role !== 'admin') throw new HttpError('Prestation inaccessible.', 403);
      if (existing && !body.version) {
        if (existing.member_id === member.id && existing.client_id === clientId && existing.ticket === ticket && existing.date === date && existing.start === start && existing.end === end && existing.description === description) return response({ ok: true });
        throw new HttpError('Cet enregistrement existe déjà. Actualisez la liste.', 409);
      }
      if (body.version && !existing) throw new HttpError('Cette prestation a été supprimée. Actualisez la liste.', 409);
      if (existing && (!Number.isInteger(body.version) || body.version < 1)) throw new HttpError('Version non valide.');
      if (existing?.billed) throw new HttpError('Cette prestation est facturée. Un administrateur doit d’abord la rouvrir.', 409);
      const client = await db.prepare('SELECT active FROM clients WHERE id=?').bind(clientId).first<{ active: number }>();
      if (!client || (!client.active && existing?.client_id !== clientId)) throw new HttpError('Choisissez un client actif.');
      const owner = existing?.member_id || member.id;
      const overlap = 'NOT EXISTS (SELECT 1 FROM entries WHERE member_id=? AND date=? AND start<? AND end>? AND id<>?)';
      const result = existing
        ? await db.prepare(`UPDATE entries SET client_id=?,ticket=?,date=?,start=?,end=?,description=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND billed=0 AND ${overlap}`).bind(clientId, ticket, date, start, end, description, now, id, body.version, owner, date, end, start, id).run()
        : await db.prepare(`INSERT INTO entries (id,member_id,client_id,ticket,date,start,end,description,billed,version,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,0,1,?,? WHERE ${overlap}`).bind(id, owner, clientId, ticket, date, start, end, description, now, now, owner, date, end, start, id).run();
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
