import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'node:crypto';
import { sqlite, transaction } from '@/db/raw';
import { entraConfiguration } from './entra-config';
import { entraAssigned } from './entra-assignments';
import type { Member } from './types';
export const COOKIE = 'sumatoni_session';
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export type AuthErrorMetadata = {
  code?: string;
  terminal?: boolean;
  retryable?: boolean;
  preserveOperation?: boolean;
};
export class AuthError extends Error {
  readonly code?: string;
  readonly terminal?: boolean;
  readonly retryable?: boolean;
  readonly preserveOperation?: boolean;
  constructor(message: string, public status = 400, metadata: AuthErrorMetadata = {}) {
    super(message);
    this.code = metadata.code;
    this.terminal = metadata.terminal;
    this.retryable = metadata.retryable;
    this.preserveOperation = metadata.preserveOperation;
  }
}
export function appOrigin(request: Request) {
  if (process.env.APP_URL) return new URL(process.env.APP_URL).origin;
  const url = new URL(request.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new AuthError('Configurez APP_URL sur le serveur.', 503);
  return url.origin;
}
export function checkOrigin(request: Request) {
  if (request.headers.get('origin') !== appOrigin(request)) throw new AuthError('Origine de la requête non autorisée.', 403);
}
export async function getMember() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const query = sqlite().prepare(`SELECT m.id,m.user_id,m.email,m.name,m.role,m.active,
    CASE WHEN es.token_hash IS NOT NULL THEN 'entra' ELSE a.provider END AS provider,
    CASE WHEN es.token_hash IS NOT NULL THEN 0 ELSE a.must_change END AS must_change, es.tenant_id AS session_tenant, es.object_id AS session_object, p.member_id AS provisioned
    FROM sessions s JOIN members m ON m.id=s.member_id LEFT JOIN accounts a ON a.member_id=m.id
    LEFT JOIN entra_sessions es ON es.token_hash=s.token_hash
    LEFT JOIN entra_identities e ON e.member_id=m.id AND e.tenant_id=es.tenant_id AND e.object_id=es.object_id
    LEFT JOIN entra_provisioned_members p ON p.member_id=m.id AND p.tenant_id=es.tenant_id AND p.object_id=es.object_id
    WHERE s.token_hash=? AND s.expires>? AND m.active=1
      AND ((es.token_hash IS NULL AND a.member_id IS NOT NULL) OR e.member_id IS NOT NULL)`)
  const read = () => query.get(tokenHash(token), Date.now()) as (Member & {
    session_tenant: string | null; session_object: string | null; provisioned: string | null;
  }) | undefined;
  let member = read();
  if (!member) return null;
  if (member.provider === 'entra') {
    let config: ReturnType<typeof entraConfiguration>;
    try { config = entraConfiguration(); } catch { return null; }
    if (!config || config.tenantId !== member.session_tenant || !member.session_object) return null;
    if (config.accessMode === 'assignment') {
      let assigned: boolean;
      try { assigned = await entraAssigned(config, member.session_object); }
      catch {
        // Outage is retryable, not a logout. No cached access past expiry and no session deletion.
        throw new AuthError('La vérification de votre accès Microsoft est temporairement indisponible. Vos saisies sont conservées ; réessayez.', 503,
          { code: 'ENTRA_ACCESS_UNAVAILABLE', terminal: false, retryable: true, preserveOperation: true });
      }
      if (!assigned) {
        sqlite().prepare(`DELETE FROM sessions WHERE member_id=? AND token_hash IN (
          SELECT token_hash FROM entra_sessions WHERE tenant_id=? AND object_id=?)`)
          .run(member.id, member.session_tenant, member.session_object);
        return null;
      }
      // Network checks yield. A concurrent unlink/deactivation/role update wins.
      const latest = read();
      if (!latest || latest.provider !== 'entra' || latest.session_tenant !== member.session_tenant || latest.session_object !== member.session_object) return null;
      member = latest;
    } else if (member.provisioned) return null; // Disabling assignment mode cannot bypass entitlement.
  }
  const { session_tenant: tenant, session_object: object, provisioned, ...publicMember } = member;
  void tenant; void object; void provisioned;
  return publicMember;
}
export function createSession(memberId: string, request: Request, entra?: { tenantId: string; objectId: string; maxAge: number }) {
  const token = randomBytes(32).toString('hex'), hash = tokenHash(token);
  const maxAge = entra ? entra.maxAge : 43200;
  if (!Number.isInteger(maxAge) || maxAge <= 0 || maxAge > 43200) throw new AuthError('Session expirée. Reconnectez-vous.', 401);
  transaction(db => {
    if (entra && !db.prepare(`SELECT 1 FROM entra_identities e JOIN members m ON m.id=e.member_id
      WHERE e.member_id=? AND e.tenant_id=? AND e.object_id=? AND m.active=1`).get(memberId, entra.tenantId, entra.objectId)) {
      throw new AuthError('Compte Microsoft non autorisé.', 403);
    }
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash, memberId, Date.now() + maxAge * 1000);
    if (entra) db.prepare('INSERT INTO entra_sessions VALUES (?,?,?)').run(hash, entra.tenantId, entra.objectId);
  });
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${appOrigin(request).startsWith('https:') ? '; Secure' : ''}`;
}

export function rateLimit(key: string, max: number, duration: number) {
  const now = Date.now();
  sqlite().prepare('DELETE FROM login_limits WHERE until<=?').run(now);
  const result = sqlite().prepare(`INSERT INTO login_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts`).get(key, now + duration) as { attempts: number };
  if (result.attempts > max) throw new AuthError('Trop de tentatives. Patientez avant de réessayer.', 429);
}
