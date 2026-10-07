import { cookies } from 'next/headers';
import { timingSafeEqual } from 'node:crypto';
import { sqlite, setupToken, transaction } from '@/db/raw';
import { AuthError, COOKIE, checkOrigin, createSession, getMember, rateLimit, tokenHash } from '@/lib/auth';
import { hashPassword, validPassword, verifyPassword } from '@/lib/password';
import { authenticateLdap, ldapEnabled } from '@/lib/ldap';
import { entraStatus, entraGuid } from '@/lib/entra-config';
import { linkEntraIdentity, unlinkEntraIdentity } from '@/lib/entra';
import { changeMemberRole } from '@/lib/member-roles';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const reply = (data: unknown, status = 200, cookie?: string) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
const clean = (value: unknown, max = 254) => typeof value === 'string' ? value.trim().slice(0, max) : '';
function email(value: unknown) {
  const result = clean(value).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new AuthError('Adresse e-mail non valide.');
  return result;
}
function password(value: unknown) {
  if (!validPassword(value)) throw new AuthError('Le mot de passe doit contenir entre 12 et 128 caractères.');
  return value;
}
type Account = { member_id: string; provider: string; password_hash: string | null; active: number; must_change: number };
export async function GET() {
  const settings = { setup: !sqlite().prepare('SELECT 1 FROM accounts LIMIT 1').get(), ldap: ldapEnabled(), entra: entraStatus() };
  try {
    const me = await getMember();
    return reply({ ...settings, ...(me?.role === 'admin' ? { entraTenantId: process.env.ENTRA_TENANT_ID || '' } : {}), me });
  } catch (error) {
    if (error instanceof AuthError) return reply({ ...settings, error: error.message, code: error.code, retryable: error.retryable, preserveOperation: error.preserveOperation }, error.status);
    return reply({ ...settings, error: 'Vérification de votre accès impossible. Réessayez.' }, 503);
  }
}
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    checkOrigin(request);
    if (raw.length > 8000 || !request.headers.get('content-type')?.startsWith('application/json')) throw new AuthError('Requête non valide.');
    let body;
    try { body = JSON.parse(raw); } catch { throw new AuthError('Requête non valide.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AuthError('Requête non valide.');
    const db = sqlite();
    if (body.action === 'logout') {
      const token = (await cookies()).get(COOKIE)?.value;
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
      return reply({ ok: true }, 200, `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    }
    if (body.action === 'setup') {
      if (db.prepare('SELECT 1 FROM accounts LIMIT 1').get()) throw new AuthError('L’espace est déjà configuré.', 409);
      rateLimit('setup', 10, 15 * 60000);
      const expected = Buffer.from(setupToken()), supplied = Buffer.from(clean(body.token, 256));
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new AuthError('Code d’installation incorrect.', 403);
      const login = email(body.email), name = clean(body.name, 100);
      if (!name) throw new AuthError('Votre nom est obligatoire.');
      const hash = await hashPassword(password(body.password));
      const id = transaction(tx => {
        if (tx.prepare('SELECT 1 FROM accounts LIMIT 1').get()) throw new AuthError('L’espace est déjà configuré.', 409);
        // Preserve the existing owner's stable business identity during the migration.
        const existing = tx.prepare("SELECT id FROM members WHERE role='admin' ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
        const memberId = existing?.id || crypto.randomUUID();
        if (existing) tx.prepare('UPDATE members SET email=?,name=?,active=1 WHERE id=?').run(login, name, memberId);
        else tx.prepare("INSERT INTO members (id,email,name,role,active,created_at) VALUES (?,?,?,'admin',1,?)").run(memberId, login, name, new Date().toISOString());
        tx.prepare("INSERT INTO accounts VALUES (?,?,'local',?,0)").run(memberId, login, hash);
        return memberId;
      });
      return reply({ ok: true }, 200, createSession(id, request));
    }
    if (body.action === 'login') {
      const login = clean(body.login).toLowerCase();
      if (!login || typeof body.password !== 'string' || !body.password || body.password.length > 128) throw new AuthError('Identifiants incorrects.', 401);
      rateLimit('global', 100, 60000);
      rateLimit('login:' + tokenHash(login), 5, 15 * 60000);
      const account = db.prepare('SELECT a.*,m.active FROM accounts a JOIN members m ON m.id=a.member_id WHERE a.login=?').get(login) as Account | undefined;
      let valid = false;
      if (account?.provider === 'ldap' && account.active) {
        try { valid = await authenticateLdap(login, body.password); }
        catch { throw new AuthError('L’annuaire est indisponible ou mal configuré. Contactez l’administrateur.', 503); }
      } else {
        // Equal hashing cost for an unknown local account.
        valid = await verifyPassword(body.password, account?.password_hash || 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128));
      }
      // Hash verification and directory binds yield: recheck after them so a
      // concurrent reset/deactivation cannot issue a session with old credentials.
      const latest = db.prepare('SELECT a.*,m.active FROM accounts a JOIN members m ON m.id=a.member_id WHERE a.login=?').get(login) as Account | undefined;
      if (!valid || !account?.active || !latest?.active || latest.password_hash !== account.password_hash || latest.provider !== account.provider) throw new AuthError('Identifiants incorrects.', 401);
      db.prepare('DELETE FROM login_limits WHERE key=?').run('login:' + tokenHash(login));
      return reply({ ok: true, mustChange: !!account.must_change }, 200, createSession(account.member_id, request));
    }
    const me = await getMember();
    if (!me) throw new AuthError('Reconnectez-vous pour continuer.', 401);
    if (body.action === 'password') {
      rateLimit('password:' + me.id, 5, 15 * 60000);
      const account = db.prepare('SELECT * FROM accounts WHERE member_id=?').get(me.id) as Account;
      if (me.provider === 'entra' || !account || account.provider !== 'local') throw new AuthError('Modifiez votre mot de passe dans votre annuaire d’entreprise.');
      if (typeof body.current !== 'string' || body.current.length > 128 || !await verifyPassword(body.current, account.password_hash!)) throw new AuthError('Mot de passe actuel incorrect.', 403);
      const next = password(body.password);
      if (next === body.current) throw new AuthError('Choisissez un nouveau mot de passe.');
      const hash = await hashPassword(next);
      transaction(tx => {
        tx.prepare('UPDATE accounts SET password_hash=?,must_change=0 WHERE member_id=?').run(hash, me.id);
        tx.prepare('DELETE FROM sessions WHERE member_id=?').run(me.id);
      });
      db.prepare('DELETE FROM login_limits WHERE key=?').run('password:' + me.id);
      return reply({ ok: true }, 200, createSession(me.id, request));
    }
    if (me.must_change) throw new AuthError('Changez d’abord votre mot de passe provisoire.', 403);
    if (me.role !== 'admin') throw new AuthError('Action réservée à l’administrateur.', 403);
    if (body.action === 'memberRole') {
      const changed = changeMemberRole(me.id, body.id, body.role, body.expectedRole);
      return reply({ ok: true, changed });
    }
    if (body.action === 'entraLink') {
      linkEntraIdentity(clean(body.id), body.tenantId, body.objectId, me.id);
      return reply({ ok: true });
    }
    if (body.action === 'entraUnlink') {
      const id = clean(body.id);
      if (id === me.id && me.provider === 'entra') throw new AuthError('Reconnectez-vous avec votre compte local avant de retirer votre propre accès Microsoft.');
      unlinkEntraIdentity(id, me.id);
      return reply({ ok: true });
    }
    if (body.action === 'account' && body.provider === 'entra') {
      const address = email(body.email), name = clean(body.name, 100);
      if (!name) throw new AuthError('Le nom est obligatoire.');
      let tenantId: string, objectId: string;
      try { tenantId = entraGuid(body.tenantId); objectId = entraGuid(body.objectId); }
      catch { throw new AuthError('Tenant ID et Object ID Microsoft doivent être des UUID valides.'); }
      if (process.env.ENTRA_TENANT_ID && tenantId !== entraGuid(process.env.ENTRA_TENANT_ID)) throw new AuthError('Ce tenant ne correspond pas au tenant Sumatoni configuré.');
      transaction(tx => {
        if (tx.prepare('SELECT 1 FROM members WHERE email=?').get(address)) throw new AuthError('Ce membre existe déjà. Utilisez son rattachement Microsoft pour conserver ses prestations.', 409);
        if (tx.prepare('SELECT 1 FROM entra_identities WHERE tenant_id=? AND object_id=?').get(tenantId, objectId)) throw new AuthError('Cette identité Microsoft est déjà rattachée.', 409);
        const id = crypto.randomUUID(), now = new Date().toISOString();
        tx.prepare("INSERT INTO members(id,email,name,role,active,created_at) VALUES (?,?,?,'partner',1,?)").run(id, address, name, now);
        tx.prepare('INSERT INTO entra_identities VALUES (?,?,?,?,?)').run(id, tenantId, objectId, me.id, now);
        tx.prepare("INSERT INTO entra_identity_events(member_id,actor_id,action,tenant_id,object_id,created_at) VALUES (?,?,'link',?,?,?)").run(id, me.id, tenantId, objectId, now);
      });
      return reply({ ok: true });
    }
    if (body.action === 'account') {
      if (body.provider !== undefined && !['local','ldap'].includes(body.provider)) throw new AuthError('Type de compte non valide.');
      const address = email(body.email), name = clean(body.name, 100), provider = body.provider === 'ldap' ? 'ldap' : 'local';
      const login = provider === 'local' ? address : clean(body.login).toLowerCase();
      if (!name || !login || (provider === 'ldap' && !/^[a-z0-9._@\\-]+$/i.test(login))) throw new AuthError('Nom et identifiant valides obligatoires.');
      const hash = provider === 'local' ? await hashPassword(password(body.password)) : null;
      transaction(tx => {
        const existing = tx.prepare('SELECT id FROM members WHERE email=?').get(address) as { id: string } | undefined;
        if (tx.prepare('SELECT 1 FROM accounts WHERE login=? OR member_id=?').get(login, existing?.id || '')) throw new AuthError('Ce compte existe déjà.', 409);
        const id = existing?.id || crypto.randomUUID();
        if (!existing) tx.prepare("INSERT INTO members (id,email,name,role,active,created_at) VALUES (?,?,?,'partner',1,?)").run(id, address, name, new Date().toISOString());
        tx.prepare('INSERT INTO accounts VALUES (?,?,?,?,?)').run(id, login, provider, hash, provider === 'local' ? 1 : 0);
      });
    } else if (body.action === 'reset') {
      const id = clean(body.id);
      if (id === me.id) throw new AuthError('Utilisez Mon compte pour changer votre propre mot de passe.');
      const account = db.prepare("SELECT * FROM accounts WHERE member_id=? AND provider='local'").get(id);
      if (!account) throw new AuthError('Compte local introuvable.');
      const hash = await hashPassword(password(body.password));
      transaction(tx => {
        tx.prepare('UPDATE accounts SET password_hash=?,must_change=1 WHERE member_id=?').run(hash, id);
        tx.prepare('DELETE FROM sessions WHERE member_id=?').run(id);
      });
    } else throw new AuthError('Action non reconnue.');
    return reply({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) return reply({ error: error.message }, error.status);
    console.error('Authentication request failed');
    return reply({ error: 'Opération impossible. Vérifiez les informations ou contactez l’administrateur.' }, 503);
  }
}
