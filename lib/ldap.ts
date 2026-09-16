import { Client } from 'ldapts';
import { readFileSync } from 'node:fs';

export function ldapEnabled() { return process.env.LDAP_ENABLED === 'true'; }
export function escapeFilter(value: string) {
  return value.replace(/[\\*()\0]/g, char => '\\' + char.charCodeAt(0).toString(16).padStart(2, '0'));
}
type DirectoryClient = Pick<Client, 'startTLS' | 'bind' | 'search' | 'unbind'>;
export async function authenticateLdap(login: string, password: string, makeClient: (options: ConstructorParameters<typeof Client>[0]) => DirectoryClient = options => new Client(options)) {
  if (!ldapEnabled() || !password || password.length > 128) return false;
  const url = process.env.LDAP_URL || '';
  const startTLS = process.env.LDAP_STARTTLS === 'true';
  if (!url.startsWith('ldaps://') && !(url.startsWith('ldap://') && startTLS)) throw new Error('LDAP requires LDAPS or StartTLS');
  const base = process.env.LDAP_BASE_DN, bindDN = process.env.LDAP_BIND_DN, bindPassword = process.env.LDAP_BIND_PASSWORD;
  const template = process.env.LDAP_USER_FILTER || '(sAMAccountName={{username}})';
  if (!base || !bindDN || !bindPassword || !template.includes('{{username}}')) throw new Error('LDAP configuration incomplete');
  const tlsOptions = { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true, ...(process.env.LDAP_CA_FILE ? { ca: readFileSync(process.env.LDAP_CA_FILE) } : {}) };
  const client = makeClient({ url, timeout: 8000, connectTimeout: 5000, tlsOptions });
  try {
    if (startTLS && url.startsWith('ldap://')) await client.startTLS(tlsOptions);
    await client.bind(bindDN, bindPassword);
    const { searchEntries } = await client.search(base, { scope: 'sub', filter: template.replaceAll('{{username}}', escapeFilter(login)), sizeLimit: 2, attributes: ['dn'] });
    if (searchEntries.length !== 1) return false;
    await client.bind(searchEntries[0].dn, password);
    return true;
  } catch (error) {
    if ((error as { code?: number }).code === 49) return false;
    throw new Error('Directory authentication unavailable');
  } finally { await client.unbind().catch(() => undefined); }
}
