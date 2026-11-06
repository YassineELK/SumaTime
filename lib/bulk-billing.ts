import type { DatabaseSync } from 'node:sqlite';
import { AuthError } from './auth';
import type { BillingItem } from './billing-selection';
// Called inside a transaction: a stale/locked/missing row rejects the whole batch.
export function markEntriesBilled(db: DatabaseSync, actorId: string, items: BillingItem[], now: string) {
  const actor = db.prepare('SELECT active,role FROM members WHERE id=?').get(actorId);
  if (!actor?.active) throw new AuthError('Reconnectez-vous.', 401);
  if (actor.role !== 'admin') throw new AuthError('La facturation est réservée aux administrateurs.', 403);
  const find = db.prepare('SELECT version,billed FROM entries WHERE id=?');
  for (const item of items) {
    const row = find.get(item.id);
    if (!row || row.version !== item.version || row.billed !== 0) throw new AuthError('Une prestation a été modifiée, supprimée ou déjà facturée. Aucun changement effectué : actualisez le relevé puis refaites votre sélection.', 409);
  }
  const update = db.prepare('UPDATE entries SET billed=1,version=version+1,updated_at=? WHERE id=? AND version=? AND billed=0');
  for (const item of items) {
    if (Number(update.run(now,item.id,item.version).changes) !== 1) throw new AuthError('Le relevé a changé. Aucun changement effectué : actualisez avant de réessayer.', 409);
  }
  return items.length;
}
