import { getMember, checkOrigin, AuthError } from '@/lib/auth';
import { sqlite, transaction } from '@/db/raw';
import { amountCents } from '@/lib/pricing';
import { validDate } from '@/lib/business';
import type { Member } from '@/lib/types';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function who() {
  const member = await getMember();
  if (!member) throw new AuthError('Reconnectez-vous pour continuer.', 401);
  if (member.must_change) throw new AuthError('Changez votre mot de passe provisoire.', 403);
  return member;
}
function target(value: unknown, member: Member) {
  const id = value === undefined || value === null ? member.id : value;
  if (typeof id !== 'string' || !id || id.length > 100) throw new AuthError('Prestataire invalide.');
  if (id !== member.id && member.role !== 'admin') throw new AuthError('Vous ne pouvez gérer que votre propre tarif avec Sumatoni.', 403);
  if (!sqlite().prepare('SELECT id FROM members WHERE id=?').get(id)) throw new AuthError('Prestataire introuvable.', 404);
  return id;
}
function rates(id: string) {
  return sqlite().prepare('SELECT effective_from,hourly_rate_cents,version FROM provider_rates WHERE member_id=? ORDER BY effective_from DESC').all(id);
}
function fail(error: unknown) {
  return json({ error: error instanceof AuthError ? error.message : 'Le tarif n’a pas pu être enregistré. Réessayez.' }, error instanceof AuthError ? error.status : 503);
}
export async function GET(request: Request) {
  try { const me = await who(), id = target(new URL(request.url).searchParams.get('member'), me); return json({ member_id: id, rates: rates(id) }); }
  catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AuthError('Format de requête invalide.');
    const raw = await request.text(); if (raw.length > 2000) throw new AuthError('Formulaire trop long.');
    let body; try { body = JSON.parse(raw); } catch { throw new AuthError('Formulaire invalide.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AuthError('Formulaire invalide.');
    const me = await who(), id = target(body.member_id, me);
    if (typeof body.effective_from !== 'string' || !validDate(body.effective_from)) throw new AuthError('Choisissez une date d’application valide.');
    if (!Number.isSafeInteger(body.version) || body.version < 0) throw new AuthError('Actualisez le tarif avant de le modifier.', 409);
    if (!Object.hasOwn(body, 'hourly_rate')) throw new AuthError('Indiquez le tarif, ou laissez-le vide pour le désactiver.');
    let amount: number | null;
    try { amount = amountCents(body.hourly_rate); } catch (error) { throw new AuthError((error as Error).message); }
    transaction(db => {
      // Recheck authorization after asynchronous identity validation, under the write lock.
      const actor = db.prepare('SELECT role,active FROM members WHERE id=?').get(me.id) as { role: string; active: number } | undefined;
      if (!actor?.active) throw new AuthError('Reconnectez-vous pour continuer.', 401);
      if (id !== me.id && actor.role !== 'admin') throw new AuthError('Cette action nécessite les droits administrateur.', 403);
      const previous = db.prepare('SELECT hourly_rate_cents,version FROM provider_rates WHERE member_id=? AND effective_from=?').get(id, body.effective_from) as { hourly_rate_cents: number | null; version: number } | undefined;
      if ((previous?.version ?? 0) !== body.version) throw new AuthError('Ce tarif a changé. Rechargez les tarifs avant de réessayer.', 409);
      const version = body.version + 1, now = new Date().toISOString();
      db.prepare(`INSERT INTO provider_rates(member_id,effective_from,hourly_rate_cents,version,actor_id,updated_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(member_id,effective_from) DO UPDATE SET hourly_rate_cents=excluded.hourly_rate_cents,version=excluded.version,actor_id=excluded.actor_id,updated_at=excluded.updated_at`).run(id,body.effective_from,amount,version,me.id,now);
      db.prepare('INSERT INTO provider_rate_events(id,member_id,actor_id,effective_from,previous_rate_cents,new_rate_cents,version,created_at) VALUES (?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),id,me.id,body.effective_from,previous?.hourly_rate_cents ?? null,amount,version,now);
    });
    return json({ member_id: id, rates: rates(id) });
  } catch (error) { return fail(error); }
}
