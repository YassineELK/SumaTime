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

export class GlpiCreationUncertain extends AuthError {
  constructor() { super('La création est en cours ou son résultat est incertain. Vérifiez vos tickets dans GLPI avant toute nouvelle demande ; cette demande ne sera pas renvoyée automatiquement.', 409); }
}
export function glpiWriteEnabled() { return process.env.GLPI_WRITE_ENABLED === 'true'; }
type CreateInput = { request_id: string; client_id: string; title: string; description: string; type: number; urgency: number; category: number };
function mappedClient(id: string) {
 const client=sqlite().prepare('SELECT id,name,glpi_entity_id FROM clients WHERE id=? AND active=1').get(id) as {id:string;name:string;glpi_entity_id:number|null}|undefined;
 if(!client||client.glpi_entity_id===null)throw new AuthError('Associez ce client actif à son entité GLPI avant de créer un ticket.',409);
 return client as {id:string;name:string;glpi_entity_id:number};
}
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
export async function createGlpiTicket(member:string,config:Config,input:CreateInput):Promise<GlpiTicket> {
 if(!glpiWriteEnabled())throw new AuthError('La création GLPI est désactivée dans cet environnement.',403);
 if(!input||typeof input.request_id!=='string'||!/^[a-f0-9-]{36}$/.test(input.request_id)||typeof input.client_id!=='string'||typeof input.title!=='string'||!input.title.trim()||input.title.length>250||typeof input.description!=='string'||!input.description.trim()||input.description.length>4000||![1,2].includes(input.type)||!Number.isInteger(input.urgency)||input.urgency<1||input.urgency>5||!Number.isSafeInteger(input.category)||input.category<0)throw new AuthError('Vérifiez le client, le titre, la description et les options du ticket.');
 const client=mappedClient(input.client_id), db=sqlite();
 const fingerprint=createHash('sha256').update(JSON.stringify([input.client_id,input.title.trim(),input.description.trim(),input.type,input.urgency,input.category])).digest('hex');
 const reserved=db.prepare('INSERT OR IGNORE INTO glpi_creations VALUES (?,?,?,?,NULL,?)').run(input.request_id,member,config.api,fingerprint,new Date().toISOString());
 if(!reserved.changes){
  const old=db.prepare('SELECT * FROM glpi_creations WHERE request_id=?').get(input.request_id);
  if(!old||old.member_id!==member||old.api_url!==config.api||old.payload_hash!==fingerprint)throw new AuthError('Cette demande a changé. Ouvrez un nouveau formulaire.',409);
  if(old.result_json)return JSON.parse(String(old.result_json));
  throw new GlpiCreationUncertain();
 }
 let sent=false;
 try{
  return await session(config,tokenFor(member,config),async(get,post)=>{
   await selectEntity(get,post,client.glpi_entity_id);
   // GLPI applies the personal user's create permissions and ticket templates.
   const escaped=input.description.trim().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\n','<br>');
   sent=true;
   const result = object(await post('Ticket', { input: { name: input.title.trim(), content: escaped, entities_id: client.glpi_entity_id, type: input.type, urgency: input.urgency, itilcategories_id: input.category } }));
   const id = integer(result?.id); if (id === null || id <= 0) throw new GlpiCreationUncertain();
   const ticket:GlpiTicket={id,title:input.title.trim(),status:1,entity:client.glpi_entity_id,url:config.web+'/front/ticket.form.php?id='+id,client_id:client.id,client:client.name};
   db.prepare('UPDATE glpi_creations SET result_json=? WHERE request_id=? AND member_id=?').run(JSON.stringify(ticket),input.request_id,member);
   return ticket;
  });
 }catch(e){
  if(!sent||e instanceof GlpiRejected){db.prepare('DELETE FROM glpi_creations WHERE request_id=? AND member_id=?').run(input.request_id,member);throw e;}
  // A timeout/error after POST may still have created a ticket. Never retry blindly.
  throw new GlpiCreationUncertain();
 }
}
