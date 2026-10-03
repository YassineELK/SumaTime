import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dataPath, sqlite } from '@/db/raw';
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
export class GlpiCreationUncertain extends AuthError {
  constructor(public readonly operation?: GlpiCreationOperation) { super('La création est en cours ou son résultat est incertain. Vérifiez vos tickets dans GLPI avant toute nouvelle demande ; cette demande ne sera pas renvoyée automatiquement.', 409); }
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
type CreationRow = { request_id: string; member_id: string; api_url: string; payload_hash: string; payload_json: string | null; result_json: string | null; acknowledged_at: string | null; created_at: string };
function operationFromRow(row: Pick<CreationRow, 'payload_json' | 'result_json' | 'created_at'>): GlpiCreationOperation {
  const parsed: unknown = row.payload_json ? JSON.parse(row.payload_json) : null;
  const ticket = row.result_json ? storedTicket(JSON.parse(row.result_json)) : undefined;
  return { payload: createInput(parsed), createdAt: row.created_at, ...(ticket ? { ticket } : {}) };
}
export function glpiUncertainRequests(member: string, apiUrl?: string) {
 const db=sqlite();
  const mismatched = apiUrl && db.prepare('SELECT 1 FROM glpi_creations WHERE member_id=? AND api_url<>? AND acknowledged_at IS NULL LIMIT 1').get(member, apiUrl);
  const rows = (apiUrl
   ? db.prepare('SELECT request_id,member_id,api_url,payload_hash,payload_json,result_json,acknowledged_at,created_at FROM glpi_creations WHERE member_id=? AND api_url=? AND acknowledged_at IS NULL ORDER BY created_at DESC LIMIT 20').all(member, apiUrl)
   : db.prepare('SELECT request_id,member_id,api_url,payload_hash,payload_json,result_json,acknowledged_at,created_at FROM glpi_creations WHERE member_id=? AND acknowledged_at IS NULL ORDER BY created_at DESC LIMIT 20').all(member)) as CreationRow[];
 let blocked = !!mismatched;
 const requests: GlpiUncertainRequest[] = [];
 for (const row of rows) {
  try {
   requests.push(operationFromRow(row));
  } catch { blocked = true; }
 }
 return { requests, blocked };
}
export function acknowledgeGlpiCreation(member: string, apiUrl: string | undefined, requestId: string, ticketId?: number) {
 const db=sqlite();
 const row = (apiUrl
  ? db.prepare('SELECT result_json FROM glpi_creations WHERE request_id=? AND member_id=? AND api_url=?').get(requestId,member,apiUrl)
  : db.prepare('SELECT result_json FROM glpi_creations WHERE request_id=? AND member_id=?').get(requestId,member)) as { result_json: string | null } | undefined;
 // Acknowledge is intentionally not an acknowledgement of receipt of the
 // request.  It is only valid after the server has a validated ticket result
 // and the caller proves which ticket the user explicitly consumed.
 if (!row?.result_json || !Number.isSafeInteger(ticketId)) return false;
 let ticket: GlpiTicket;
 try { ticket = storedTicket(JSON.parse(row.result_json)); } catch { return false; }
 if (ticket.id !== ticketId) return false;
 const result = apiUrl
  ? db.prepare('UPDATE glpi_creations SET acknowledged_at=? WHERE request_id=? AND member_id=? AND api_url=? AND acknowledged_at IS NULL').run(new Date().toISOString(),requestId,member,apiUrl)
  : db.prepare('UPDATE glpi_creations SET acknowledged_at=? WHERE request_id=? AND member_id=? AND acknowledged_at IS NULL').run(new Date().toISOString(),requestId,member);
 return result.changes > 0;
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
export async function createGlpiTicket(member:string,config:Config,rawInput:unknown):Promise<GlpiCreateResult> {
 if(!glpiWriteEnabled())throw new AuthError('La création GLPI est désactivée dans cet environnement.',403);
 const input = createInput(rawInput);
 const db=sqlite();
 const fingerprint=creationFingerprint(input);
 const payloadJson=JSON.stringify(input);
 const reserved=db.prepare('INSERT OR IGNORE INTO glpi_creations (request_id,member_id,api_url,payload_hash,payload_json,result_json,acknowledged_at,created_at) VALUES (?,?,?,?,?,NULL,NULL,?)').run(input.request_id,member,config.api,fingerprint,payloadJson,new Date().toISOString());
 if(!reserved.changes){
  const byRequest = db.prepare('SELECT request_id,member_id,api_url,payload_hash,payload_json,result_json,acknowledged_at,created_at FROM glpi_creations WHERE request_id=?').get(input.request_id) as CreationRow | undefined;
  if (byRequest && (byRequest.member_id !== member || byRequest.api_url !== config.api || byRequest.payload_hash !== fingerprint)) throw new AuthError('Cette demande a changé. Ouvrez un nouveau formulaire.',409);
  const authoritative = byRequest || db.prepare(`SELECT request_id,member_id,api_url,payload_hash,payload_json,result_json,acknowledged_at,created_at
    FROM glpi_creations WHERE member_id=? AND api_url=? AND payload_hash=? AND payload_json IS NOT NULL
    ORDER BY CASE WHEN acknowledged_at IS NULL THEN 0 ELSE 1 END,created_at,request_id LIMIT 1`).get(member,config.api,fingerprint) as CreationRow | undefined;
  if (!authoritative?.payload_json) throw new AuthError('Cette demande ne peut pas être réconciliée. Ouvrez un nouveau formulaire.',409);
  const operation = operationFromRow(authoritative);
  if(operation.ticket)return { ticket: operation.ticket, operation };
  throw new GlpiCreationUncertain(operation);
 }
 let client;
 try { client = mappedClient(input.client_id); }
 catch (error) { db.prepare('DELETE FROM glpi_creations WHERE request_id=? AND member_id=? AND api_url=?').run(input.request_id,member,config.api); throw error; }
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
  db.prepare('UPDATE glpi_creations SET result_json=? WHERE request_id=? AND member_id=? AND api_url=? AND acknowledged_at IS NULL').run(JSON.stringify(ticket),input.request_id,member,config.api);
  return { ticket, operation: { payload: input, createdAt: String((db.prepare('SELECT created_at FROM glpi_creations WHERE request_id=?').get(input.request_id) as { created_at: string }).created_at), ticket } };
 }catch(e){
  if(!sent||e instanceof GlpiRejected){db.prepare('DELETE FROM glpi_creations WHERE request_id=? AND member_id=?').run(input.request_id,member);throw e;}
  // A timeout/error after POST may still have created a ticket. Never retry blindly.
  const row = db.prepare('SELECT payload_json,result_json,created_at FROM glpi_creations WHERE request_id=? AND member_id=? AND api_url=?').get(input.request_id,member,config.api) as Pick<CreationRow, 'payload_json'|'result_json'|'created_at'> | undefined;
  let operation: GlpiCreationOperation | undefined;
  try { if (row) operation = operationFromRow(row); } catch { operation = undefined; }
  throw new GlpiCreationUncertain(operation);
 }
}
