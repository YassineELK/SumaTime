import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dataPath, sqlite } from '@/db/raw';
import { AuthError } from '@/lib/auth';

type Config = { api: string; web: string; appToken: string };
export type GlpiTicket = { id: number; title: string; status: number; entity: number; url: string; client_id: string | null; client: string | null };
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
async function request(config: Config, path: string, headers: Record<string, string>, signal: AbortSignal) {
  try {
    const response = await fetch(config.api + '/' + path, { headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(config.appToken ? { 'App-Token': config.appToken } : {}), ...headers }, signal, redirect: 'error', cache: 'no-store' });
    if (!response.ok) { await response.body?.cancel(); throw new AuthError(response.status === 401 || response.status === 403 ? 'GLPI refuse cet accès. Vérifiez votre jeton, vos droits et la configuration API.' : 'GLPI est indisponible. Réessayez dans quelques instants.', 502); }
    const reader = response.body?.getReader(); if (!reader) throw new Error('Empty');
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > 2_000_000) { await reader.cancel(); throw new Error('Large'); } chunks.push(part.value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) { if (error instanceof AuthError) throw error; throw new AuthError('Impossible de joindre GLPI. Vérifiez la connexion et les certificats du serveur.', 502); }
}
async function session<T>(config: Config, token: string, work: (get: (path: string) => Promise<any>) => Promise<T>) {
  const signal = AbortSignal.timeout(15000);
  const auth = await request(config, 'initSession', { Authorization: 'user_token ' + token }, signal);
  if (typeof auth.session_token !== 'string' || !auth.session_token) throw new AuthError('GLPI n’a pas ouvert de session valide.', 502);
  const headers = { 'Session-Token': auth.session_token };
  try { return await work(path => request(config, path, headers, signal)); }
  finally { try { await request(config, 'killSession', headers, AbortSignal.timeout(2000)); } catch {} }
}
export async function testGlpiToken(config: Config, token: string) { await session(config, token, async get => { await get('getMyProfiles'); }); }
export async function glpiTickets(member: string, config: Config, query: string, page: number, open: boolean) {
  return session(config, tokenFor(member, config), async get => {
    const options = await get('listSearchOptions/Ticket');
    const field = (name: string) => Object.entries(options).find(([, value]) => value && typeof value === 'object' && (value as any).table === 'glpi_tickets' && (value as any).field === name)?.[0];
    const idField = field('id'), nameField = field('name'), statusField = field('status');
    if (!idField || !nameField || !statusField) throw new AuthError('Les champs de recherche GLPI sont incompatibles avec ce connecteur.', 502);
    const params = new URLSearchParams({ range: `${page * 10}-${page * 10 + 9}`, sort: idField, order: 'DESC', 'forcedisplay[0]': idField, rawdata: 'false', uid_cols: 'false', giveItems: 'false' });
    let index = 0;
    if (query) { params.set(`criteria[${index}][field]`, /^\d+$/.test(query) ? idField : nameField); params.set(`criteria[${index}][searchtype]`, 'contains'); params.set(`criteria[${index}][value]`, /^\d+$/.test(query) ? '^' + query + '$' : query); index++; }
    if (open) { params.set(`criteria[${index}][link]`, 'AND'); params.set(`criteria[${index}][field]`, statusField); params.set(`criteria[${index}][searchtype]`, 'equals'); params.set(`criteria[${index}][value]`, 'notold'); }
    const result = await get('search/Ticket?' + params);
    if (!Number.isFinite(Number(result.totalcount)) || !result.data || typeof result.data !== 'object') throw new AuthError('La réponse de GLPI est inattendue.', 502);
    const ids = [...new Set(Object.values(result.data).map((row: any) => Number(row[idField])).filter(id => Number.isSafeInteger(id) && id > 0))].slice(0, 10);
    const tickets: GlpiTicket[] = [];
    // A small sequential page avoids sharing a PHP session across concurrent requests.
    for (const id of ids) {
      const ticket = await get('Ticket/' + id);
      if (Number(ticket.id) !== id || typeof ticket.name !== 'string') throw new AuthError('GLPI a renvoyé un ticket invalide.', 502);
      const client = sqlite().prepare('SELECT id,name FROM clients WHERE glpi_entity_id=? AND active=1').get(Number(ticket.entities_id)) as { id: string; name: string } | undefined;
      tickets.push({ id, title: ticket.name.slice(0, 1000), status: Number(ticket.status), entity: Number(ticket.entities_id), url: config.web + '/front/ticket.form.php?id=' + id, client_id: client?.id || null, client: client?.name || null });
    }
    return { tickets, total: Number(result.totalcount), page };
  });
}
