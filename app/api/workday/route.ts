import { getMember, checkOrigin, AuthError } from '@/lib/auth';
import { sqlite, transaction } from '@/db/raw';
import { brusselsToday, parseTime } from '@/lib/business';
import { timerSegments } from '@/lib/workday';
import type { WorkTimer } from '@/lib/types';
import { validateGlpiTicketSelection } from '@/lib/glpi';
import { PENDING_TICKET_LABEL, validGlpiTicketId } from '@/lib/ticket-selection';
export const dynamic = 'force-dynamic';
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
async function who() { const me = await getMember(); if (!me) throw new AuthError('Reconnectez-vous pour continuer.', 401); if (me.must_change) throw new AuthError('Changez votre mot de passe provisoire.', 403); return me; }
function fail(error: unknown) { return json({ error: error instanceof AuthError ? error.message : 'Action impossible. Votre chronomètre est conservé ; actualisez et réessayez.', ...(error instanceof AuthError && error.code ? { code: error.code } : {}) }, error instanceof AuthError ? error.status : 503); }
function current(member: string) { return sqlite().prepare('SELECT t.*,c.name AS client,c.color FROM work_timers t JOIN clients c ON c.id=t.client_id WHERE member_id=?').get(member) as WorkTimer | undefined; }
function preview(timer: WorkTimer | undefined) {
  if (!timer?.stopped_at) return { timer: timer || null, segments: [], warning: '' };
  try { return { timer, segments: timerSegments(timer.started_at, timer.stopped_at), warning: '' }; }
  catch (e) { return { timer, segments: [], warning: (e as Error).message }; }
}
export async function GET() {
  try {
    const me = await who(), today = brusselsToday();
    const date = new Date(today + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const weekStart = date.toISOString().slice(0, 10);
    const columns = 'e.*,c.name AS client,c.color,m.name AS member';
    const joins = 'FROM entries e JOIN clients c ON c.id=e.client_id JOIN members m ON m.id=e.member_id';
    const week = sqlite().prepare(`SELECT ${columns} ${joins} WHERE e.member_id=? AND e.date>=? AND e.date<=? ORDER BY e.date,e.start`).all(me.id, weekStart, today);
    const recent = sqlite().prepare(`SELECT ${columns} ${joins} WHERE e.member_id=? ORDER BY e.date DESC,e.start DESC LIMIT 30`).all(me.id);
    if (me.role !== 'admin') for (const row of [...week, ...recent]) row.hourly_rate_cents = null;
    return json({ today, weekStart, week, recent, ...preview(current(me.id)) });
  } catch (e) { return fail(e); }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request); const me = await who();
    const raw = await request.text(); if (raw.length > 6000) throw new AuthError('Formulaire trop long.');
    let body; try { body = JSON.parse(raw); } catch { throw new AuthError('Formulaire invalide.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AuthError('Formulaire invalide.');
    const now = Date.now();
    if (body.action === 'start') {
      if (typeof body.id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.id)) throw new AuthError('Identifiant invalide.');
      if (typeof body.client_id !== 'string' || typeof body.description !== 'string' || body.description.length > 2000 || typeof body.on_site !== 'boolean') throw new AuthError('Choisissez un client, un ticket et le mode de prestation.');
      const existing = current(me.id);
      const claimedTicket = body.ticket_source === 'pending' && body.glpi_ticket_id == null ? PENDING_TICKET_LABEL
        : body.ticket_source === 'glpi' && validGlpiTicketId(body.glpi_ticket_id) ? `GLPI-${body.glpi_ticket_id}` : '';
      if (existing) {
        if (existing.id === body.id && existing.client_id === body.client_id && existing.ticket === claimedTicket && existing.ticket_source === body.ticket_source && existing.glpi_ticket_id === (body.glpi_ticket_id ?? null) && existing.description === body.description && existing.on_site === Number(body.on_site)) return json(preview(existing));
        throw new AuthError('Un chronomètre est déjà présent. Terminez-le avant d’en commencer un autre.', 409);
      }
      if (sqlite().prepare('SELECT id FROM timer_receipts WHERE id=?').get(body.id)) throw new AuthError('Ce chronomètre a déjà été enregistré.', 409);
      let ticket: string, ticketSource: 'glpi' | 'pending', glpiTicketId: number | null, verifiedEntity: number | null = null;
      if (body.ticket_source === 'pending' && body.glpi_ticket_id == null) {
        ticket = PENDING_TICKET_LABEL; ticketSource = 'pending'; glpiTicketId = null;
      } else if (body.ticket_source === 'glpi' && validGlpiTicketId(body.glpi_ticket_id)) {
        const verified = await validateGlpiTicketSelection(me.id, body.glpi_ticket_id, body.client_id);
        ticket = verified.ticket; ticketSource = 'glpi'; glpiTicketId = verified.glpi_ticket_id;
        verifiedEntity = verified.entity;
      } else throw new AuthError('Sélectionnez un ticket GLPI proposé ou choisissez explicitement « À compléter ».', 400, { code: 'TICKET_SELECTION_REQUIRED', retryable: false, preserveOperation: true });
      transaction(db => {
        const live = current(me.id);
        if (live) { if (live.id === body.id && live.client_id === body.client_id && live.ticket === ticket && live.ticket_source === ticketSource && live.glpi_ticket_id === glpiTicketId && live.description === body.description && live.on_site === Number(body.on_site)) return; throw new AuthError('Un chronomètre est déjà présent. Terminez-le avant d’en commencer un autre.', 409); }
        if (db.prepare('SELECT id FROM timer_receipts WHERE id=?').get(body.id)) throw new AuthError('Ce chronomètre a déjà été enregistré.', 409);
        if (verifiedEntity !== null && !db.prepare('SELECT id FROM clients WHERE id=? AND active=1 AND glpi_entity_id=?').get(body.client_id, verifiedEntity)) throw new AuthError('Le ticket GLPI ne correspond plus au client actif sélectionné.', 409, { code: 'TICKET_CLIENT_MISMATCH', retryable: false, preserveOperation: true });
        if (verifiedEntity === null && !db.prepare('SELECT id FROM clients WHERE id=? AND active=1').get(body.client_id)) throw new AuthError('Choisissez un client actif.');
        const inserted = verifiedEntity === null
          ? db.prepare('INSERT INTO work_timers (member_id,id,client_id,ticket,ticket_source,glpi_ticket_id,description,on_site,started_at) VALUES (?,?,?,?,?,?,?,?,?)').run(me.id, body.id, body.client_id, ticket, ticketSource, glpiTicketId, body.description, Number(body.on_site), now)
          : db.prepare('INSERT INTO work_timers (member_id,id,client_id,ticket,ticket_source,glpi_ticket_id,description,on_site,started_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM clients WHERE id=? AND active=1 AND glpi_entity_id=?)').run(me.id, body.id, body.client_id, ticket, ticketSource, glpiTicketId, body.description, Number(body.on_site), now, body.client_id, verifiedEntity);
        if (!inserted.changes) throw new AuthError('Le ticket GLPI ne correspond plus au client actif sélectionné.', 409, { code: 'TICKET_CLIENT_MISMATCH', retryable: false, preserveOperation: true });
      });
    } else {
      if (typeof body.id !== 'string') throw new AuthError('Chronomètre invalide.');
      const receipt = sqlite().prepare('SELECT entry_ids FROM timer_receipts WHERE id=? AND member_id=?').get(body.id, me.id) as { entry_ids: string } | undefined;
      if (body.action === 'save' && receipt) return json({ saved: true, entry_ids: JSON.parse(receipt.entry_ids) });
      const timer = current(me.id);
      if (!timer || timer.id !== body.id) throw new AuthError('Ce chronomètre a changé. Actualisez votre journée.', 409);
      if (body.action === 'stop') {
        sqlite().prepare('UPDATE work_timers SET stopped_at=?,version=version+1 WHERE member_id=? AND id=? AND stopped_at IS NULL').run(now, me.id, body.id);
      } else if (body.action === 'discard') {
        if (!Number.isInteger(body.version)) throw new AuthError('Version invalide.');
        const result = sqlite().prepare('DELETE FROM work_timers WHERE member_id=? AND id=? AND version=?').run(me.id, body.id, body.version);
        if (!result.changes) throw new AuthError('Ce chronomètre a changé. Actualisez avant de le supprimer.', 409);
      } else if (body.action === 'save') {
        if (!timer.stopped_at) throw new AuthError('Arrêtez le chronomètre avant de vérifier les horaires.');
        let segments; try { segments = timerSegments(timer.started_at, timer.stopped_at); } catch (e) { throw new AuthError((e as Error).message); }
        if (body.segments !== undefined) {
          if (!Array.isArray(body.segments) || body.segments.length !== segments.length) throw new AuthError('Les journées du chronomètre doivent être conservées.');
          segments = segments.map((original, index) => {
            const value = body.segments[index];
            if (!value || value.date !== original.date || value.date > brusselsToday()) throw new AuthError('Journée invalide.');
            let start: number, end: number;
            try { start = parseTime(value.start); end = value.end === '00:00' ? 1440 : parseTime(value.end); } catch { throw new AuthError('Saisissez les heures au format HH:MM.'); }
            if (end <= start) throw new AuthError('La fin doit être après le début.');
            return { date: original.date, start, end };
          });
        }
        if (typeof body.description !== 'string' || body.description.length > 2000) throw new AuthError('La description doit faire au maximum 2 000 caractères.');
        const ids = transaction(db => {
          const live = current(me.id);
          if (!live || live.id !== timer.id || live.version !== body.version) throw new AuthError('Ce chronomètre a changé. Actualisez avant d’enregistrer.', 409);
          const client = db.prepare('SELECT * FROM clients WHERE id=?').get(timer.client_id) as { hourly_rate_cents: number | null; onsite_hourly_rate_cents: number | null };
          const rate = timer.on_site ? client.onsite_hourly_rate_cents ?? client.hourly_rate_cents : client.hourly_rate_cents;
          const created = new Date().toISOString(), ids: string[] = [];
          for (const segment of segments) {
            if (db.prepare('SELECT id FROM entries WHERE member_id=? AND date=? AND start<? AND end>?').get(me.id, segment.date, segment.end, segment.start)) throw new AuthError(`Un créneau du ${segment.date} chevauche une prestation existante. Corrigez le relevé ou saisissez les horaires manuellement. Le chronomètre est conservé.`, 409);
            const id = crypto.randomUUID(); ids.push(id);
            db.prepare('INSERT INTO entries (id,member_id,client_id,ticket,ticket_source,glpi_ticket_id,date,start,end,description,billed,on_site,hourly_rate_cents,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,1,?,?)').run(id,me.id,timer.client_id,timer.ticket,timer.ticket_source,timer.glpi_ticket_id,segment.date,segment.start,segment.end,body.description,timer.on_site,rate,created,created);
            if (timer.on_site) db.prepare('INSERT OR IGNORE INTO travel_days (member_id,client_id,date,fee_cents,anchor_entry_id) SELECT ?,?,?,travel_fee_cents,? FROM members WHERE id=?').run(me.id,timer.client_id,segment.date,id,me.id);
          }
          db.prepare('INSERT INTO timer_receipts VALUES (?,?,?,?)').run(timer.id,me.id,JSON.stringify(ids),created);
          db.prepare('DELETE FROM work_timers WHERE member_id=? AND id=?').run(me.id,timer.id);
          return ids;
        });
        return json({ saved: true, entry_ids: ids });
      } else throw new AuthError('Action non reconnue.');
    }
    return json(preview(current(me.id)));
  } catch (e) { return fail(e); }
}
