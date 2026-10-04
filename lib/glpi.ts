import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dataPath, sqlite, transaction } from '@/db/raw';
import { AuthError } from '@/lib/auth';

type Config = { api: string; web: string; appToken: string };
export type GlpiTicket = { id: number; title: string; status: number; entity: number; url: string; client_id: string | null; client: string | null };
type JsonObject = Record<string, unknown>;
type GlpiGet = (path: string) => Promise<unknown>;
type GlpiPost = (path: string, payload: unknown) => Promise<unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function objectOrThrow(value: unknown, message: string): JsonObject {
  const result = object(value);
  if (!result) throw new AuthError(message, 502);
  return result;
}

function integer(value: unknown): number | null {
  const result = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isSafeInteger(result) ? result : null;
}

export function glpiConfig(): Config | null {
  const value = process.env.GLPI_API_URL?.trim(); if (!value) return null;
  let url: URL; try { url = new URL(value); } catch { throw new AuthError('L’adresse GLPI configurée sur le serveur est invalide.', 503); }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new AuthError('GLPI exige une adresse HTTPS sans identifiants ni paramètres.', 503);
  const api = url.href.replace(/\/+$/, '');
  const web = api.replace(/\/(apirest\.php|api\.php\/v1)$/i, '');
  return { api, web, appToken: process.env.GLPI_APP_TOKEN?.trim() || '' };
}
function key(create = false) {
  sqlite(); const file = join(dirname(dataPath()), 'glpi-key');
  if (!existsSync(file) && create) { try { writeFileSync(file, randomBytes(32), { flag: 'wx', mode: 0o600 }); } catch (error) { if (!existsSync(file)) throw error; } }
  if (!existsSync(file)) throw new AuthError('La clé GLPI est absente. Reconnectez votre compte GLPI.', 409);
  const value = readFileSync(file); if (value.length !== 32) throw new AuthError('La clé GLPI est invalide. Contactez l’administrateur.', 503); return value;
}
export function saveGlpiToken(member: string, config: Config, token: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(true), iv);
  cipher.setAAD(Buffer.from(member + '\n' + config.api));
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const value = [iv, cipher.getAuthTag(), encrypted].map(x => x.toString('base64')).join('.');
  sqlite().prepare('INSERT INTO glpi_credentials VALUES (?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET api_url=excluded.api_url,encrypted_token=excluded.encrypted_token,updated_at=excluded.updated_at').run(member, config.api, value, new Date().toISOString());
}
export function hasGlpiToken(member: string, config: Config) { return !!sqlite().prepare('SELECT member_id FROM glpi_credentials WHERE member_id=? AND api_url=?').get(member, config.api); }
function tokenFor(member: string, config: Config) {
  const row = sqlite().prepare('SELECT encrypted_token FROM glpi_credentials WHERE member_id=? AND api_url=?').get(member, config.api) as { encrypted_token: string } | undefined;
  if (!row) throw new AuthError('Connectez votre compte GLPI pour consulter vos tickets.', 409);
  try {
    const [iv, tag, encrypted] = row.encrypted_token.split('.').map(x => Buffer.from(x, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', key(), iv); decipher.setAAD(Buffer.from(member + '\n' + config.api)); decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch { throw new AuthError('Votre connexion GLPI doit être renouvelée. Saisissez à nouveau votre jeton.', 409); }
}
class GlpiRejected extends AuthError {}
async function request(config: Config, path: string, headers: Record<string, string>, signal: AbortSignal, method: 'GET' | 'POST' = 'GET', payload?: unknown): Promise<unknown> {
  try {
    const response = await fetch(config.api + '/' + path, { method, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(config.appToken ? { 'App-Token': config.appToken } : {}), ...headers }, signal, redirect: 'error', cache: 'no-store' });
    if (!response.ok) { await response.body?.cancel(); if(method==='POST'&&path==='Ticket'&&[400,401,403,404,405,422].includes(response.status))throw new GlpiRejected('GLPI a refusé la création. Vérifiez vos droits, la catégorie et les champs obligatoires du modèle de ticket GLPI.',422); throw new AuthError(response.status === 401 || response.status === 403 ? 'GLPI refuse cet accès. Vérifiez votre jeton, vos droits et la configuration API.' : 'GLPI est indisponible. Réessayez dans quelques instants.', 502); }
    const reader = response.body?.getReader(); if (!reader) throw new Error('Empty');
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > 2_000_000) { await reader.cancel(); throw new Error('Large'); } chunks.push(part.value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) { if (error instanceof AuthError) throw error; throw new AuthError('Impossible de joindre GLPI. Vérifiez la connexion et les certificats du serveur.', 502); }
}
async function session<T>(config: Config, token: string, work: (get: GlpiGet, post: GlpiPost) => Promise<T>) {
  const signal = AbortSignal.timeout(15000);
  const auth = await request(config, 'initSession', { Authorization: 'user_token ' + token }, signal);
  const authObject = objectOrThrow(auth, 'GLPI n’a pas ouvert de session valide.');
  if (typeof authObject.session_token !== 'string' || !authObject.session_token) throw new AuthError('GLPI n’a pas ouvert de session valide.', 502);
  const headers = { 'Session-Token': authObject.session_token };
  try { return await work(path => request(config, path, headers, signal), (path, payload) => request(config, path, headers, signal, 'POST', payload)); }
  finally { try { await request(config, 'killSession', headers, AbortSignal.timeout(2000)); } catch {} }
}
export async function testGlpiToken(config: Config, token: string) { await session(config, token, async get => { await get('getMyProfiles'); }); }
export async function glpiTickets(member: string, config: Config, query: string, page: number, open: boolean) {
  return session(config, tokenFor(member, config), async get => {
    const options = objectOrThrow(await get('listSearchOptions/Ticket'), 'Les champs de recherche GLPI sont incompatibles avec ce connecteur.');
    const field = (name: string) => Object.entries(options).find(([, value]) => {
      const option = object(value);
      return option?.table === 'glpi_tickets' && option.field === name;
    })?.[0];
    const idField = field('id'), nameField = field('name'), statusField = field('status');
    if (!idField || !nameField || !statusField) throw new AuthError('Les champs de recherche GLPI sont incompatibles avec ce connecteur.', 502);
    const params = new URLSearchParams({ range: `${page * 10}-${page * 10 + 9}`, sort: idField, order: 'DESC', 'forcedisplay[0]': idField, rawdata: 'false', uid_cols: 'false', giveItems: 'false' });
    let index = 0;
    if (query) { params.set(`criteria[${index}][field]`, /^\d+$/.test(query) ? idField : nameField); params.set(`criteria[${index}][searchtype]`, 'contains'); params.set(`criteria[${index}][value]`, /^\d+$/.test(query) ? '^' + query + '$' : query); index++; }
    if (open) { params.set(`criteria[${index}][link]`, 'AND'); params.set(`criteria[${index}][field]`, statusField); params.set(`criteria[${index}][searchtype]`, 'equals'); params.set(`criteria[${index}][value]`, 'notold'); }
    const result = objectOrThrow(await get('search/Ticket?' + params), 'La réponse de GLPI est inattendue.');
    const total = integer(result.totalcount);
    const dataObject = object(result.data);
    const data = Array.isArray(result.data) ? result.data : dataObject ? Object.values(dataObject) : null;
    if (total === null || !data) throw new AuthError('La réponse de GLPI est inattendue.', 502);
    const idOption = object(options[idField]);
    const idName = typeof idOption?.field === 'string' ? idOption.field : 'id';
    const ids = [...new Set(data.map(row => {
      const value = object(row);
      return integer(value?.[idField] ?? value?.['Ticket.' + idName] ?? value?.['glpi_tickets.' + idName]);
    }).filter((id): id is number => id !== null && id > 0))].slice(0, 10);
    const tickets: GlpiTicket[] = [];
    // A small sequential page avoids sharing a PHP session across concurrent requests.
    for (const id of ids) {
      const ticket = objectOrThrow(await get('Ticket/' + id), 'GLPI a renvoyé un ticket invalide.');
      const ticketId = integer(ticket.id), status = integer(ticket.status), entity = integer(ticket.entities_id);
      if (ticketId !== id || typeof ticket.name !== 'string' || status === null || entity === null) throw new AuthError('GLPI a renvoyé un ticket invalide.', 502);
      const client = sqlite().prepare('SELECT id,name FROM clients WHERE glpi_entity_id=? AND active=1').get(entity) as { id: string; name: string } | undefined;
      tickets.push({ id, title: ticket.name.slice(0, 1000), status, entity, url: config.web + '/front/ticket.form.php?id=' + id, client_id: client?.id || null, client: client?.name || null });
    }
    return { tickets, total, page };
  });
}

export type GlpiCreateInput = { request_id: string; client_id: string; title: string; description: string; type: number; urgency: number; category: number };
export type GlpiCreationOperation = { payload: GlpiCreateInput; createdAt: string; ticket?: GlpiTicket };
export type GlpiUncertainRequest = GlpiCreationOperation;
export type GlpiCreateResult = { ticket: GlpiTicket; operation: GlpiCreationOperation };
export type GlpiLegacyRequest = { request_id: string; createdAt: string; apiUrl: string };
export type GlpiDistinctIntent = { intent_id: string; expiresAt: string };
export const GLPI_CREATION_RESULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const GLPI_DISTINCT_INTENT_TTL_MS = 10 * 60 * 1000;
export class GlpiCreationUncertain extends AuthError {
  constructor(public readonly operation?: GlpiCreationOperation) { super('La création est en cours ou son résultat est incertain. Vérifiez vos tickets dans GLPI avant toute nouvelle demande ; cette demande ne sera pas renvoyée automatiquement.', 409); }
}
export class GlpiDistinctRequired extends AuthError {
  constructor() { super('Une demande identique est déjà terminée. Utilisez explicitement « Commencer une nouvelle demande distincte » pour autoriser un nouvel incident.', 409); }
}
export function glpiWriteEnabled() { return process.env.GLPI_WRITE_ENABLED === 'true'; }
function createInput(value: unknown): GlpiCreateInput {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError('Vérifiez le client, le titre, la description et les options du ticket.');
 const input = value as Partial<GlpiCreateInput>;
 if(typeof input.request_id!=='string'||!/^[a-f0-9-]{36}$/.test(input.request_id)||typeof input.client_id!=='string'||!input.client_id.trim()||input.client_id.length>120||typeof input.title!=='string'||!input.title.trim()||input.title.length>250||typeof input.description!=='string'||!input.description.trim()||input.description.length>4000||![1,2].includes(input.type as number)||!Number.isInteger(input.urgency)||input.urgency!<1||input.urgency!>5||!Number.isSafeInteger(input.category)||input.category!<0)throw new AuthError('Vérifiez le client, le titre, la description et les options du ticket.');
 return { request_id: input.request_id, client_id: input.client_id.trim(), title: input.title.trim(), description: input.description.trim(), type: input.type as number, urgency: input.urgency as number, category: input.category as number };
}
function storedTicket(value: unknown): GlpiTicket {
 const input = object(value);
 const id = integer(input?.id), status = integer(input?.status), entity = integer(input?.entity);
 if (id === null || id <= 0 || status === null || entity === null || typeof input?.title !== 'string' || !input.title.trim() || input.title.length > 1000 || typeof input.url !== 'string' || !input.url || (input.client_id !== null && typeof input.client_id !== 'string') || (input.client !== null && typeof input.client !== 'string')) throw new GlpiCreationUncertain();
 return { id, title: input.title, status, entity, url: input.url, client_id: input.client_id as string | null, client: input.client as string | null };
}
function creationFingerprint(input: GlpiCreateInput) {
  return createHash('sha256').update(JSON.stringify([input.client_id, input.title, input.description, input.type, input.urgency, input.category])).digest('hex');
}
type CreationRow = { request_id: string; member_id: string; api_url: string; payload_hash: string; payload_json: string | null; result_json: string | null; acknowledged_at: string | null; expires_at: string | null; legacy_state: string | null; state: string | null; terminal_error: string | null; distinct_intent_id: string | null; created_at: string };
type AliasRow = { alias_request_id: string; operation_request_id: string; member_id: string; api_url: string; payload_hash: string; result_json: string | null; created_at: string; expires_at: string | null };
type DistinctIntentRow = { intent_id: string; member_id: string; api_url: string; scope_request_id: string | null; created_at: string; expires_at: string; used_at: string | null; used_request_id: string | null; used_payload_hash: string | null; operation_request_id: string | null };
const creationColumns = 'request_id,member_id,api_url,payload_hash,payload_json,result_json,acknowledged_at,expires_at,legacy_state,state,terminal_error,distinct_intent_id,created_at';
function operationFromRow(row: Pick<CreationRow, 'payload_json' | 'result_json' | 'created_at'>): GlpiCreationOperation {
  const parsed: unknown = row.payload_json ? JSON.parse(row.payload_json) : null;
  const ticket = row.result_json ? storedTicket(JSON.parse(row.result_json)) : undefined;
  return { payload: createInput(parsed), createdAt: row.created_at, ...(ticket ? { ticket } : {}) };
}
function resultExpiry(now = Date.now()) {
  return new Date(now + GLPI_CREATION_RESULT_TTL_MS).toISOString();
}
function cleanupCreationHistory(db: ReturnType<typeof sqlite>) {
  // Retention is a presentation concern, never an identity concern. Keeping
  // this hook explicit prevents a future cleanup job from deleting a UUID or
  // alias that a stale browser may replay after the nominal result TTL.
  void db;
}
function rowForRequest(db: ReturnType<typeof sqlite>, member: string, apiUrl: string | undefined, requestId: string) {
  const row = (apiUrl
    ? db.prepare(`SELECT ${creationColumns} FROM glpi_creations WHERE request_id=? AND member_id=? AND api_url=?`).get(requestId, member, apiUrl)
    : db.prepare(`SELECT ${creationColumns} FROM glpi_creations WHERE request_id=? AND member_id=?`).get(requestId, member)) as CreationRow | undefined;
  return row;
}
function aliasForRequest(db: ReturnType<typeof sqlite>, member: string, apiUrl: string | undefined, requestId: string) {
  const row = db.prepare('SELECT alias_request_id,operation_request_id,member_id,api_url,payload_hash,result_json,created_at,expires_at FROM glpi_creation_aliases WHERE alias_request_id=?').get(requestId) as AliasRow | undefined;
  if (row && (row.member_id !== member || (apiUrl !== undefined && row.api_url !== apiUrl))) return row;
  return row;
}

function operationError(row: CreationRow): never {
  if (row.terminal_error) throw new AuthError(row.terminal_error, 409);
  throw new AuthError('Cette opération GLPI est déjà terminée sans résultat récupérable. Ouvrez une nouvelle demande explicitement.', 409);
}

function verifyIntent(db: ReturnType<typeof sqlite>, member: string, apiUrl: string, intentId: string, requestId: string, fingerprint: string) {
  const intent = db.prepare(`SELECT intent_id,member_id,api_url,scope_request_id,created_at,expires_at,used_at,used_request_id,used_payload_hash,operation_request_id
    FROM glpi_creation_intents WHERE intent_id=?`).get(intentId) as DistinctIntentRow | undefined;
  if (!intent) throw new AuthError('L’intention de nouvelle demande est invalide ou inconnue.', 409);
  if (intent.member_id !== member || intent.api_url !== apiUrl) throw new AuthError('L’intention de nouvelle demande ne correspond pas à votre session GLPI.', 403);
  if (intent.used_at) {
    if (intent.used_request_id === requestId && intent.used_payload_hash === fingerprint) return { intent, reused: true };
    throw new AuthError('Cette intention de nouvelle demande a déjà été consommée.', 409);
  }
  if (Date.parse(intent.expires_at) <= Date.now()) throw new AuthError('L’intention de nouvelle demande a expiré. Recommencez explicitement.', 409);
  return { intent, reused: false };
}

function markIntentUsed(db: ReturnType<typeof sqlite>, intent: DistinctIntentRow, requestId: string, fingerprint: string, operationId: string) {
  if (intent.used_at) {
    if (intent.used_request_id !== requestId || intent.used_payload_hash !== fingerprint || intent.operation_request_id !== operationId) throw new AuthError('Cette intention de nouvelle demande a déjà été consommée.', 409);
    return;
  }
  const result = db.prepare(`UPDATE glpi_creation_intents
    SET used_at=?,used_request_id=?,used_payload_hash=?,operation_request_id=?
    WHERE intent_id=? AND used_at IS NULL`).run(new Date().toISOString(), requestId, fingerprint, operationId, intent.intent_id);
  if (!result.changes) throw new AuthError('Cette intention de nouvelle demande a déjà été consommée.', 409);
}

function intentIdFromInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = (value as { distinct_intent?: unknown }).distinct_intent;
  if (candidate === undefined) return undefined;
  if (typeof candidate !== 'string' || !/^[a-f0-9]{64}$/.test(candidate)) throw new AuthError('L’intention de nouvelle demande est invalide.', 400);
  return candidate;
}
export function glpiUncertainRequests(member: string, apiUrl?: string, includeAcknowledged = false) {
 const db=sqlite();
 cleanupCreationHistory(db);
  const mismatched = apiUrl && db.prepare(`SELECT 1 FROM glpi_creations WHERE member_id=? AND api_url<>?
    AND acknowledged_at IS NULL AND state IN ('active','uncertain','completed') LIMIT 1`).get(member, apiUrl);
  const rows = (apiUrl
   ? db.prepare(`SELECT ${creationColumns} FROM glpi_creations WHERE member_id=? AND api_url=?
       AND acknowledged_at IS NULL AND state IN ('active','uncertain','completed')
       ORDER BY created_at DESC LIMIT 20`).all(member, apiUrl)
   : db.prepare(`SELECT ${creationColumns} FROM glpi_creations WHERE member_id=?
       AND acknowledged_at IS NULL AND state IN ('active','uncertain','completed')
       ORDER BY created_at DESC LIMIT 20`).all(member)) as CreationRow[];
  // Keep legacy blockers visible even when the configured GLPI URL changed;
  // otherwise the member would see a permanent block with no safe action.
  const legacyRows = db.prepare(`SELECT request_id,api_url,created_at FROM glpi_creations WHERE member_id=?
    AND payload_json IS NULL AND result_json IS NULL AND acknowledged_at IS NULL
    AND COALESCE(legacy_state,'pending')='pending' ORDER BY created_at DESC LIMIT 20`).all(member) as { request_id: string; api_url: string; created_at: string }[];
 let blocked = !!mismatched || legacyRows.length > 0;
 const requests: GlpiUncertainRequest[] = [];
 for (const row of rows) {
  try {
   if (row.payload_json) requests.push(operationFromRow(row));
   else blocked = true;
  } catch { blocked = true; }
 }
 const legacy = legacyRows.map(row => ({ request_id: row.request_id, createdAt: row.created_at, apiUrl: row.api_url }));
 const response: { requests: GlpiUncertainRequest[]; blocked: boolean; legacy?: GlpiLegacyRequest[]; recoverable?: GlpiUncertainRequest[] } = { requests, blocked };
 if (legacy.length) response.legacy = legacy;
 if (includeAcknowledged) {
   const acknowledgedRows = (apiUrl
     ? db.prepare(`SELECT ${creationColumns} FROM glpi_creations WHERE member_id=? AND api_url=?
       AND acknowledged_at IS NOT NULL AND result_json IS NOT NULL AND payload_json IS NOT NULL
       AND expires_at>? ORDER BY acknowledged_at DESC LIMIT 20`).all(member, apiUrl, new Date().toISOString())
     : db.prepare(`SELECT ${creationColumns} FROM glpi_creations WHERE member_id=?
       AND acknowledged_at IS NOT NULL AND result_json IS NOT NULL AND payload_json IS NOT NULL
       AND expires_at>? ORDER BY acknowledged_at DESC LIMIT 20`).all(member, new Date().toISOString())) as CreationRow[];
   const recoverable: GlpiUncertainRequest[] = [];
   for (const row of acknowledgedRows) {
     try { recoverable.push(operationFromRow(row)); } catch { blocked = true; }
   }
   response.recoverable = recoverable;
 }
 response.blocked = blocked;
 return response;
}
export type GlpiAcknowledgeResult = { ok: boolean; ticket?: GlpiTicket };
export function acknowledgeGlpiCreationResult(member: string, apiUrl: string | undefined, requestId: string, ticketId?: number): GlpiAcknowledgeResult {
  if (!Number.isSafeInteger(ticketId)) return { ok: false };
  return transaction(db => {
    cleanupCreationHistory(db);
    const alias = aliasForRequest(db, member, apiUrl, requestId);
    if (alias && (alias.member_id !== member || (apiUrl !== undefined && alias.api_url !== apiUrl))) return { ok: false };
    const operationId = alias?.operation_request_id || requestId;
    const row = rowForRequest(db, member, apiUrl, operationId);
    if (!row?.result_json) return { ok: false };
    let ticket: GlpiTicket;
    try { ticket = storedTicket(JSON.parse(row.result_json)); } catch { return { ok: false }; }
    if (ticket.id !== ticketId) return { ok: false };
    // Idempotence is deliberate: a committed ACK is a successful retry, not
    // an error merely because the first HTTP response vanished in transit.
    if (!row.acknowledged_at) {
      const acknowledgedAt = new Date().toISOString();
      const expiresAt = resultExpiry();
      db.prepare("UPDATE glpi_creations SET acknowledged_at=?,expires_at=?,state='acknowledged' WHERE request_id=? AND member_id=? AND api_url=? AND acknowledged_at IS NULL").run(acknowledgedAt, expiresAt, row.request_id, member, row.api_url);
      db.prepare('UPDATE glpi_creation_aliases SET result_json=?,expires_at=? WHERE operation_request_id=? AND member_id=? AND api_url=?').run(row.result_json, expiresAt, row.request_id, member, row.api_url);
    }
    return { ok: true, ticket };
  });
}
export function acknowledgeGlpiCreation(member: string, apiUrl: string | undefined, requestId: string, ticketId?: number) {
  return acknowledgeGlpiCreationResult(member, apiUrl, requestId, ticketId).ok;
}
export type GlpiLegacyResolution = { ok: true; resolution: 'abandoned' | 'recovered'; operation?: GlpiCreationOperation };
export function resolveLegacyCreation(member: string, apiUrl: string | undefined, requestId: string, resolution: 'abandon' | 'recover', rawPayload?: unknown, rawTicket?: unknown): GlpiLegacyResolution {
  return transaction(db => {
    const row = rowForRequest(db, member, apiUrl, requestId);
    if (!row || row.payload_json !== null || row.result_json !== null || row.acknowledged_at !== null || row.legacy_state !== 'pending') throw new AuthError('Cette opération historique n’est plus en attente de résolution.', 409);
    if (resolution === 'abandon') {
      const at = new Date().toISOString();
      db.prepare("UPDATE glpi_creations SET legacy_state='abandoned',state='abandoned',acknowledged_at=?,expires_at=NULL WHERE request_id=? AND member_id=?").run(at, row.request_id, member);
      return { ok: true, resolution: 'abandoned' };
    }
    if (!rawPayload || !rawTicket) throw new AuthError('Fournissez le payload et le ticket vérifiés dans GLPI pour récupérer cette opération.', 400);
    const input = createInput(rawPayload);
    if (input.request_id !== row.request_id || creationFingerprint(input) !== row.payload_hash) throw new AuthError('La preuve fournie ne correspond pas à l’opération historique.', 409);
    const ticket = storedTicket(rawTicket);
    const resultJson = JSON.stringify(ticket);
    db.prepare("UPDATE glpi_creations SET payload_json=?,result_json=?,legacy_state='recovered',state='completed',acknowledged_at=NULL,expires_at=NULL WHERE request_id=? AND member_id=?").run(JSON.stringify(input), resultJson, row.request_id, member);
    db.prepare(`INSERT OR IGNORE INTO glpi_creation_aliases
      (alias_request_id,operation_request_id,member_id,api_url,payload_hash,result_json,created_at,expires_at)
      VALUES (?,?,?,?,?,?,?,NULL)`).run(row.request_id, row.request_id, member, row.api_url, row.payload_hash, resultJson, row.created_at);
    db.prepare(`UPDATE glpi_creation_aliases SET operation_request_id=?,result_json=?,expires_at=NULL
      WHERE alias_request_id=? AND member_id=? AND api_url=?`).run(row.request_id, resultJson, row.request_id, member, row.api_url);
    return { ok: true, resolution: 'recovered', operation: { payload: input, createdAt: row.created_at, ticket } };
  });
}
function mappedClient(id: string) {
 const client=sqlite().prepare('SELECT id,name,glpi_entity_id FROM clients WHERE id=? AND active=1').get(id) as {id:string;name:string;glpi_entity_id:number|null}|undefined;
 if(!client||client.glpi_entity_id===null)throw new AuthError('Associez ce client actif à son entité GLPI avant de créer un ticket.',409);
 return client as GlpiClient;
}
type GlpiClient = { id: string; name: string; glpi_entity_id: number };
async function selectEntity(get: GlpiGet, post: GlpiPost, entity: number) {
 const permitted = objectOrThrow(await get('getMyEntities?is_recursive=true'), 'GLPI n’a pas renvoyé vos entités accessibles.');
 if (!Array.isArray(permitted.myentities) || !permitted.myentities.some(value => integer(object(value)?.id) === entity)) throw new AuthError('Votre compte GLPI ne donne pas accès à cette entité client.', 403);
 const selected = await post('changeActiveEntities', { entities_id: entity, is_recursive: false });
 if (selected !== true) throw new AuthError('GLPI n’a pas pu sélectionner le contexte d’entité du client. Aucune création ne sera envoyée.', 502);
}
export async function glpiCreationOptions(member:string,config:Config,clientId:string) {
 if(!glpiWriteEnabled())throw new AuthError('La création GLPI est désactivée dans cet environnement.',403);
 const client=mappedClient(clientId);
 return session(config,tokenFor(member,config),async(get,post)=>{
  await selectEntity(get,post,client.glpi_entity_id);
  const categories = await get('ITILCategory?range=0-499');
  if (!Array.isArray(categories)) throw new AuthError('Les catégories GLPI sont indisponibles.', 502);
  return {
    categories: categories.flatMap(value => {
      const category = object(value), id = integer(category?.id), name = typeof category?.completename === 'string' ? category.completename : category?.name;
      return id !== null && id > 0 && typeof name === 'string' ? [{ id, name: name.slice(0, 250) }] : [];
    }),
    limited: categories.length >= 500,
  };
 });
}

/**
 * Issue a server-owned capability for the one UI action that intentionally
 * starts a second operation with the same business fingerprint. The caller's
 * session and configured GLPI URL are recorded in the database; the random
 * value is not a client assertion and is consumed atomically by the first
 * reservation that presents it.
 */
export function beginGlpiDistinctCreation(member: string, config: Config, scopeRequestId?: string): GlpiDistinctIntent {
  return transaction(db => {
    if (scopeRequestId) {
      const alias = aliasForRequest(db, member, config.api, scopeRequestId);
      const scoped = alias?.member_id === member && alias.api_url === config.api
        ? rowForRequest(db, member, config.api, alias.operation_request_id)
        : rowForRequest(db, member, config.api, scopeRequestId);
      if (!scoped) throw new AuthError('La demande d’origine de cette nouvelle intention est inconnue.', 409);
    }
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + GLPI_DISTINCT_INTENT_TTL_MS).toISOString();
    let intentId = randomBytes(32).toString('hex');
    while (db.prepare('SELECT 1 FROM glpi_creation_intents WHERE intent_id=?').get(intentId)) intentId = randomBytes(32).toString('hex');
    db.prepare(`INSERT INTO glpi_creation_intents
      (intent_id,member_id,api_url,scope_request_id,created_at,expires_at,used_at,used_request_id,used_payload_hash,operation_request_id)
      VALUES (?,?,?,?,?,?,NULL,NULL,NULL,NULL)`).run(intentId, member, config.api, scopeRequestId || null, createdAt, expiresAt);
    return { intent_id: intentId, expiresAt };
  });
}

function linkCreationAlias(db: ReturnType<typeof sqlite>, input: GlpiCreateInput, operation: CreationRow) {
  const existing = db.prepare('SELECT operation_request_id,member_id,api_url,payload_hash FROM glpi_creation_aliases WHERE alias_request_id=?').get(input.request_id) as { operation_request_id: string; member_id: string; api_url: string; payload_hash: string } | undefined;
  if (existing && (existing.member_id !== operation.member_id || existing.api_url !== operation.api_url || existing.payload_hash !== creationFingerprint(input) || existing.operation_request_id !== operation.request_id)) throw new AuthError('Cette demande a changé. Ouvrez un nouveau formulaire.', 409);
  if (existing) return;
  db.prepare(`INSERT OR IGNORE INTO glpi_creation_aliases
    (alias_request_id,operation_request_id,member_id,api_url,payload_hash,result_json,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(input.request_id, operation.request_id, operation.member_id, operation.api_url, operation.payload_hash, operation.result_json, operation.created_at, operation.expires_at);
}
function authoritativeCreation(db: ReturnType<typeof sqlite>, member: string, apiUrl: string, fingerprint: string) {
  return db.prepare(`SELECT ${creationColumns} FROM glpi_creations
    WHERE member_id=? AND api_url=? AND payload_hash=? AND payload_json IS NOT NULL
      AND result_json IS NULL AND state IN ('active','uncertain')
    ORDER BY CASE WHEN distinct_intent_id IS NULL THEN 0 ELSE 1 END,created_at,request_id LIMIT 1`).get(member, apiUrl, fingerprint) as CreationRow | undefined;
}
function terminalCreation(db: ReturnType<typeof sqlite>, member: string, apiUrl: string, fingerprint: string) {
  // A rejected reservation is still a permanent UUID tombstone, but it did
  // not establish a provider ticket. It must not block a later, independently
  // authorized attempt merely because its business fingerprint is identical.
  return db.prepare(`SELECT ${creationColumns} FROM glpi_creations
    WHERE member_id=? AND api_url=? AND payload_hash=? AND payload_json IS NOT NULL
      AND result_json IS NOT NULL AND state IN ('completed','acknowledged')
    ORDER BY created_at,request_id LIMIT 1`).get(member, apiUrl, fingerprint) as CreationRow | undefined;
}
export async function createGlpiTicket(member:string,config:Config,rawInput:unknown):Promise<GlpiCreateResult> {
 if(!glpiWriteEnabled())throw new AuthError('La création GLPI est désactivée dans cet environnement.',403);
 const input = createInput(rawInput);
 const distinctIntentId = intentIdFromInput(rawInput);
 const fingerprint=creationFingerprint(input);
 const payloadJson=JSON.stringify(input);
 const reservation = transaction(db => {
   cleanupCreationHistory(db);
   const alias = aliasForRequest(db, member, config.api, input.request_id);
   if (alias && (alias.member_id !== member || alias.api_url !== config.api || alias.payload_hash !== fingerprint)) throw new AuthError('Cette demande a changé. Ouvrez un nouveau formulaire.', 409);
   const globalByRequest = db.prepare(`SELECT member_id,api_url,payload_hash FROM glpi_creations WHERE request_id=?`).get(input.request_id) as { member_id: string; api_url: string; payload_hash: string } | undefined;
   if (globalByRequest && (globalByRequest.member_id !== member || globalByRequest.api_url !== config.api || globalByRequest.payload_hash !== fingerprint)) throw new AuthError('Cette demande a changé. Ouvrez un nouveau formulaire.',409);
   const byRequest = rowForRequest(db, member, config.api, input.request_id);
   if (byRequest && byRequest.payload_hash !== fingerprint) throw new AuthError('Cette demande a changé. Ouvrez un nouveau formulaire.', 409);
   if (alias) {
     const aliased = rowForRequest(db, member, config.api, alias.operation_request_id);
     if (!aliased?.payload_json || aliased.payload_hash !== fingerprint) throw new AuthError('Cette identité GLPI est connue mais son opération associée est absente ou incohérente. Aucun nouveau ticket ne sera envoyé.', 409);
     return { row: aliased, reserved: false };
   }
   if (byRequest) {
     return { row: byRequest, reserved: false };
   }
   const legacy = db.prepare(`SELECT request_id FROM glpi_creations WHERE member_id=?
     AND payload_json IS NULL AND result_json IS NULL AND acknowledged_at IS NULL
     AND COALESCE(legacy_state,'pending')='pending' LIMIT 1`).get(member);
   if (legacy) throw new AuthError('Une opération GLPI historique reste indécise. Vérifiez GLPI puis abandonnez-la explicitement ou récupérez-la avec une preuve avant toute nouvelle création.', 409);
   const intent = distinctIntentId ? verifyIntent(db, member, config.api, distinctIntentId, input.request_id, fingerprint) : undefined;
   if (intent?.reused) throw new AuthError('L’intention consommée ne possède plus de réservation durable. Aucun nouveau ticket ne sera envoyé.', 409);
   if (!intent) {
     const existing = authoritativeCreation(db, member, config.api, fingerprint);
     if (existing) {
       linkCreationAlias(db, input, existing);
       return { row: existing, reserved: false };
     }
    if (terminalCreation(db, member, config.api, fingerprint)) throw new GlpiDistinctRequired();
   }
   const createdAt = new Date().toISOString();
   const reserved = db.prepare(`INSERT OR IGNORE INTO glpi_creations
     (request_id,member_id,api_url,payload_hash,payload_json,result_json,acknowledged_at,expires_at,legacy_state,state,terminal_error,distinct_intent_id,created_at)
     VALUES (?,?,?,?,?,NULL,NULL,NULL,'active','active',NULL,?,?)`).run(input.request_id, member, config.api, fingerprint, payloadJson, distinctIntentId || null, createdAt);
   if (reserved.changes) {
     const row = db.prepare(`SELECT ${creationColumns} FROM glpi_creations WHERE request_id=? AND member_id=? AND api_url=?`).get(input.request_id, member, config.api) as CreationRow | undefined;
     if (!row) throw new AuthError('La réservation GLPI n’a pas pu être conservée. Réessayez après vérification.', 503);
     if (intent) markIntentUsed(db, intent.intent, input.request_id, fingerprint, row.request_id);
     linkCreationAlias(db, input, row);
     return { row, reserved: true };
   }
   const winner = authoritativeCreation(db, member, config.api, fingerprint);
   if (!winner?.payload_json) throw new AuthError('Cette demande ne peut pas être réconciliée. Ouvrez un nouveau formulaire après vérification.', 409);
   linkCreationAlias(db, input, winner);
   return { row: winner, reserved: false };
 });
 if(!reservation.reserved){
  if (!reservation.row.payload_json) throw new AuthError('Cette demande ne peut pas être réconciliée. Résolvez l’opération historique explicitement.', 409);
  const operation = operationFromRow(reservation.row);
  if(operation.ticket)return { ticket: operation.ticket, operation };
  if (reservation.row.state === 'rejected' || reservation.row.state === 'superseded' || reservation.row.state === 'abandoned') operationError(reservation.row);
  throw new GlpiCreationUncertain(operation);
 }
 const db=sqlite();
 let client;
 const markCreation = (state: 'rejected' | 'uncertain', error?: unknown) => transaction(database => {
   const message = error instanceof Error ? error.message : null;
   database.prepare('UPDATE glpi_creations SET state=?,legacy_state=?,terminal_error=? WHERE request_id=? AND member_id=? AND api_url=?').run(state, state, message, input.request_id, member, config.api);
 });
 try { client = mappedClient(input.client_id); }
 catch (error) { markCreation('rejected', error); throw error; }
 let sent=false;
 try{
  const ticket = await session(config,tokenFor(member,config),async(get,post)=>{
   await selectEntity(get,post,client.glpi_entity_id);
   // GLPI applies the personal user's create permissions and ticket templates.
   const escaped=input.description.trim().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\n','<br>');
   sent=true;
   const result = object(await post('Ticket', { input: { name: input.title.trim(), content: escaped, entities_id: client.glpi_entity_id, type: input.type, urgency: input.urgency, itilcategories_id: input.category } }));
   const id = integer(result?.id); if (id === null || id <= 0) throw new GlpiCreationUncertain();
   const ticket:GlpiTicket={id,title:input.title.trim(),status:1,entity:client.glpi_entity_id,url:config.web+'/front/ticket.form.php?id='+id,client_id:client.id,client:client.name};
   return ticket;
  });
  const operation = transaction(database => {
    const resultJson = JSON.stringify(ticket);
    database.prepare("UPDATE glpi_creations SET result_json=?,state='completed',legacy_state='completed',terminal_error=NULL WHERE request_id=? AND member_id=? AND api_url=? AND acknowledged_at IS NULL").run(resultJson,input.request_id,member,config.api);
    database.prepare('UPDATE glpi_creation_aliases SET result_json=? WHERE operation_request_id=? AND member_id=? AND api_url=?').run(resultJson,input.request_id,member,config.api);
    const row = database.prepare('SELECT created_at FROM glpi_creations WHERE request_id=? AND member_id=? AND api_url=?').get(input.request_id,member,config.api) as { created_at: string };
    return { payload: input, createdAt: String(row.created_at), ticket };
  });
  return { ticket, operation };
 }catch(e){
  if(!sent||e instanceof GlpiRejected){markCreation('rejected', e);throw e;}
  markCreation('uncertain');
  // A timeout/error after POST may still have created a ticket. Never retry blindly.
  const row = db.prepare('SELECT payload_json,result_json,created_at FROM glpi_creations WHERE request_id=? AND member_id=? AND api_url=?').get(input.request_id,member,config.api) as Pick<CreationRow, 'payload_json'|'result_json'|'created_at'> | undefined;
  let operation: GlpiCreationOperation | undefined;
  try { if (row) operation = operationFromRow(row); } catch { operation = undefined; }
  throw new GlpiCreationUncertain(operation);
 }
}
