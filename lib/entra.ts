import * as oidc from 'openid-client';
import { randomBytes } from 'node:crypto';
import { sqlite, transaction } from '@/db/raw';
import { AuthError, tokenHash } from './auth';
import { entraConfiguration, entraGuid } from './entra-config';
export const ENTRA_FLOW_COOKIE = 'sumatoni_entra_flow';
const FLOW_SECONDS = 600;
type Configuration = NonNullable<ReturnType<typeof entraConfiguration>>;
type Flow = { verifier: string; nonce: string };
let cached: { key: string; expires: number; promise: Promise<oidc.Configuration> } | undefined;
export function requireEntra() {
  try { const config = entraConfiguration(); if (config) return config; } catch { /* Fail closed without exposing credentials. */ }
  throw new AuthError('La connexion Microsoft n’est pas encore configurée. Utilisez votre accès habituel.', 503);
}
async function client(config: Configuration) {
  const key = tokenHash(JSON.stringify(config));
  if (!cached || cached.key !== key || cached.expires <= Date.now()) {
    const promise = oidc.discovery(new URL(config.issuer), config.clientId,
      { client_secret: config.secret, id_token_signed_response_alg: 'RS256' }, oidc.ClientSecretPost(config.secret), { timeout: 8 })
      .then(result => {
        const metadata = result.serverMetadata();
        if (metadata.issuer !== config.issuer) throw new Error('Unexpected Microsoft issuer');
        for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri]) {
          const url = new URL(endpoint || '');
          if (url.origin !== 'https://login.microsoftonline.com' || url.username || url.password) throw new Error('Unexpected Microsoft endpoint');
        }
        result.timeout = 8;
        oidc.enableNonRepudiationChecks(result); // Includes JWKS verification of the ID token signature.
        return result;
      });
    cached = { key, expires: Date.now() + 300000, promise };
    void promise.catch(() => { if (cached?.promise === promise) cached = undefined; });
  }
  return cached.promise;
}
export function flowCookie(value: string, config: Configuration, clear = false) {
  return `${ENTRA_FLOW_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/api/auth/entra; Max-Age=${clear ? 0 : FLOW_SECONDS}${config.origin.startsWith('https:') ? '; Secure' : ''}`;
}
export async function startEntra(config: Configuration, selectAccount = false) {
  const provider = await client(config);
  const state = oidc.randomState(), browser = randomBytes(32).toString('hex');
  const verifier = oidc.randomPKCECodeVerifier(), nonce = oidc.randomNonce();
  const challenge = await oidc.calculatePKCECodeChallenge(verifier);
  const url = oidc.buildAuthorizationUrl(provider, { redirect_uri: config.redirectUri,
    scope: 'openid profile email', response_type: 'code', response_mode: 'query',
    code_challenge: challenge, code_challenge_method: 'S256', state, nonce, ...(selectAccount ? { prompt: 'select_account' } : {}) });
  sqlite().prepare('DELETE FROM entra_flows WHERE expires<=?').run(Date.now());
  sqlite().prepare('INSERT INTO entra_flows VALUES (?,?,?,?,?)').run(tokenHash(state), tokenHash(browser), verifier, nonce, Date.now() + FLOW_SECONDS * 1000);
  return { url: url.href, cookie: flowCookie(browser, config) };
}
export function consumeEntraFlow(url: URL, browser: string | undefined): Flow {
  const states = url.searchParams.getAll('state');
  if (states.length !== 1 || !/^[a-zA-Z0-9_-]{32,128}$/.test(states[0]) || !browser || !/^[a-f0-9]{64}$/.test(browser)) throw new AuthError('Connexion expirée. Réessayez.', 400);
  // Atomic, one-use, browser-bound consumption, before any async code exchange.
  const flow = sqlite().prepare('DELETE FROM entra_flows WHERE state_hash=? AND browser_hash=? AND expires>? RETURNING verifier,nonce')
    .get(tokenHash(states[0]), tokenHash(browser), Date.now()) as Flow | undefined;
  if (!flow) throw new AuthError('Connexion expirée. Réessayez.', 400);
  return flow;
}
export async function finishEntra(config: Configuration, url: URL, flow: Flow) {
  if (url.href.length > 10000) throw new AuthError('Retour Microsoft non valide.');
  const tokens = await oidc.authorizationCodeGrant(await client(config), url,
    { pkceCodeVerifier: flow.verifier, expectedNonce: flow.nonce, expectedState: url.searchParams.get('state')!, idTokenExpected: true });
  const claims = tokens.claims();
  if (!claims || claims.iss !== config.issuer || entraGuid(claims.tid) !== config.tenantId) throw new AuthError('Compte Microsoft non autorisé.', 403);
  const objectId = entraGuid(claims.oid);
  const member = sqlite().prepare(`SELECT m.id FROM entra_identities e JOIN members m ON m.id=e.member_id
    WHERE e.tenant_id=? AND e.object_id=? AND m.active=1`).get(config.tenantId, objectId) as { id: string } | undefined;
  if (!member) throw new AuthError('Ce compte Microsoft n’a pas accès à SumaTime. Contactez votre administrateur.', 403);
  // Email/name are display claims, never a permission or an automatic account link.
  return { memberId: member.id, tenantId: config.tenantId, objectId,
    maxAge: Math.min(config.sessionSeconds, Math.floor(claims.exp - Date.now() / 1000)) };
}
export function linkEntraIdentity(memberId: string, tenant: unknown, object: unknown, actorId: string) {
  let tenantId: string, objectId: string;
  try { tenantId = entraGuid(tenant); objectId = entraGuid(object); }
  catch { throw new AuthError('Tenant ID et Object ID Microsoft doivent être des UUID valides.'); }
  if (process.env.ENTRA_TENANT_ID && tenantId !== entraGuid(process.env.ENTRA_TENANT_ID)) throw new AuthError('Ce tenant ne correspond pas au tenant Sumatoni configuré.');
  transaction(db => {
    if (!db.prepare('SELECT 1 FROM members WHERE id=?').get(memberId)) throw new AuthError('Membre introuvable.', 404);
    const owner = db.prepare('SELECT member_id FROM entra_identities WHERE tenant_id=? AND object_id=?').get(tenantId, objectId) as { member_id: string } | undefined;
    if (owner && owner.member_id !== memberId) throw new AuthError('Cette identité Microsoft est déjà rattachée à un autre membre.', 409);
    const existing = db.prepare('SELECT tenant_id,object_id FROM entra_identities WHERE member_id=?').get(memberId) as { tenant_id: string; object_id: string } | undefined;
    if (existing && (existing.tenant_id !== tenantId || existing.object_id !== objectId)) throw new AuthError('Retirez d’abord l’ancien rattachement Microsoft.', 409);
    if (existing) return;
    db.prepare('INSERT INTO entra_identities VALUES (?,?,?,?,?)').run(memberId, tenantId, objectId, actorId, new Date().toISOString());
    db.prepare("INSERT INTO entra_identity_events(member_id,actor_id,action,tenant_id,object_id,created_at) VALUES (?,?,'link',?,?,?)").run(memberId, actorId, tenantId, objectId, new Date().toISOString());
  });
}
export function unlinkEntraIdentity(memberId: string, actorId: string) {
  transaction(db => {
    const identity = db.prepare('SELECT tenant_id,object_id FROM entra_identities WHERE member_id=?').get(memberId) as { tenant_id: string; object_id: string } | undefined;
    if (!identity) throw new AuthError('Rattachement Microsoft introuvable.', 404);
    db.prepare('DELETE FROM sessions WHERE member_id=? AND token_hash IN (SELECT token_hash FROM entra_sessions)').run(memberId);
    db.prepare('DELETE FROM entra_identities WHERE member_id=?').run(memberId);
    db.prepare("INSERT INTO entra_identity_events(member_id,actor_id,action,tenant_id,object_id,created_at) VALUES (?,?,'unlink',?,?,?)").run(memberId, actorId, identity.tenant_id, identity.object_id, new Date().toISOString());
  });
}
