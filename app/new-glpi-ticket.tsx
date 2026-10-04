'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Check, ExternalLink, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { Client } from '@/lib/types';
import type { GlpiCreationOperation, GlpiDistinctDraft, GlpiTicket } from '@/lib/glpi';
import { isTerminalGlpiFailure } from '@/lib/glpi-contract';
import { announcePendingGlpiRequest, getGlpiDraftStorageStatus, isGlpiCreationAcknowledged, markGlpiCreationAcknowledged, readPendingGlpiRequest, removePendingGlpiRequest, savePendingGlpiRequest, subscribePendingGlpiRequest, type GlpiDistinctCapability, type GlpiDraftStorageStatus, type GlpiRequestPayload, type PendingGlpiRequest } from '@/lib/glpi-draft';

type Status = { configured: boolean; connected: boolean; canCreate: boolean; web: string | null };
type Category = { id: number; name: string };
type Form = GlpiRequestPayload;
type ServerRequest = GlpiCreationOperation;
type LegacyRequest = { request_id: string; createdAt: string; apiUrl: string };
type ApiValue = { ok?: boolean; error?: string; code?: string; uncertain?: boolean; terminal?: boolean; retryable?: boolean; preserveOperation?: boolean; intent_consumed?: boolean; distinct_required?: boolean; ack_scope?: string; ticket?: GlpiTicket; operation?: ServerRequest; categories?: Category[]; limited?: boolean; requests?: ServerRequest[]; recoverable?: ServerRequest[]; distinctDrafts?: GlpiDistinctDraft[]; legacy?: LegacyRequest[]; blocked?: boolean; intent_id?: string; expiresAt?: string; draft_request_id?: string; generation?: number; terminal_error?: string; state?: 'active' | 'reserved' | 'completed' | 'uncertain' | 'rejected' } & Partial<Status>;
type AsyncKind = 'pending' | 'status' | 'options' | 'submit' | 'ack' | 'resolve' | 'intent';
type UiMode = 'idle' | 'draft' | 'uncertain' | 'result';
type RecoveryAction = 'reauth' | 'retry' | null;

function newForm(clientId: string, description: string): Form {
  return { request_id: crypto.randomUUID(), client_id: clientId, title: '', description, type: 1, urgency: 3, category: 0 };
}

function blankForm(description: string): Form {
  return { request_id: '', client_id: '', title: '', description, type: 1, urgency: 3, category: 0 };
}

function canonical(form: Form): Form {
  return { ...form, client_id: form.client_id.trim(), title: form.title.trim(), description: form.description.trim() };
}

async function apiValue(response: Response): Promise<ApiValue> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value as ApiValue : {};
  } catch {
    // A malformed/empty response is an unknown outcome. It must stay
    // fail-closed even if the HTTP status happens to be a 4xx.
    return { code: 'MALFORMED_RESPONSE', terminal: false, retryable: true, preserveOperation: true, error: 'La réponse du serveur est inexploitable ; l’opération reste conservée.' };
  }
}

function capability(value: PendingGlpiRequest['distinctIntent'] | null | undefined): GlpiDistinctCapability | null {
  const marker = distinctMarker(value);
  return marker && Date.parse(marker.expiresAt) > Date.now() ? marker : null;
}

function distinctMarker(value: PendingGlpiRequest['distinctIntent'] | null | undefined): GlpiDistinctCapability | null {
  return value && /^[a-f0-9]{64}$/.test(value.intent_id) && Number.isFinite(Date.parse(value.expiresAt))
    ? { intent_id: value.intent_id, expiresAt: value.expiresAt }
    : null;
}

function validRequestId(value: string | null | undefined) {
  return typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
}

function terminalFailure(value: ApiValue, hasCapability = false) {
  // The server contract is authoritative. Never infer terminality from an
  // HTTP status, an unknown code, a missing body, or a message heuristic.
  return isTerminalGlpiFailure(value, hasCapability);
}

export default function NewGlpiTicket({ clients, memberId = '', initialClient = '', initialDescription = '', disabled = false, onCreated }: { clients: Client[]; memberId?: string; initialClient?: string; initialDescription?: string; disabled?: boolean; onCreated: (ticket: GlpiTicket) => void }) {
  const [initialPending] = useState<PendingGlpiRequest | null>(() => {
    const candidate = readPendingGlpiRequest(initialClient, initialDescription, undefined, memberId);
    return candidate && !isGlpiCreationAcknowledged(memberId, candidate.payload.request_id) ? candidate : null;
  });
  const initialDistinctMarker = distinctMarker(initialPending?.distinctIntent);
  const [initialDistinctDraft] = useState(() => !!initialDistinctMarker && Date.parse(initialDistinctMarker.expiresAt) <= Date.now());
  const initialMode: UiMode = initialPending ? (initialDistinctDraft ? 'draft' : 'uncertain') : 'idle';
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [form, setForm] = useState<Form>(() => initialPending?.payload || blankForm(initialDescription));
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(initialMode === 'uncertain');
  const [created, setCreated] = useState<GlpiTicket | null>(null);
  const [distinctRequired, setDistinctRequired] = useState(initialDistinctDraft);
  const [distinctExpired, setDistinctExpired] = useState(() => !!initialDistinctMarker && Date.parse(initialDistinctMarker.expiresAt) <= Date.now());
  const [mode, setModeState] = useState<UiMode>(initialMode);
  const [storageIssue, setStorageIssue] = useState<Exclude<GlpiDraftStorageStatus, 'ok'> | null>(() => {
    const value = getGlpiDraftStorageStatus(memberId);
    return value === 'ok' ? null : value;
  });
  const [pendingChecked, setPendingChecked] = useState(false);
  const [serverBlocked, setServerBlocked] = useState(false);
  const [pendingCheckFailed, setPendingCheckFailed] = useState(false);
  const [legacyRequests, setLegacyRequests] = useState<LegacyRequest[]>([]);
  const [serverDraftChoices, setServerDraftChoices] = useState<GlpiDistinctDraft[]>([]);
  const [serverRecoveryChoices, setServerRecoveryChoices] = useState<ServerRequest[]>([]);
  const [draftEpoch, setDraftEpoch] = useState(0);
  const [recoveryAction, setRecoveryAction] = useState<RecoveryAction>(null);
  const sending = useRef(false);
  const mounted = useRef(false);
  const currentMember = useRef(memberId);
  const memberEpoch = useRef(0);
  const modeRef = useRef<UiMode>(initialMode);
  const operation = useRef<Form | null>(initialDistinctDraft ? null : initialPending?.payload || null);
  const uncertainPayload = useRef<Form | null>(initialDistinctDraft ? null : initialPending?.payload || null);
  const currentCreated = useRef<GlpiTicket | null>(null);
  const formRequestIdRef = useRef(initialPending?.payload.request_id || '');
  const draftOwned = useRef(initialDistinctDraft);
  // `enterDraft` creates a UUID before the user has typed anything. Keep that
  // pristine state separate from ownership so a cold page can adopt one
  // server-authoritative distinct draft without overwriting real edits.
  const pristineDraft = useRef(!initialPending);
  const serverPending = useRef<ServerRequest | null>(null);
  const serverDraftChoicesRef = useRef<GlpiDistinctDraft[]>([]);
  const serverRecoveryChoicesRef = useRef<ServerRequest[]>([]);
  const distinctIntent = useRef<string | null>(initialDistinctMarker?.intent_id || null);
  const distinctIntentExpiresAt = useRef<string | null>(initialDistinctMarker?.expiresAt || null);
  const serverBlockedRef = useRef(false);
  const controllers = useRef(new Map<AsyncKind, AbortController>());
  const sequences = useRef<Record<AsyncKind, number>>({ pending: 0, status: 0, options: 0, submit: 0, ack: 0, resolve: 0, intent: 0 });

  useLayoutEffect(() => {
    formRequestIdRef.current = form.request_id;
  }, [form.request_id]);

  const setMode = useCallback((value: UiMode) => {
    modeRef.current = value;
    setModeState(value);
  }, []);

  const abortRequests = useCallback(() => {
    controllers.current.forEach(controller => controller.abort());
    controllers.current.clear();
    (Object.keys(sequences.current) as AsyncKind[]).forEach(kind => { sequences.current[kind] += 1; });
  }, []);

  const begin = useCallback((kind: AsyncKind) => {
    controllers.current.get(kind)?.abort();
    const controller = new AbortController();
    controllers.current.set(kind, controller);
    const sequence = ++sequences.current[kind];
    const epoch = memberEpoch.current;
    const member = currentMember.current;
    return { controller, epoch, sequence, member, valid: () => mounted.current && !controller.signal.aborted && memberEpoch.current === epoch && currentMember.current === member && sequences.current[kind] === sequence };
  }, []);

  const finish = useCallback((kind: AsyncKind, controller: AbortController) => {
    if (controllers.current.get(kind) === controller) controllers.current.delete(kind);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      memberEpoch.current += 1;
      abortRequests();
    };
  }, [abortRequests]);

  // A member switch is a security boundary, even if the parent keeps this
  // component mounted. Clear Alice's visible state before any Bob request can
  // settle, and abort every request captured under Alice's epoch.
  useLayoutEffect(() => {
    if (currentMember.current === memberId) return;
    memberEpoch.current += 1;
    abortRequests();
    currentMember.current = memberId;
    sending.current = false;
    draftOwned.current = false;
    operation.current = null;
    uncertainPayload.current = null;
    currentCreated.current = null;
    serverPending.current = null;
    pristineDraft.current = true;
    distinctIntent.current = null;
    distinctIntentExpiresAt.current = null;
    serverBlockedRef.current = false;
    setOpen(false);
    setStatus(null);
    setCategories([]);
    setForm(blankForm(initialDescription));
    setMode('idle');
    setUncertain(false);
    setCreated(null);
    setDistinctRequired(false);
    setDistinctExpired(false);
    setBusy(false);
    setLoading(false);
    setError('');
    setPendingChecked(false);
    setPendingCheckFailed(false);
    setServerBlocked(false);
    setLegacyRequests([]);
    serverDraftChoicesRef.current = [];
    setServerDraftChoices([]);
    serverRecoveryChoicesRef.current = [];
    setServerRecoveryChoices([]);
    setDraftEpoch(epoch => epoch + 1);
    setRecoveryAction(null);
    const storage = getGlpiDraftStorageStatus(memberId);
    setStorageIssue(storage === 'ok' ? null : storage);
  }, [abortRequests, initialDescription, memberId, setMode]);

  const applyPending = useCallback((pendingRequest: PendingGlpiRequest) => {
    const requestId = pendingRequest.payload.request_id;
    if (draftOwned.current && operation.current?.request_id !== requestId) {
      serverPending.current = { payload: pendingRequest.payload, createdAt: new Date(pendingRequest.savedAt).toISOString() };
      return;
    }
    if ((modeRef.current === 'uncertain' || modeRef.current === 'result') && operation.current?.request_id !== requestId) {
      serverPending.current = { payload: pendingRequest.payload, createdAt: new Date(pendingRequest.savedAt).toISOString() };
      return;
    }
    const pendingMarker = distinctMarker(pendingRequest.distinctIntent);
    const pendingCapability = capability(pendingMarker);
    distinctIntent.current = pendingMarker?.intent_id || null;
    distinctIntentExpiresAt.current = pendingMarker?.expiresAt || null;
    currentCreated.current = null;
    setForm(pendingRequest.payload);
    pristineDraft.current = false;
    // A marker without a server reservation is a draft, not an uncertain
    // operation. In particular, an expired marker must remain visible so the
    // user can renew the explicit intention for this same UUID.
    if (pendingMarker && !pendingCapability) {
      operation.current = null;
      uncertainPayload.current = null;
      draftOwned.current = true;
      setUncertain(false);
      setDistinctRequired(true);
      setDistinctExpired(!pendingCapability);
      setMode('draft');
      setError(pendingCapability
        ? 'Cette demande distincte est conservée. Envoyez-la avec son intention serveur ou renouvelez-la si elle expire.'
        : 'L’intention de cette demande distincte a expiré. Renouvelez-la explicitement avant de créer le ticket.');
      setCategories([]);
      return;
    }
    operation.current = pendingRequest.payload;
    uncertainPayload.current = pendingRequest.payload;
    setUncertain(true);
    setDistinctRequired(false);
    setDistinctExpired(false);
    setCreated(null);
    setMode('uncertain');
    setCategories([]);
    setError('Résultat incertain : la demande conservée utilise le même UUID et le même payload. Récupérez son résultat avant toute nouvelle demande.');
  }, [setMode]);

  const applyServerRequest = useCallback((request: ServerRequest) => {
    const requestId = request.payload.request_id;
    // A server operation with the exact durable draft UUID is authoritative,
    // even when the browser still considers the draft local-only. A
    // different UUID remains a separate operation and must never replace the
    // visible draft merely because its fingerprint matches.
    if (draftOwned.current && operation.current?.request_id !== requestId && formRequestIdRef.current !== requestId) {
      serverPending.current = request;
      return;
    }
    if ((modeRef.current === 'uncertain' || modeRef.current === 'result') && operation.current?.request_id !== requestId && formRequestIdRef.current !== requestId) {
      serverPending.current = request;
      return;
    }
    const stored = savePendingGlpiRequest(request.payload, undefined, memberId, undefined, { announce: false });
    if (!stored.ok) setStorageIssue(stored.reason);
    serverRecoveryChoicesRef.current = [];
    setServerRecoveryChoices([]);
    operation.current = request.payload;
    pristineDraft.current = false;
    uncertainPayload.current = request.payload;
    serverPending.current = request;
    setForm(request.payload);
    if (request.ticket) {
      distinctIntent.current = null;
      distinctIntentExpiresAt.current = null;
      currentCreated.current = request.ticket;
      setCreated(request.ticket);
      setUncertain(false);
      setDistinctRequired(false);
      setDistinctExpired(false);
      setMode('result');
      setError('Résultat récupéré depuis le serveur membre-scopé. Confirmez sa consommation pour clore cette opération.');
    } else {
      currentCreated.current = null;
      setCreated(null);
      setUncertain(true);
      setDistinctRequired(false);
      setDistinctExpired(false);
      setMode('uncertain');
      setError('Résultat incertain : la demande conservée utilise le même UUID et le même payload. Récupérez son résultat avant toute nouvelle demande.');
    }
  }, [memberId, setMode]);

  const applyServerDraft = useCallback((draft: GlpiDistinctDraft) => {
    serverDraftChoicesRef.current = [];
    setServerDraftChoices([]);
    serverRecoveryChoicesRef.current = [];
    setServerRecoveryChoices([]);
    if (draft.state === 'rejected') {
      // A certain provider refusal is a durable terminal state, not an
      // uncertainty. Keep the rejected UUID visible and require an explicit
      // new-intent action before any corrected payload can be submitted.
      operation.current = draft.payload;
      pristineDraft.current = false;
      uncertainPayload.current = null;
      serverPending.current = null;
      currentCreated.current = null;
      distinctIntent.current = null;
      distinctIntentExpiresAt.current = null;
      draftOwned.current = true;
      setForm(draft.payload);
      setUncertain(false);
      setDistinctRequired(true);
      setDistinctExpired(false);
      setCreated(null);
      setMode('draft');
      setCategories([]);
      setPendingChecked(true);
      setError(draft.terminal_error || 'GLPI a refusé cette demande. Corrigez les champs puis commencez explicitement une nouvelle demande distincte.');
      return;
    }
    if (draft.operation) {
      applyServerRequest(draft.operation);
      return;
    }
    const marker = distinctMarker({ intent_id: draft.intent_id, expiresAt: draft.expiresAt });
    if (!marker) return;
    const expired = Date.parse(marker.expiresAt) <= Date.now();
    distinctIntent.current = marker.intent_id;
    distinctIntentExpiresAt.current = marker.expiresAt;
    if (draftOwned.current && formRequestIdRef.current === draft.draft_request_id) {
      setDistinctRequired(expired);
      setDistinctExpired(expired);
      setPendingChecked(true);
      return;
    }
    operation.current = null;
    uncertainPayload.current = null;
    serverPending.current = null;
    currentCreated.current = null;
    draftOwned.current = true;
    pristineDraft.current = false;
    setForm(draft.payload);
    setUncertain(false);
    setDistinctRequired(expired);
    setDistinctExpired(expired);
    setCreated(null);
    setMode('draft');
    setCategories([]);
    setPendingChecked(true);
    setError(expired
      ? 'L’intention de cette demande distincte a expiré. Renouvelez-la explicitement avant de créer le ticket.'
      : 'Cette demande distincte est conservée par le serveur. Envoyez-la avec son intention serveur.');
  }, [applyServerRequest, setMode]);

  const refreshPending = useCallback(async (adopt = true, includeAcknowledged = false) => {
    const request = begin('pending');
    if (!request.valid()) return null;
    try {
      let response: Response;
      try {
        response = await fetch('/api/glpi?uncertain=1' + (includeAcknowledged ? '&recover=1' : ''), { cache: 'no-store', signal: request.controller.signal });
      } catch (reason) {
        // Older isolated clients/mocks do not know the optional recovery
        // query. Fall back to the ordinary uncertainty read without turning
        // that capability difference into a creation block.
        if (!includeAcknowledged) throw reason;
        response = await fetch('/api/glpi?uncertain=1', { cache: 'no-store', signal: request.controller.signal });
      }
      let value = await response.json() as ApiValue;
      if (!response.ok && includeAcknowledged && request.valid()) {
        const fallback = await fetch('/api/glpi?uncertain=1', { cache: 'no-store', signal: request.controller.signal });
        value = await fallback.json() as ApiValue;
        response = fallback;
      }
      if (!request.valid()) return null;
      if (!response.ok) throw new Error(value.error || 'L’état GLPI ne peut pas être vérifié.');
      setPendingCheckFailed(false);
      serverBlockedRef.current = value.blocked === true;
      setServerBlocked(value.blocked === true);
      setLegacyRequests(value.legacy || []);
      if (value.blocked && !(value.legacy?.length)) setStorageIssue('corrupt');
      const ackScope = typeof value.ack_scope === 'string' ? value.ack_scope : undefined;
      const recoverable = includeAcknowledged
        ? (value.recoverable || []).filter(item => !isGlpiCreationAcknowledged(memberId, item.payload.request_id, ackScope))
        : [];
      const requests = [...(value.requests || []), ...recoverable].filter((item, index, all) => all.findIndex(candidate => candidate.payload.request_id === item.payload.request_id) === index);
      const distinctDrafts = value.distinctDrafts || [];
      serverDraftChoicesRef.current = distinctDrafts;
      setServerDraftChoices(distinctDrafts);
      const activeId = operation.current?.request_id || (validRequestId(formRequestIdRef.current) ? formRequestIdRef.current : undefined);
      // A locally persisted distinct draft is authoritative for this tab even
      // when the server has an older uncertain operation with the same
      // business fields. Never let polling alias the new UUID back to it.
      const matchingDraft = distinctDrafts.find(item => !!activeId && item.draft_request_id === activeId);
      const canAdoptSingleDraft = distinctDrafts.length === 1
        && (!activeId || (pristineDraft.current && modeRef.current === 'draft' && !operation.current && !serverPending.current));
      if (matchingDraft || canAdoptSingleDraft) {
        serverRecoveryChoicesRef.current = [];
        setServerRecoveryChoices([]);
        const selectedDraft = matchingDraft || distinctDrafts[0];
        // A locally persisted live marker may accompany an uncertain retry
        // after an authentication/transport loss. Keep that state and its
        // exact form; only a server-bound result, or a genuinely cold page,
        // may change the visible mode.
        if (!matchingDraft || matchingDraft.operation || draftOwned.current) applyServerDraft(selectedDraft);
        if (adopt || modeRef.current !== 'draft') setPendingChecked(true);
        return matchingDraft?.operation || distinctDrafts[0]?.operation || null;
      }
      // Multiple server-owned drafts require a deliberate choice. Do not
      // guess from a fingerprint or from the first historical ticket.
      if (distinctDrafts.length > 1 && (!activeId || (pristineDraft.current && modeRef.current === 'draft' && !operation.current && !serverPending.current))) {
        serverRecoveryChoicesRef.current = [];
        setServerRecoveryChoices([]);
        if (adopt || modeRef.current !== 'draft') setPendingChecked(true);
        return null;
      }
      const byContext = !activeId && storageIssue === null
        ? requests.filter(item => (!initialClient || item.payload.client_id === initialClient) && (!initialDescription.trim() || item.payload.description === initialDescription.trim()))
        : [];
      const matching = requests.find(item => activeId && item.payload.request_id === activeId)
        || (byContext.length === 1 ? byContext[0] : undefined)
        // With no browser storage, adopting a single server-authoritative
        // operation is safe and is required for a cold page after a response
        // loss. Never guess when more than one operation is available.
        || (!activeId && !draftOwned.current && requests.length === 1 ? requests[0] : undefined);
      if (!matching && !activeId && requests.length > 1) {
        serverRecoveryChoicesRef.current = requests;
        setServerRecoveryChoices(requests);
        if (adopt || modeRef.current !== 'draft') setPendingChecked(true);
        return null;
      }
      if (matching) {
        serverRecoveryChoicesRef.current = [];
        setServerRecoveryChoices([]);
        serverPending.current = matching;
        if (adopt || !draftOwned.current) applyServerRequest(matching);
      } else {
        serverRecoveryChoicesRef.current = [];
        setServerRecoveryChoices([]);
      }
      if (adopt || modeRef.current !== 'draft') setPendingChecked(true);
      return matching || null;
    } catch (reason) {
      if (!request.valid() || (reason instanceof DOMException && reason.name === 'AbortError')) return null;
      setPendingCheckFailed(true);
      if (adopt || modeRef.current !== 'draft') setPendingChecked(true);
      setError(reason instanceof Error ? reason.message : 'L’état GLPI ne peut pas être vérifié.');
      return null;
    } finally {
      finish('pending', request.controller);
    }
  }, [applyServerDraft, applyServerRequest, begin, finish, initialClient, initialDescription, memberId, storageIssue]);

  useEffect(() => {
    const pendingCheck = setTimeout(() => { void refreshPending(true); }, 0);
    const unsubscribe = subscribePendingGlpiRequest(memberId, pending => {
      if (!mounted.current || currentMember.current !== memberId) return;
      if (pending) {
        if (draftOwned.current) serverPending.current = { payload: pending.payload, createdAt: new Date(pending.savedAt).toISOString() };
        else applyPending(pending);
      } else if (!draftOwned.current) void refreshPending(true);
    });
    return () => { clearTimeout(pendingCheck); unsubscribe(); };
  }, [applyPending, memberId, refreshPending]);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => { void refreshPending(false); }, 2000);
    return () => clearInterval(timer);
  }, [open, refreshPending]);

  useEffect(() => {
    if (!open) return;
    const request = begin('status');
    void fetch('/api/glpi', { cache: 'no-store', signal: request.controller.signal })
      .then(async response => {
        const value = await response.json() as ApiValue;
        if (!request.valid()) return;
        if (!response.ok) throw new Error(value.error || 'Connexion GLPI indisponible.');
        const next: Status = { configured: value.configured === true, connected: value.connected === true, canCreate: value.canCreate === true, web: value.web || null };
        setStatus(next);
        if (!next.connected || !next.canCreate) setLoading(false);
      })
      .catch(reason => { if (request.valid() && !(reason instanceof DOMException && reason.name === 'AbortError')) setError(reason instanceof Error ? reason.message : 'Connexion GLPI indisponible.'); })
      .finally(() => { finish('status', request.controller); });
    return () => request.controller.abort();
  }, [begin, finish, open]);

  useEffect(() => {
    if (!open || uncertain || !status?.connected || !status.canCreate || !form.client_id) return;
    const request = begin('options');
    void fetch('/api/glpi?' + new URLSearchParams({ createOptions: '1', client: form.client_id }), { cache: 'no-store', signal: request.controller.signal })
      .then(async response => {
        const value = await response.json() as ApiValue;
        if (!request.valid()) return;
        if (!response.ok) throw new Error(value.error || 'Les catégories GLPI sont indisponibles.');
        setCategories(value.categories || []);
        if (value.limited) setError('Seules les 500 premières catégories sont affichées. Utilisez GLPI si la catégorie nécessaire manque.');
      })
      .catch(reason => { if (request.valid() && !(reason instanceof DOMException && reason.name === 'AbortError')) setError(reason instanceof Error ? reason.message : 'Les catégories GLPI sont indisponibles.'); })
      .finally(() => { if (request.valid()) setLoading(false); finish('options', request.controller); });
    return () => request.controller.abort();
  }, [begin, draftEpoch, finish, form.client_id, mode, open, status?.canCreate, status?.connected, uncertain]);

  function markDraft() {
    if (modeRef.current !== 'draft') setMode('draft');
    draftOwned.current = true;
    setError('');
  }

  function currentMarker(): GlpiDistinctCapability | undefined {
    const value = distinctMarker(distinctIntent.current && distinctIntentExpiresAt.current
      ? { intent_id: distinctIntent.current, expiresAt: distinctIntentExpiresAt.current }
      : undefined);
    if (!value) {
      distinctIntent.current = null;
      distinctIntentExpiresAt.current = null;
    }
    return value || undefined;
  }

  function currentCapability(): GlpiDistinctCapability | undefined {
    const value = currentMarker();
    return value && Date.parse(value.expiresAt) > Date.now() ? value : undefined;
  }

  function clearDistinctCapability() {
    distinctIntent.current = null;
    distinctIntentExpiresAt.current = null;
    setDistinctExpired(false);
  }

  function updateForm(patch: Partial<Form>) {
    markDraft();
    pristineDraft.current = false;
    const next = { ...form, ...patch };
    setForm(next);
    const marker = currentMarker();
    const expired = !!marker && Date.parse(marker.expiresAt) <= Date.now();
    setDistinctRequired(expired ? true : false);
    setDistinctExpired(expired);
    if (marker) {
      const stored = savePendingGlpiRequest(next, undefined, memberId, marker, { preserveExpiredCapability: true });
      if (!stored.ok) setStorageIssue(stored.reason);
    }
  }

  function enterDraft(clientId: string, description: string, seed?: Form, distinct?: GlpiDistinctCapability, requestId?: string): Form {
    const next = seed
      ? { ...seed, request_id: requestId || crypto.randomUUID(), client_id: clientId || seed.client_id }
      : newForm(clientId, description);
    draftOwned.current = true;
    pristineDraft.current = !seed || (!seed.client_id && !seed.title && seed.description === initialDescription && seed.category === 0);
    operation.current = null;
    serverPending.current = null;
    serverBlockedRef.current = false;
    serverRecoveryChoicesRef.current = [];
    setServerRecoveryChoices([]);
    setMode('draft');
    setForm(next);
    if (distinct) {
      distinctIntent.current = distinct.intent_id;
      distinctIntentExpiresAt.current = distinct.expiresAt;
      const stored = savePendingGlpiRequest(next, undefined, memberId, distinct, { preserveExpiredCapability: true });
      if (!stored.ok) setStorageIssue(stored.reason);
      announcePendingGlpiRequest(memberId, { payload: next, savedAt: Date.now(), distinctIntent: distinct });
    }
    uncertainPayload.current = null;
    currentCreated.current = null;
    setCategories([]);
    setUncertain(false);
    setDistinctRequired(false);
    setDistinctExpired(false);
    setCreated(null);
    setServerBlocked(false);
    setLegacyRequests([]);
    setPendingCheckFailed(false);
    setPendingChecked(true);
    setLoading(!!clientId);
    setRecoveryAction(null);
    // A distinct action may intentionally keep the component in `draft`.
    // Advance an explicit generation so options reload for draft → draft.
    setDraftEpoch(epoch => epoch + 1);
    return next;
  }

  async function openNew() {
    if (modeRef.current === 'uncertain' || modeRef.current === 'result') {
      setOpen(true);
      return;
    }
    if (modeRef.current === 'draft') {
      setOpen(true);
      return;
    }
    setOpen(true);
    setPendingChecked(false);
    setPendingCheckFailed(false);
    setError('');
    const found = await refreshPending(true, true);
    if (!mounted.current || currentMember.current !== memberId) return;
    if (found || operation.current || serverBlockedRef.current || serverDraftChoicesRef.current.length > 0 || serverRecoveryChoicesRef.current.length > 0) return;
    const clientId = clients.some(client => client.id === initialClient && client.active && client.glpi_entity_id !== null) ? initialClient : '';
    clearDistinctCapability();
    enterDraft(clientId, initialDescription);
  }

  async function authorizeDistinctRequest() {
    const request = begin('intent');
    try {
      const previousRequestId = operation.current?.request_id || serverPending.current?.payload.request_id;
      const marker = currentMarker();
      // Before reservation, a renewal keeps the exact draft UUID. A new
      // explicit action from an already-reserved/result operation gets a new
      // UUID, so it cannot ever replay that operation's result.
      const draftRequestId = !operation.current && marker && validRequestId(form.request_id)
        ? form.request_id
        : crypto.randomUUID();
      const draftPayload = canonical({ ...form, request_id: draftRequestId });
      const response = await fetch('/api/glpi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'beginDistinctCreation', draft_request_id: draftRequestId, draft_payload: draftPayload, ...(previousRequestId ? { previous_request_id: previousRequestId } : {}) }),
        signal: request.controller.signal,
      });
      const value = await apiValue(response);
      if (!request.valid()) return false;
      if (!response.ok) throw new Error(value.error || 'L’intention de nouvelle demande n’a pas pu être autorisée.');
      // The server may already have reserved this exact draft before the
      // browser received its response. Reuse its binding/result instead of
      // minting a conflicting capability or returning a misleading 409.
      if (value.operation) {
        const authoritative = value.operation;
        operation.current = authoritative.payload;
        uncertainPayload.current = authoritative.payload;
        serverPending.current = authoritative;
        setForm(authoritative.payload);
        distinctIntent.current = null;
        distinctIntentExpiresAt.current = null;
        setDistinctExpired(false);
        serverDraftChoicesRef.current = [];
        setServerDraftChoices([]);
        if (authoritative.ticket) {
          currentCreated.current = authoritative.ticket;
          setCreated(authoritative.ticket);
          draftOwned.current = false;
          setUncertain(false);
          setDistinctRequired(false);
          setMode('result');
          const stored = savePendingGlpiRequest(authoritative.payload, undefined, memberId, undefined, { announce: false });
          if (!stored.ok) setStorageIssue(stored.reason);
          setError('Résultat récupéré depuis le serveur membre-scopé. Confirmez sa consommation pour clore cette opération.');
        } else {
          currentCreated.current = null;
          draftOwned.current = false;
          setCreated(null);
          setUncertain(true);
          setDistinctRequired(false);
          setMode('uncertain');
          setRecoveryAction('retry');
          setError('La réservation de cette demande distincte existe déjà. Récupérez son résultat avec le même UUID.');
        }
        return true;
      }
      if (typeof value.intent_id !== 'string' || !/^[a-f0-9]{64}$/.test(value.intent_id)) throw new Error(value.error || 'L’intention de nouvelle demande n’a pas pu être autorisée.');
      if (typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) throw new Error('L’intention de nouvelle demande a expiré avant son utilisation.');
      const clientId = clients.some(client => client.id === form.client_id && client.active && client.glpi_entity_id !== null) ? form.client_id : '';
      enterDraft(clientId, '', form, { intent_id: value.intent_id, expiresAt: value.expiresAt }, draftRequestId);
      return true;
    } finally {
      finish('intent', request.controller);
    }
  }

  async function startDistinctRequest() {
    if (sending.current || busy) return;
    sending.current = true;
    setBusy(true);
    setError('');
    setRecoveryAction(null);
    try {
      await authorizeDistinctRequest();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'L’intention de nouvelle demande n’a pas pu être autorisée.');
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function updateClient(clientId: string) {
    updateForm({ client_id: clientId, category: 0 });
    setCategories([]);
    setLoading(!!clientId);
  }

  async function abandonLegacyRequest() {
    const legacy = legacyRequests[0];
    if (sending.current || !legacy) return;
    sending.current = true;
    setBusy(true);
    setError('');
    const request = begin('resolve');
    try {
      const response = await fetch('/api/glpi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resolveLegacyCreation', request_id: legacy.request_id, resolution: 'abandon' }), signal: request.controller.signal });
      const value = await response.json() as ApiValue;
      if (!request.valid()) return;
      if (!response.ok || value.ok !== true) throw new Error(value.error || 'L’opération historique reste bloquée.');
      setLegacyRequests([]);
      setServerBlocked(false);
      serverBlockedRef.current = false;
      setPendingChecked(true);
      await authorizeDistinctRequest();
    } catch (reason) {
      if (request.valid()) setError(reason instanceof Error ? reason.message : 'L’opération historique reste bloquée.');
    } finally {
      if (request.valid()) {
        sending.current = false;
        setBusy(false);
      }
      finish('resolve', request.controller);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (sending.current || modeRef.current !== 'draft' || created) return;
    const blockedForForm = serverBlocked || distinctRequired;
    if (blockedForForm || serverDraftChoicesRef.current.length > 0 || pendingCheckFailed || !pendingChecked) {
      setError('L’état de cette demande ne peut pas être vérifié de façon sûre. Vérifiez votre connexion avant de créer un ticket.');
      return;
    }
    sending.current = true;
    setBusy(true);
    setError('');
    setRecoveryAction(null);
    const payload = canonical(form);
    setForm(payload);
    const activeCapability = currentCapability();
    const marker = currentMarker();
    const stored = savePendingGlpiRequest(payload, undefined, memberId, marker, { preserveExpiredCapability: true });
    if (!stored.ok) setStorageIssue(stored.reason);
    announcePendingGlpiRequest(memberId, { payload, savedAt: Date.now(), ...(marker ? { distinctIntent: marker } : {}) });
    const request = begin('submit');
    let certainResponse = false;
    let distinctConflict = false;
    let distinctRenewalRequired = false;
    let intentExpired = false;
    try {
      const response = await fetch('/api/glpi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, action: 'createTicket', ...(distinctIntent.current ? { distinct_intent: distinctIntent.current } : {}) }), signal: request.controller.signal });
      const value = await apiValue(response);
      if (!request.valid()) return;
      if (!response.ok) {
        intentExpired = value.code === 'INTENT_EXPIRED';
        distinctRenewalRequired = intentExpired || value.code === 'INTENT_REQUIRED' || value.code === 'INTENT_REQUEST_MISMATCH';
        certainResponse = terminalFailure(value, !!activeCapability);
        distinctConflict = value.distinct_required === true || value.code === 'DISTINCT_REQUIRED';
        const authoritative = value.operation?.payload || payload;
        if (value.operation) {
          operation.current = authoritative;
          uncertainPayload.current = authoritative;
          setForm(authoritative);
        }
        if (value.uncertain) {
          draftOwned.current = false;
          setUncertain(true);
          setMode('uncertain');
        }
        throw new Error(value.error || 'Création impossible.');
      }
      if (!value.ticket) throw new Error('La réponse GLPI est incomplète.');
      // A successful response is the server's confirmation that any
      // capability attached to this reservation was consumed atomically.
      clearDistinctCapability();
      const authoritative = value.operation || { payload, createdAt: new Date().toISOString(), ticket: value.ticket };
      operation.current = authoritative.payload;
      uncertainPayload.current = authoritative.payload;
      serverPending.current = authoritative;
      draftOwned.current = false;
      setForm(authoritative.payload);
      setUncertain(false);
      setMode('result');
      setRecoveryAction(null);
      currentCreated.current = value.ticket;
      setCreated(value.ticket);
      const stored = savePendingGlpiRequest(authoritative.payload, undefined, memberId, undefined, { announce: false });
      if (!stored.ok) setStorageIssue(stored.reason);
      setError('Ticket créé dans GLPI. Confirmez sa consommation pour clore cette opération.');
    } catch (reason) {
      if (!request.valid()) return;
      if (distinctRenewalRequired) {
        // Expiry or disappearance of the server capability is a certain
        // refusal of this *distinct* draft, not an uncertain provider result.
        // Keep the same UUID/payload and require an explicit renewal; never
        // clear the durable marker or silently enter the ordinary alias path.
        draftOwned.current = true;
        operation.current = null;
        uncertainPayload.current = null;
        serverPending.current = null;
        setForm(payload);
        setUncertain(false);
        setMode('draft');
        setDistinctRequired(true);
        setDistinctExpired(intentExpired || !!marker && Date.parse(marker.expiresAt) <= Date.now());
        setRecoveryAction(null);
        setError(reason instanceof Error ? reason.message : 'L’intention de nouvelle demande doit être renouvelée explicitement.');
      } else if (!certainResponse) {
        draftOwned.current = false;
        setMode('uncertain');
        setUncertain(true);
        uncertainPayload.current = operation.current || payload;
        operation.current = uncertainPayload.current;
        setForm(uncertainPayload.current);
        setRecoveryAction('retry');
        setError('Résultat incertain : la demande a peut-être été acceptée par GLPI. Vérifiez vos tickets avant toute nouvelle demande.');
      } else {
        clearDistinctCapability();
        removePendingGlpiRequest(payload.request_id, undefined, memberId);
        announcePendingGlpiRequest(memberId, null);
        operation.current = null;
        uncertainPayload.current = null;
        serverPending.current = null;
        draftOwned.current = true;
        setUncertain(false);
        setMode('draft');
        setDistinctRequired(distinctConflict);
        // A certain rejection is a terminal tombstone for this UUID. Keep the
        // business fields visible, but make the next attempt a new operation.
        setForm({ ...payload, request_id: crypto.randomUUID() });
        setError(reason instanceof Error ? reason.message : 'Création refusée. Corrigez le formulaire puis réessayez.');
      }
    } finally {
      if (request.valid()) {
        sending.current = false;
        setBusy(false);
      }
      finish('submit', request.controller);
    }
  }

  async function reconcile() {
    if (sending.current || modeRef.current !== 'uncertain') return;
    const payload = uncertainPayload.current || operation.current;
    if (!payload) return;
    sending.current = true;
    setBusy(true);
    setError('');
    const request = begin('submit');
    let terminalResponse = false;
    let responseStatus: number | null = null;
    let distinctRenewalRequired = false;
    let intentExpired = false;
    const activeCapability = currentCapability();
    try {
      const response = await fetch('/api/glpi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, action: 'createTicket', ...(distinctIntent.current ? { distinct_intent: distinctIntent.current } : {}) }), signal: request.controller.signal });
      responseStatus = response.status;
      const value = await apiValue(response);
      if (!request.valid()) return;
      if (!response.ok) {
        intentExpired = value.code === 'INTENT_EXPIRED';
        distinctRenewalRequired = intentExpired || value.code === 'INTENT_REQUIRED' || value.code === 'INTENT_REQUEST_MISMATCH';
        terminalResponse = terminalFailure(value, !!activeCapability);
        if (value.operation?.payload) {
          operation.current = value.operation.payload;
          uncertainPayload.current = value.operation.payload;
          setForm(value.operation.payload);
        }
        throw new Error(value.error || 'Le résultat reste incertain.');
      }
      if (!value.ticket) throw new Error('Le résultat reste incertain.');
      // A successful replay confirms the same reservation and any attached
      // capability; this is the only normal path that clears it client-side.
      clearDistinctCapability();
      const authoritative = value.operation || { payload, createdAt: new Date().toISOString(), ticket: value.ticket };
      operation.current = authoritative.payload;
      uncertainPayload.current = authoritative.payload;
      serverPending.current = authoritative;
      draftOwned.current = false;
      setForm(authoritative.payload);
      setCreated(value.ticket);
      currentCreated.current = value.ticket;
      setUncertain(false);
      setDistinctRequired(false);
      setMode('result');
      setRecoveryAction(null);
      const stored = savePendingGlpiRequest(authoritative.payload, undefined, memberId, undefined, { announce: false });
      if (!stored.ok) setStorageIssue(stored.reason);
      setError('Résultat récupéré explicitement. Confirmez sa consommation pour clore cette opération.');
    } catch (reason) {
      if (request.valid()) {
        if (distinctRenewalRequired) {
          // The provider was never addressed under this expired/missing
          // capability. Return to the same explicit draft and ask for a new
          // server intention instead of recovering or aliasing anything.
          draftOwned.current = true;
          operation.current = null;
          uncertainPayload.current = null;
          serverPending.current = null;
          setForm(payload);
          setUncertain(false);
          setMode('draft');
          setDistinctRequired(true);
          const marker = currentMarker();
          setDistinctExpired(intentExpired || !!marker && Date.parse(marker.expiresAt) <= Date.now());
          setRecoveryAction(null);
        } else if (terminalResponse) {
          const fresh = uncertainPayload.current || operation.current || payload;
          clearDistinctCapability();
          removePendingGlpiRequest(payload.request_id, undefined, memberId);
          announcePendingGlpiRequest(memberId, null);
          operation.current = null;
          uncertainPayload.current = null;
          serverPending.current = null;
          enterDraft(fresh.client_id, '', fresh);
          setRecoveryAction(null);
        } else {
          // A recovery transport/auth/rate-limit/infra failure says nothing
          // about the provider operation. Keep the exact UUID and payload
          // locked; only the same operation may be retried.
          draftOwned.current = false;
          const preserved = uncertainPayload.current || operation.current || payload;
          uncertainPayload.current = preserved;
          operation.current = operation.current || preserved;
          setForm(preserved);
          setUncertain(true);
          setMode('uncertain');
          setRecoveryAction(responseStatus === 401 || responseStatus === 403 ? 'reauth' : 'retry');
        }
        setError(reason instanceof Error ? reason.message : 'Le résultat reste incertain. Vérifiez vos tickets dans GLPI.');
      }
    } finally {
      if (request.valid()) {
        sending.current = false;
        setBusy(false);
      }
      finish('submit', request.controller);
    }
  }

  async function consumeCreated() {
    const ticket = currentCreated.current;
    const payload = operation.current;
    if (sending.current || !ticket || !payload) return;
    sending.current = true;
    setBusy(true);
    setError('');
    const request = begin('ack');
    try {
      const response = await fetch('/api/glpi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'acknowledgeCreation', request_id: payload.request_id, ticket_id: ticket.id }), signal: request.controller.signal });
      const value = await apiValue(response);
      if (!request.valid()) return;
      if (!response.ok || value.ok !== true) throw new Error('Le résultat n’a pas pu être confirmé. Il reste conservé pour récupération.');
      const acknowledged = markGlpiCreationAcknowledged(memberId, payload.request_id, ticket.id, value.ack_scope);
      if (!acknowledged.ok) throw new Error('La confirmation ACK a été reçue, mais son état durable n’a pas pu être conservé. Réessayez sans fermer cette page.');
      removePendingGlpiRequest(payload.request_id, undefined, memberId);
      announcePendingGlpiRequest(memberId, null);
      operation.current = null;
      uncertainPayload.current = null;
      serverPending.current = null;
      currentCreated.current = null;
      draftOwned.current = false;
      // Consumption closes the old draft identity in the UI as well as on
      // the server. A subsequent "Nouveau ticket" must start from a clean
      // form; keeping the consumed UUID in formRequestIdRef would otherwise
      // prevent refreshPending from adopting a different still-recoverable
      // operation and could make the consumed result appear to return.
      setForm(blankForm(initialDescription));
      setCategories([]);
      setCreated(null);
      setUncertain(false);
      setDistinctRequired(false);
      setRecoveryAction(null);
      setMode('idle');
      setOpen(false);
      onCreated(ticket);
    } catch (reason) {
      if (request.valid()) setError(reason instanceof Error ? reason.message : 'Le résultat n’a pas pu être confirmé.');
    } finally {
      if (request.valid()) {
        sending.current = false;
        setBusy(false);
      }
      finish('ack', request.controller);
    }
  }

  const blockedForForm = serverBlocked || distinctRequired || (pendingCheckFailed && mode !== 'draft') || (!pendingChecked && mode !== 'draft');
  return <>
    <button type="button" className="text-button" disabled={disabled} onClick={() => void openNew()}><Plus size={15} />Nouveau ticket GLPI</button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="calendar-dialog quick-dialog" onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
        <DialogTitle>{created ? 'Ticket créé dans GLPI' : serverDraftChoices.length > 1 ? 'Brouillons distincts à choisir' : serverRecoveryChoices.length > 1 ? 'Récupérations GLPI à choisir' : uncertain ? 'Résultat incertain' : distinctRequired ? 'Nouvelle demande distincte requise' : 'Créer un ticket GLPI'}</DialogTitle>
        <DialogDescription>Le ticket sera créé dans l’entité du client avec vos droits GLPI personnels.</DialogDescription>
        {error && <div className="alert error" role="alert">{error}</div>}
        {storageIssue && <div className="alert error" role="status">Le stockage local de ce navigateur est indisponible ou invalide. L’état serveur membre-scopé est utilisé ; aucune nouvelle création ne sera envoyée sans vérification.</div>}
        {legacyRequests.length > 0 && <div className="alert error glpi-legacy" role="alert"><strong>Création GLPI historique à résoudre</strong><span>Cette ancienne opération n’a ni payload ni résultat confirmé. Vérifiez GLPI avant toute création, puis abandonnez-la explicitement si aucun ticket n’existe.</span><button type="button" className="secondary" disabled={busy} onClick={() => void abandonLegacyRequest()}>J’ai vérifié GLPI — abandonner l’opération</button></div>}
        {serverDraftChoices.length > 1 && !created && !uncertain && <div className="alert error glpi-conflict" role="alert"><strong>Plusieurs brouillons distincts sont conservés par le serveur</strong><span>Choisissez le brouillon exact à reprendre. Aucun ancien ticket ne sera sélectionné automatiquement.</span>{serverDraftChoices.map(draft => <button key={draft.draft_request_id} type="button" className="text-button" disabled={busy} onClick={() => applyServerDraft(draft)}>Reprendre « {draft.payload.title || draft.payload.description.slice(0, 48)} »</button>)}</div>}
        {serverRecoveryChoices.length > 1 && !created && <div className="alert error glpi-conflict" role="alert"><strong>Plusieurs résultats GLPI peuvent être récupérés</strong><span>La page ne choisit jamais la première ligne : sélectionnez l’UUID correspondant à votre demande.</span>{serverRecoveryChoices.map(request => <button key={request.payload.request_id} type="button" className="text-button" disabled={busy} onClick={() => applyServerRequest(request)}>Récupérer « {request.payload.title || request.payload.description.slice(0, 48)} »</button>)}</div>}
        {distinctRequired && !created && !uncertain && <div className="alert error glpi-conflict" role="alert"><strong>{distinctExpired ? 'Intention distincte expirée' : 'Nouvelle demande distincte requise'}</strong><span>{distinctExpired ? 'Cette intention serveur a expiré ou n’est plus disponible. Le même brouillon reste verrouillé : renouvelez explicitement l’intention avant de créer le ticket.' : 'Ces champs correspondent à une demande déjà terminée. Autorisez explicitement une nouvelle intention pour conserver les mêmes champs métier.'}</span><button type="button" className="text-button" disabled={busy} onClick={() => void startDistinctRequest()}>{distinctExpired ? 'Renouveler l’intention distincte' : 'Commencer une nouvelle demande distincte'}</button></div>}
        {uncertain && !created && <div className="alert error glpi-uncertain" role="status"><strong>Résultat incertain</strong><span>La réponse de GLPI n’a pas pu être confirmée. Le même UUID et le même payload restent conservés ; aucun renvoi automatique ne sera effectué.</span>{recoveryAction === 'reauth' && <span>Votre session a expiré. Reconnectez votre compte GLPI, puis réessayez avec cette même demande.</span>}{recoveryAction === 'retry' && <span>Vérifiez votre connexion ou patientez après le délai indiqué, puis réessayez avec cette même demande.</span>}<div className="quick-actions"><button type="button" className="secondary" aria-label="Réessayer la récupération du résultat GLPI" disabled={busy} onClick={() => void reconcile()}>Récupérer le résultat</button>{status?.web && <a href={status.web} target="_blank" rel="noreferrer" className="text-button">Vérifier dans GLPI</a>}</div><button type="button" className="text-button" disabled={busy} onClick={() => void startDistinctRequest()}>Commencer une nouvelle demande distincte</button></div>}
        {created ? <div className="glpi-created"><p role="status"><Check size={18} />GLPI-{created.id} · {created.title}</p><a href={created.url} target="_blank" rel="noreferrer" className="text-button"><ExternalLink size={16} />Ouvrir dans GLPI</a><div className="quick-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>Fermer</button><button type="button" className="primary" disabled={busy} onClick={() => void consumeCreated()}>Utiliser ce ticket</button></div><button type="button" className="text-button" disabled={busy} onClick={() => void startDistinctRequest()}>Commencer une nouvelle demande distincte</button></div> : !status ? <p>Vérification de la connexion GLPI…</p> : !status.configured || !status.connected ? <p>Connectez d’abord votre compte depuis « Mes tickets GLPI ».</p> : !status.canCreate ? <p>La création de tickets est désactivée dans cet environnement. Votre administrateur peut l’activer pour une instance GLPI autorisée.</p> : <form className="quick-form" onSubmit={submit}>
          <fieldset disabled={busy || uncertain || blockedForForm || serverDraftChoices.length > 0}>
            <label>Client<select required value={form.client_id} onChange={event => updateClient(event.target.value)}><option value="">Choisir le client</option>{clients.filter(client => client.active && client.glpi_entity_id !== null).map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
            <label>Type<select value={form.type} onChange={event => updateForm({ type: Number(event.target.value) })}><option value={1}>Incident</option><option value={2}>Demande</option></select></label>
            <label className="span-all">Titre<input autoFocus required maxLength={250} value={form.title} onChange={event => updateForm({ title: event.target.value })} /></label>
            <label className="span-all">Description<textarea required rows={4} maxLength={4000} value={form.description} onChange={event => updateForm({ description: event.target.value })} /></label>
            <label>Catégorie<select disabled={loading} value={form.category} onChange={event => updateForm({ category: Number(event.target.value) })}><option value={0}>{loading ? 'Chargement…' : 'Non précisée'}</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label>Urgence<select value={form.urgency} onChange={event => updateForm({ urgency: Number(event.target.value) })}>{['Très basse', 'Basse', 'Moyenne', 'Haute', 'Très haute'].map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label>
          </fieldset>
          <p className="form-note">Seuls les clients associés à une entité GLPI sont proposés. Les règles et champs obligatoires de GLPI restent applicables.</p>
          <div className="quick-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>Fermer</button><button className="primary" disabled={busy || loading || uncertain || blockedForForm || serverDraftChoices.length > 0 || !form.client_id}>{busy ? 'Création…' : 'Créer dans GLPI'}</button></div>
        </form>}
      </DialogContent>
    </Dialog>
  </>;
}
