import { getMember, checkOrigin, AuthError, rateLimit } from '@/lib/auth';
import { sqlite } from '@/db/raw';
import { acknowledgeGlpiCreationResult, beginGlpiDistinctCreation, createGlpiTicket, glpiCreationOptions, glpiWriteEnabled, GlpiCreationTerminal, GlpiCreationUncertain, GlpiDistinctRequired, glpiConfig, glpiUncertainRequests, hasGlpiToken, glpiTickets, resolveLegacyCreation, saveGlpiToken, testGlpiToken } from '@/lib/glpi';
export const dynamic = 'force-dynamic';
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
async function who() { const me = await getMember(); if (!me) throw new AuthError('Reconnectez-vous.', 401); if (me.must_change) throw new AuthError('Changez votre mot de passe provisoire.', 403); return me; }
const fail = (e: unknown) => json({
  error: e instanceof AuthError ? e.message : 'Connexion GLPI indisponible.',
  uncertain: e instanceof GlpiCreationUncertain,
  terminal: e instanceof GlpiCreationTerminal,
  retryable: e instanceof GlpiCreationUncertain || (e instanceof AuthError && ([401, 403, 408, 425, 429, 500, 502, 503, 504].includes(e.status) || (e.status === 409 && /acc[eè]s|connexion|connectez|jeton|session/i.test(e.message)))),
  ...(e instanceof GlpiDistinctRequired ? { distinct_required: true } : {}),
  ...(e instanceof GlpiCreationUncertain && e.operation ? { operation: e.operation } : {}),
}, e instanceof AuthError ? e.status : 503);
export async function GET(request: Request) {
  try {
    const me = await who(), config = glpiConfig(), url = new URL(request.url);
    if (url.searchParams.has('uncertain')) return json(glpiUncertainRequests(me.id, config?.api, url.searchParams.get('recover') === '1'));
    if (url.searchParams.has('createOptions')) { if(!config) throw new AuthError('GLPI doit être configuré.',409); return json(await glpiCreationOptions(me.id,config,url.searchParams.get('client')||'')); }
    if (!url.searchParams.has('tickets')) return json({ configured: !!config, canCreate: glpiWriteEnabled(), connected: !!config && hasGlpiToken(me.id, config), web: config?.web || null });
    if (!config) throw new AuthError('L’administrateur doit configurer l’adresse GLPI sur le serveur.', 409);
    const query = (url.searchParams.get('q') || '').trim(), page = Number(url.searchParams.get('page') || 0);
    if (query.length > 120 || !Number.isSafeInteger(page) || page < 0 || page > 10000) throw new AuthError('Recherche invalide.');
    return json(await glpiTickets(me.id, config, query, page, url.searchParams.get('open') !== 'false'));
  } catch (e) { return fail(e); }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request); const me = await who();
    const raw = await request.text(); if (raw.length > 18000) throw new AuthError('Formulaire trop long.');
    let body; try { body = JSON.parse(raw); } catch { throw new AuthError('Formulaire invalide.'); }
    if (!body || typeof body !== 'object') throw new AuthError('Formulaire invalide.');
    if (body.action === 'beginDistinctCreation' || body.action === 'authorizeDistinctCreation') {
      const config = glpiConfig(); if (!config) throw new AuthError('GLPI doit être configuré.', 409);
      if (body.previous_request_id !== undefined && (typeof body.previous_request_id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.previous_request_id))) throw new AuthError('Demande d’origine invalide.');
      rateLimit('glpi-distinct-intent:'+me.id,10,60000);
      return json(beginGlpiDistinctCreation(me.id, config, body.previous_request_id));
    }
    if (body.action === 'acknowledgeCreation') {
      if (typeof body.request_id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.request_id)) throw new AuthError('Demande invalide.');
      const ticketId = Number.isSafeInteger(body.ticket_id) ? body.ticket_id as number : undefined;
      return json(acknowledgeGlpiCreationResult(me.id, glpiConfig()?.api, body.request_id, ticketId));
    }
    if (body.action === 'resolveLegacyCreation') {
      if (typeof body.request_id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.request_id)) throw new AuthError('Demande invalide.');
      if (body.resolution !== 'abandon' && body.resolution !== 'recover') throw new AuthError('Résolution historique invalide.');
      const result = resolveLegacyCreation(me.id, undefined, body.request_id, body.resolution, body.payload, body.ticket);
      return json(result);
    }
    if (body.action === 'createTicket') { const config=glpiConfig(); if(!config)throw new AuthError('GLPI doit être configuré.',409); rateLimit('glpi-create:'+me.id,10,60000); return json(await createGlpiTicket(me.id,config,body)); }
    if (body.action === 'disconnect') sqlite().prepare('DELETE FROM glpi_credentials WHERE member_id=?').run(me.id);
    else if (body.action === 'connect') {
      const config = glpiConfig(); if (!config) throw new AuthError('GLPI doit être configuré sur le serveur.', 409);
      if (typeof body.token !== 'string' || !/^[\x21-\x7e]{8,512}$/.test(body.token)) throw new AuthError('Saisissez un jeton personnel GLPI valide.');
      await testGlpiToken(config, body.token); saveGlpiToken(me.id, config, body.token);
    } else throw new AuthError('Action non reconnue.');
    return json({ ok: true });
  } catch (e) { return fail(e); }
}
