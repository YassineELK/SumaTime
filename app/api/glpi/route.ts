import { getMember, checkOrigin, AuthError, rateLimit } from '@/lib/auth';
import { sqlite } from '@/db/raw';
import { acknowledgeGlpiCreationResult, abandonGlpiDistinctCreation, beginGlpiDistinctCreation, createGlpiTicket, glpiCreationOptions, glpiWriteEnabled, GlpiCreationTerminal, GlpiCreationUncertain, GlpiDistinctRequired, glpiConfig, glpiUncertainRequests, hasGlpiToken, glpiTickets, resolveLegacyCreation, saveGlpiToken, testGlpiToken, type GlpiFailureCode } from '@/lib/glpi';
import type { GlpiErrorContract } from '@/lib/glpi-contract';
export const dynamic = 'force-dynamic';
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
async function who() { const me = await getMember(); if (!me) throw new AuthError('Reconnectez-vous.', 401); if (me.must_change) throw new AuthError('Changez votre mot de passe provisoire.', 403); return me; }
type FailureContext = 'read' | 'creation' | 'recovery' | 'intent' | 'ack' | 'legacy';
type FailureContract = GlpiErrorContract & { code: GlpiFailureCode | 'AUTH_REQUIRED' | 'ACCESS_DENIED' | 'RATE_LIMITED' | 'INVALID_REQUEST' | 'UNKNOWN_ERROR' };

function fallbackContract(error: unknown, context: FailureContext): FailureContract {
  const preserveOperation = context === 'creation' || context === 'recovery' || context === 'ack' || context === 'legacy';
  if (error instanceof AuthError && error.code) {
    return {
      code: error.code as FailureContract['code'],
      terminal: error.terminal === true,
      retryable: error.retryable === true,
      preserveOperation: error.preserveOperation ?? preserveOperation,
    };
  }
  if (error instanceof AuthError) {
    if (error.status === 401) return { code: 'AUTH_REQUIRED', terminal: false, retryable: true, preserveOperation };
    if (error.status === 403) return { code: 'ACCESS_DENIED', terminal: false, retryable: true, preserveOperation };
    if (error.status === 429) return { code: 'RATE_LIMITED', terminal: false, retryable: true, preserveOperation };
    if (error.status >= 500 || error.status === 408 || error.status === 425) return { code: 'GLPI_UNAVAILABLE', terminal: false, retryable: true, preserveOperation };
    return { code: 'INVALID_REQUEST', terminal: false, retryable: false, preserveOperation };
  }
  // Unknown exceptions and malformed upstream responses are fail-closed. No
  // HTTP status or message heuristic may turn them into a terminal refusal.
  return { code: 'UNKNOWN_ERROR', terminal: false, retryable: true, preserveOperation };
}

function fail(e: unknown, context: FailureContext) {
  const contract = fallbackContract(e, context);
  const uncertain = e instanceof GlpiCreationUncertain || (context === 'creation' && contract.preserveOperation && !contract.terminal);
  return json({
    error: e instanceof AuthError ? e.message : 'Connexion GLPI indisponible.',
    code: contract.code,
    terminal: contract.terminal,
    retryable: contract.retryable,
    preserveOperation: contract.preserveOperation,
    uncertain,
    ...(e instanceof GlpiDistinctRequired ? { distinct_required: true } : {}),
    ...(e instanceof GlpiCreationUncertain && e.operation ? { operation: e.operation } : {}),
    ...(e instanceof GlpiCreationTerminal && e.intentConsumed ? { intent_consumed: true } : {}),
    ...(e instanceof GlpiCreationUncertain && e.intentConsumed ? { intent_consumed: true } : {}),
    ...(e instanceof AuthError && (e.code === 'INTENT_CONSUMED' || e.code === 'INTENT_ABANDONED') ? { intent_consumed: true } : {}),
  }, e instanceof AuthError ? e.status : 503);
}
export async function GET(request: Request) {
  const url = new URL(request.url);
  const context: FailureContext = url.searchParams.has('uncertain') ? 'recovery' : 'read';
  try {
    const me = await who(), config = glpiConfig();
    if (url.searchParams.has('uncertain')) return json(glpiUncertainRequests(me.id, config?.api, url.searchParams.get('recover') === '1'));
    if (url.searchParams.has('createOptions')) { if(!config) throw new AuthError('GLPI doit être configuré.',409,{ code:'CONFIG_NOT_READY', retryable:true, preserveOperation:true }); return json(await glpiCreationOptions(me.id,config,url.searchParams.get('client')||'')); }
    if (!url.searchParams.has('tickets')) return json({ configured: !!config, canCreate: glpiWriteEnabled(), connected: !!config && hasGlpiToken(me.id, config), web: config?.web || null });
    if (!config) throw new AuthError('L’administrateur doit configurer l’adresse GLPI sur le serveur.', 409, { code:'CONFIG_NOT_READY', retryable:true, preserveOperation:true });
    const query = (url.searchParams.get('q') || '').trim(), page = Number(url.searchParams.get('page') || 0);
    if (query.length > 120 || !Number.isSafeInteger(page) || page < 0 || page > 10000) throw new AuthError('Recherche invalide.');
    return json(await glpiTickets(me.id, config, query, page, url.searchParams.get('open') !== 'false'));
  } catch (e) { return fail(e, context); }
}
export async function POST(request: Request) {
  // A POST can fail before its action body is authenticated (for example a
  // temporary 401 during an explicitly distinct submit). Preserve by default
  // until the action is known; this is safer than guessing from the status.
  let context: FailureContext = 'creation';
  try {
    checkOrigin(request); const me = await who();
    const raw = await request.text(); if (raw.length > 18000) throw new AuthError('Formulaire trop long.');
    let body; try { body = JSON.parse(raw); } catch { throw new AuthError('Formulaire invalide.'); }
    if (!body || typeof body !== 'object') throw new AuthError('Formulaire invalide.');
    if (body.action === 'beginDistinctCreation' || body.action === 'authorizeDistinctCreation') {
      context = 'intent';
      const config = glpiConfig(); if (!config) throw new AuthError('GLPI doit être configuré.', 409, { code:'CONFIG_NOT_READY', retryable:true, preserveOperation:true });
      if (body.previous_request_id !== undefined && (typeof body.previous_request_id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.previous_request_id))) throw new AuthError('Demande d’origine invalide.');
      if (typeof body.draft_request_id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.draft_request_id)) throw new AuthError('Identité du brouillon obligatoire et invalide.');
      rateLimit('glpi-distinct-intent:'+me.id,10,60000);
      return json(beginGlpiDistinctCreation(me.id, config, body.previous_request_id, body.draft_request_id));
    }
    if (body.action === 'abandonDistinctCreation') {
      context = 'intent';
      const config = glpiConfig(); if (!config) throw new AuthError('GLPI doit être configuré.', 409, { code:'CONFIG_NOT_READY', retryable:true, preserveOperation:true });
      if (typeof body.intent_id !== 'string' || !/^[a-f0-9]{64}$/.test(body.intent_id)) throw new AuthError('L’intention de nouvelle demande est invalide.', 400, { code:'INVALID_REQUEST', retryable:false, preserveOperation:true });
      return json(abandonGlpiDistinctCreation(me.id, config.api, body.intent_id));
    }
    if (body.action === 'acknowledgeCreation') {
      context = 'ack';
      if (typeof body.request_id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.request_id)) throw new AuthError('Demande invalide.');
      const ticketId = Number.isSafeInteger(body.ticket_id) ? body.ticket_id as number : undefined;
      return json(acknowledgeGlpiCreationResult(me.id, glpiConfig()?.api, body.request_id, ticketId));
    }
    if (body.action === 'resolveLegacyCreation') {
      context = 'legacy';
      if (typeof body.request_id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.request_id)) throw new AuthError('Demande invalide.');
      if (body.resolution !== 'abandon' && body.resolution !== 'recover') throw new AuthError('Résolution historique invalide.');
      const result = resolveLegacyCreation(me.id, undefined, body.request_id, body.resolution, body.payload, body.ticket);
      return json(result);
    }
    if (body.action === 'createTicket') { context = 'creation'; const config=glpiConfig(); if(!config)throw new AuthError('GLPI doit être configuré.',409,{ code:'CONFIG_NOT_READY', retryable:true, preserveOperation:true }); rateLimit('glpi-create:'+me.id,10,60000); return json(await createGlpiTicket(me.id,config,body)); }
    if (body.action === 'disconnect') sqlite().prepare('DELETE FROM glpi_credentials WHERE member_id=?').run(me.id);
    else if (body.action === 'connect') {
      const config = glpiConfig(); if (!config) throw new AuthError('GLPI doit être configuré sur le serveur.', 409, { code:'CONFIG_NOT_READY', retryable:true, preserveOperation:false });
      if (typeof body.token !== 'string' || !/^[\x21-\x7e]{8,512}$/.test(body.token)) throw new AuthError('Saisissez un jeton personnel GLPI valide.');
      await testGlpiToken(config, body.token); saveGlpiToken(me.id, config, body.token);
    } else throw new AuthError('Action non reconnue.');
    return json({ ok: true });
  } catch (e) { return fail(e, context); }
}
