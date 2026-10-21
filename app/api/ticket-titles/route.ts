import { getMember, checkOrigin, AuthError, rateLimit } from '@/lib/auth';
import { sqlite, transaction } from '@/db/raw';
import { historicalGlpiTitles } from '@/lib/glpi';
import { historicalTicketId } from '@/lib/ticket-title';
import type { Entry, Member } from '@/lib/types';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const me = await getMember(); if (!me) throw new AuthError('Reconnectez-vous.', 401);
    if (me.must_change) throw new AuthError('Changez votre mot de passe provisoire.', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AuthError('Format invalide.');
    const raw = await request.text(); if (raw.length > 4000) throw new AuthError('Requête trop volumineuse.');
    let body; try { body = JSON.parse(raw); } catch { throw new AuthError('Requête invalide.'); }
    if (!body || !Array.isArray(body.ids) || !body.ids.length || body.ids.length > 40 || body.ids.some((id: unknown) => typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id))) throw new AuthError('Choisissez de 1 à 40 prestations.');
    const ids = [...new Set(body.ids)] as string[];
    const rows = sqlite().prepare(`SELECT * FROM entries WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Entry[];
    if (rows.length !== ids.length || rows.some(row => me.role !== 'admin' && row.member_id !== me.id)) throw new AuthError('Certaines prestations sont inaccessibles.', 403);
    const missing = rows.filter(row => !row.ticket_title?.trim() && historicalTicketId(row) !== null);
    if (!missing.length) return json({ updated: [], unavailable: [], conflicts: [], skipped: ids });
    const pairs = [...new Map(missing.map(row => { const ticket_id = historicalTicketId(row)!; return [row.client_id + ':' + ticket_id, { client_id: row.client_id, ticket_id }]; })).values()];
    if (pairs.length > 20) throw new AuthError('Complétez au maximum 20 tickets distincts à la fois.');
    rateLimit('ticket-titles:' + me.id, 6, 60000);
    const results = await historicalGlpiTitles(me.id, pairs);
    const outcome = transaction(db => {
      const actor = db.prepare('SELECT role,active FROM members WHERE id=?').get(me.id) as Pick<Member, 'role' | 'active'> | undefined;
      if (!actor?.active) throw new AuthError('Reconnectez-vous.', 401);
      if (actor.role !== 'admin' && rows.some(row => row.member_id !== me.id)) throw new AuthError('Vos droits ont changé. Actualisez.', 403);
      const updated: string[] = [], unavailable: string[] = [], conflicts: string[] = [];
      for (const row of missing) {
        const result = results.find(r => r.client_id === row.client_id && r.ticket_id === historicalTicketId(row));
        if (!result?.title) { unavailable.push(row.id); continue; }
        const change = db.prepare(`UPDATE entries SET ticket_title=?,version=version+1,updated_at=?
          WHERE id=? AND version=? AND member_id=? AND client_id=? AND ticket=? AND (ticket_title IS NULL OR trim(ticket_title)='')
          AND EXISTS (SELECT 1 FROM clients WHERE id=? AND glpi_entity_id=?)`).run(result.title,new Date().toISOString(),row.id,row.version,row.member_id,row.client_id,row.ticket,row.client_id,result.entity);
        (change.changes ? updated : conflicts).push(row.id);
      }
      return { updated, unavailable, conflicts, skipped: ids.filter(id => !missing.some(row => row.id === id)) };
    });
    return json(outcome);
  } catch (error) { return json({ error: error instanceof AuthError ? error.message : 'Impossible de compléter les intitulés. Les prestations sont conservées.' }, error instanceof AuthError ? error.status : 503); }
}
