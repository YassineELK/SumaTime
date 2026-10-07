const GUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function entraGuid(value: unknown) {
  if (typeof value !== 'string' || !GUID.test(value.trim())) throw new Error('Identifiant Microsoft non valide.');
  return value.trim().toLowerCase();
}
export function entraConfiguration() {
  if (process.env.ENTRA_ENABLED !== 'true') return null;
  const tenantId = entraGuid(process.env.ENTRA_TENANT_ID), clientId = entraGuid(process.env.ENTRA_CLIENT_ID);
  const secret = process.env.ENTRA_CLIENT_SECRET;
  if (!secret || secret.length > 4096) throw new Error('Credential Microsoft manquant.');
  const url = new URL(process.env.APP_URL || '');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) {
    throw new Error('APP_URL doit être une origine HTTPS, ou localhost en développement.');
  }
  const minutes = Number(process.env.ENTRA_SESSION_MINUTES || '60');
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 240) throw new Error('Durée de session Microsoft non valide.');
  const accessMode = process.env.ENTRA_ACCESS_MODE || 'manual';
  if (accessMode !== 'manual' && accessMode !== 'assignment') throw new Error('Mode d’accès Microsoft non valide.');
  const autoProvision = process.env.ENTRA_AUTO_PROVISION === 'true';
  if (autoProvision && accessMode !== 'assignment') throw new Error('La création automatique exige le contrôle des attributions Microsoft.');
  return { tenantId, clientId, secret, origin: url.origin, redirectUri: url.origin + '/api/auth/entra/callback',
    issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`, sessionSeconds: minutes * 60, autoProvision, accessMode };
}
export function entraStatus() {
  try { return entraConfiguration() ? 'ready' as const : 'disabled' as const; }
  catch { return 'incomplete' as const; }
}
