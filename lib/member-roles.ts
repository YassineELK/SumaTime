import { transaction } from '@/db/raw';
import { AuthError } from './auth';
import type { Member } from './types';

type Role = Member['role'];
type Target = { role: Role; active: number };
export function changeMemberRole(actorId: string, memberId: unknown, role: unknown, expectedRole: unknown) {
  if (typeof memberId !== 'string' || !memberId || memberId.length > 100 ||
      typeof role !== 'string' || !['admin', 'partner'].includes(role) ||
      typeof expectedRole !== 'string' || !['admin', 'partner'].includes(expectedRole)) {
    throw new AuthError('Membre et rôle valides obligatoires.');
  }
  return transaction(db => {
    // Recheck after any asynchronous authentication: concurrent demotion wins.
    const actor = db.prepare('SELECT role,active FROM members WHERE id=?').get(actorId) as Target | undefined;
    if (actor?.role !== 'admin' || !actor.active) throw new AuthError('Action réservée à l’administrateur.', 403);
    if (actorId === memberId) throw new AuthError('Un autre administrateur doit modifier votre rôle.', 403);
    const target = db.prepare('SELECT role,active FROM members WHERE id=?').get(memberId) as Target | undefined;
    if (!target) throw new AuthError('Membre introuvable.', 404);
    if (target.role !== expectedRole) throw new AuthError('Ce rôle a déjà été modifié. Actualisez l’équipe avant de réessayer.', 409);
    if (target.role === role) return false;
    if (role === 'admin' && !target.active) throw new AuthError('Réactivez ce membre avant de le nommer administrateur.', 409);
    if (target.role === 'admin' && role === 'partner' && db.prepare(
      "SELECT 1 FROM accounts WHERE member_id=? AND provider='local'"
    ).get(memberId) && !db.prepare(
      "SELECT 1 FROM members m JOIN accounts a ON a.member_id=m.id WHERE m.role='admin' AND m.active=1 AND a.provider='local' AND m.id<>?"
    ).get(memberId)) {
      throw new AuthError('Conservez au moins un administrateur actif avec un compte local de secours.', 409);
    }
    db.prepare('UPDATE members SET role=? WHERE id=?').run(role, memberId);
    db.prepare('INSERT INTO member_role_events VALUES (?,?,?,?,?,?)').run(
      crypto.randomUUID(), memberId, actorId, target.role, role, new Date().toISOString());
    // Local, LDAP and Microsoft sessions all lose their old permissions.
    db.prepare('DELETE FROM sessions WHERE member_id=?').run(memberId);
    return true;
  });
}
