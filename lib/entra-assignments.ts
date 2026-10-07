import { createHash } from 'node:crypto';
import { entraGuid, type entraConfiguration } from './entra-config';

type Configuration = NonNullable<ReturnType<typeof entraConfiguration>>;
const GRAPH = 'https://graph.microsoft.com';
export const ENTRA_ASSIGNMENT_CACHE_MS = 60_000;
const TIMEOUT_MS = 8_000;
const MAX_PAGES = 100;
const MAX_BODY_BYTES = 2_000_000;
const unavailable = () => new Error('Le contrôle des accès Microsoft est indisponible.');
type Token = { value: string; expires: number };
type Snapshot = { users: Set<string>; expires: number };
type State = { token?: Token; tokenFlight?: Promise<Token>; snapshot?: Snapshot; flight?: Promise<Snapshot>; retryAfter?: number };
let active: { key: string; state: State } | undefined;

function stateFor(config: Configuration) {
  // A credential/tenant/application change cannot reuse an old authorization.
  const key = createHash('sha256').update(JSON.stringify([config.tenantId, config.clientId, config.secret])).digest('hex');
  if (active?.key !== key) active = { key, state: {} };
  return active.state;
}
async function json(url: URL, init: RequestInit, deadline = Date.now() + TIMEOUT_MS) {
  const remaining = Math.min(TIMEOUT_MS, deadline - Date.now());
  if (remaining <= 0) throw unavailable();
  const response = await fetch(url, { ...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(remaining) });
  if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw unavailable();
  // Bound the body before parsing, even if Content-Length is absent or false.
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.length;
      if (bytes > MAX_BODY_BYTES) throw unavailable();
      chunks.push(value);
    }
  } catch { await reader.cancel().catch(() => {}); throw unavailable(); }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw unavailable();
  return body as Record<string, unknown>;
}
async function token(config: Configuration, state: State, deadline: number) {
  if (state.token && state.token.expires > Date.now()) return state.token.value;
  if (!state.tokenFlight) {
    const started = Date.now();
    state.tokenFlight = (async () => {
      const body = await json(new URL(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`), {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ client_id: config.clientId, client_secret: config.secret,
          grant_type: 'client_credentials', scope: GRAPH + '/.default' }).toString(),
      }, deadline);
      if (typeof body.access_token !== 'string' || !body.access_token || body.access_token.length > 32768 ||
          typeof body.token_type !== 'string' || body.token_type.toLowerCase() !== 'bearer' ||
          typeof body.expires_in !== 'number' || !Number.isInteger(body.expires_in) || body.expires_in <= 60 || body.expires_in > 86400) throw unavailable();
      return { value: body.access_token, expires: started + (body.expires_in - 60) * 1000 };
    })();
  }
  const flight = state.tokenFlight;
  try { state.token = await flight; return state.token.value; }
  finally { if (state.tokenFlight === flight) state.tokenFlight = undefined; }
}
async function snapshot(config: Configuration, state: State) {
  const started = Date.now();
  const deadline = started + 20_000;
  const bearer = await token(config, state, deadline);
  const headers = { Authorization: 'Bearer ' + bearer, Accept: 'application/json' };
  const appUrl = new URL(`/v1.0/servicePrincipals(appId='${config.clientId}')`, GRAPH);
  appUrl.searchParams.set('$select', 'id,appId,appRoleAssignmentRequired');
  const app = await json(appUrl, { headers }, deadline);
  if (entraGuid(app.appId) !== config.clientId || app.appRoleAssignmentRequired !== true) throw unavailable();
  const resourceId = entraGuid(app.id), path = `/v1.0/servicePrincipals/${resourceId}/appRoleAssignedTo`;
  let page: URL | undefined = new URL(path, GRAPH);
  page.searchParams.set('$select', 'principalId,principalType,resourceId');
  const visited = new Set<string>(), users = new Set<string>();
  for (let count = 0; page; count++) {
    // Never send an app credential to an arbitrary nextLink or follow redirects.
    if (count >= MAX_PAGES || visited.has(page.href) || page.origin !== GRAPH || page.pathname !== path || page.username || page.password || page.hash) throw unavailable();
    visited.add(page.href);
    const body = await json(page, { headers }, deadline);
    if (!Array.isArray(body.value)) throw unavailable();
    for (const value of body.value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
      const row = value as Record<string, unknown>;
      if (entraGuid(row.resourceId) !== resourceId || !['User','Group','ServicePrincipal'].includes(String(row.principalType))) throw unavailable();
      const id = entraGuid(row.principalId);
      // Individual attribution only. No inferred membership or directory admin bypass.
      if (row.principalType === 'User') users.add(id);
    }
    const next = body['@odata.nextLink'];
    if (next !== undefined && (typeof next !== 'string' || !next || next.length > 10000)) throw unavailable();
    page = typeof next === 'string' ? new URL(next) : undefined;
  }
  return { users, expires: started + ENTRA_ASSIGNMENT_CACHE_MS };
}
export async function entraAssigned(config: Configuration, object: string, fresh = false) {
  if (config.accessMode !== 'assignment') throw unavailable();
  const objectId = entraGuid(object), state = stateFor(config);
  if (!fresh && state.snapshot && state.snapshot.expires > Date.now()) return state.snapshot.users.has(objectId);
  if (state.retryAfter && state.retryAfter > Date.now()) throw unavailable();
  if (!state.flight) state.flight = snapshot(config, state);
  const flight = state.flight;
  try {
    const result = await flight;
    // Slow paginated responses must not grant access from an expired observation.
    if (result.expires <= Date.now()) throw unavailable();
    state.snapshot = result;
    state.retryAfter = undefined;
    return result.users.has(objectId);
  } catch {
    state.snapshot = undefined;
    state.token = undefined;
    state.retryAfter = Date.now() + 5_000;
    throw unavailable(); // Never leak provider responses, tokens or secrets.
  } finally { if (state.flight === flight) state.flight = undefined; }
}
