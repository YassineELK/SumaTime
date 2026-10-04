'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Check, ExternalLink, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { Client } from '@/lib/types';
import type { GlpiCreationOperation, GlpiTicket } from '@/lib/glpi';
import { announcePendingGlpiRequest, getGlpiDraftStorageStatus, readPendingGlpiRequest, removePendingGlpiRequest, savePendingGlpiRequest, subscribePendingGlpiRequest, type GlpiDraftStorageStatus, type GlpiRequestPayload, type PendingGlpiRequest } from '@/lib/glpi-draft';

type Status = { configured: boolean; connected: boolean; canCreate: boolean; web: string | null };
type Category = { id: number; name: string };
type Form = GlpiRequestPayload;
type ServerRequest = GlpiCreationOperation;
type LegacyRequest = { request_id: string; createdAt: string; apiUrl: string };
type ApiValue = { ok?: boolean; error?: string; uncertain?: boolean; distinct_required?: boolean; ticket?: GlpiTicket; operation?: ServerRequest; categories?: Category[]; limited?: boolean; requests?: ServerRequest[]; recoverable?: ServerRequest[]; legacy?: LegacyRequest[]; blocked?: boolean; intent_id?: string; expiresAt?: string } & Partial<Status>;
type AsyncKind = 'pending' | 'status' | 'options' | 'submit' | 'ack' | 'resolve' | 'intent';
type UiMode = 'idle' | 'draft' | 'uncertain' | 'result';

// A successful ACK is remembered for the lifetime of this page module. This
// prevents a normal subsequent "new ticket" click from resurfacing an older
// recoverable result, while a remount after a lost ACK response still has no
// marker and can retrieve the server-authoritative result.
const consumedOperations = new Set<string>();
function consumedKey(memberId: string, requestId: string) { return memberId + ':' + requestId; }

function newForm(clientId: string, description: string): Form {
  return { request_id: crypto.randomUUID(), client_id: clientId, title: '', description, type: 1, urgency: 3, category: 0 };
}

function blankForm(description: string): Form {
  return { request_id: '', client_id: '', title: '', description, type: 1, urgency: 3, category: 0 };
}

function canonical(form: Form): Form {
  return { ...form, client_id: form.client_id.trim(), title: form.title.trim(), description: form.description.trim() };
}

export default function NewGlpiTicket({ clients, memberId = '', initialClient = '', initialDescription = '', disabled = false, onCreated }: { clients: Client[]; memberId?: string; initialClient?: string; initialDescription?: string; disabled?: boolean; onCreated: (ticket: GlpiTicket) => void }) {
  const [initialPending] = useState<PendingGlpiRequest | null>(() => readPendingGlpiRequest(initialClient, initialDescription, undefined, memberId));
  const initialMode: UiMode = initialPending ? 'uncertain' : 'idle';
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [form, setForm] = useState<Form>(() => initialPending?.payload || blankForm(initialDescription));
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(initialMode === 'uncertain');
  const [created, setCreated] = useState<GlpiTicket | null>(null);
  const [distinctRequired, setDistinctRequired] = useState(false);
  const [mode, setModeState] = useState<UiMode>(initialMode);
  const [storageIssue, setStorageIssue] = useState<Exclude<GlpiDraftStorageStatus, 'ok'> | null>(() => {
    const value = getGlpiDraftStorageStatus(memberId);
    return value === 'ok' ? null : value;
  });
  const [pendingChecked, setPendingChecked] = useState(false);
  const [serverBlocked, setServerBlocked] = useState(false);
  const [pendingCheckFailed, setPendingCheckFailed] = useState(false);
  const [legacyRequests, setLegacyRequests] = useState<LegacyRequest[]>([]);
  const sending = useRef(false);
  const mounted = useRef(false);
  const currentMember = useRef(memberId);
  const memberEpoch = useRef(0);
  const modeRef = useRef<UiMode>(initialMode);
  const operation = useRef<Form | null>(initialPending?.payload || null);
  const uncertainPayload = useRef<Form | null>(initialPending?.payload || null);
  const currentCreated = useRef<GlpiTicket | null>(null);
  const draftOwned = useRef(false);
  const serverPending = useRef<ServerRequest | null>(null);
  const distinctIntent = useRef<string | null>(null);
  const serverBlockedRef = useRef(false);
  const controllers = useRef(new Map<AsyncKind, AbortController>());
  const sequences = useRef<Record<AsyncKind, number>>({ pending: 0, status: 0, options: 0, submit: 0, ack: 0, resolve: 0, intent: 0 });

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
    distinctIntent.current = null;
    serverBlockedRef.current = false;
    setOpen(false);
    setStatus(null);
    setCategories([]);
    setForm(blankForm(initialDescription));
    setMode('idle');
    setUncertain(false);
    setCreated(null);
    setDistinctRequired(false);
    setBusy(false);
    setLoading(false);
    setError('');
    setPendingChecked(false);
    setPendingCheckFailed(false);
    setServerBlocked(false);
    setLegacyRequests([]);
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
    operation.current = pendingRequest.payload;
    uncertainPayload.current = pendingRequest.payload;
    currentCreated.current = null;
    setForm(pendingRequest.payload);
    setUncertain(true);
    setDistinctRequired(false);
    setCreated(null);
    setMode('uncertain');
    setCategories([]);
    setError('Résultat incertain : la demande conservée utilise le même UUID et le même payload. Récupérez son résultat avant toute nouvelle demande.');
  }, [setMode]);

  const applyServerRequest = useCallback((request: ServerRequest) => {
    const requestId = request.payload.request_id;
    if (draftOwned.current && operation.current?.request_id !== requestId) {
      serverPending.current = request;
      return;
    }
    if ((modeRef.current === 'uncertain' || modeRef.current === 'result') && operation.current?.request_id !== requestId) {
      serverPending.current = request;
      return;
    }
    operation.current = request.payload;
    uncertainPayload.current = request.payload;
    serverPending.current = request;
    setForm(request.payload);
    if (request.ticket) {
      currentCreated.current = request.ticket;
      setCreated(request.ticket);
      setUncertain(false);
      setDistinctRequired(false);
      setMode('result');
      setError('Résultat récupéré depuis le serveur membre-scopé. Confirmez sa consommation pour clore cette opération.');
    } else {
      currentCreated.current = null;
      setCreated(null);
      setUncertain(true);
      setDistinctRequired(false);
      setMode('uncertain');
      setError('Résultat incertain : la demande conservée utilise le même UUID et le même payload. Récupérez son résultat avant toute nouvelle demande.');
    }
  }, [setMode]);

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
      const recoverable = includeAcknowledged ? (value.recoverable || []).filter(item => !consumedOperations.has(consumedKey(memberId, item.payload.request_id))) : [];
      const requests = [...(value.requests || []), ...recoverable];
      const activeId = operation.current?.request_id;
      const matching = requests.find(item => activeId && item.payload.request_id === activeId)
        || requests.find(item => (!initialClient || item.payload.client_id === initialClient) && (!initialDescription.trim() || item.payload.description === initialDescription.trim()))
        || (!draftOwned.current ? requests[0] : undefined);
      if (matching) {
        serverPending.current = matching;
        if (adopt || !draftOwned.current) applyServerRequest(matching);
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
  }, [applyServerRequest, begin, finish, initialClient, initialDescription, memberId]);

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
  }, [begin, finish, form.client_id, mode, open, status?.canCreate, status?.connected, uncertain]);

  function markDraft() {
    if (modeRef.current !== 'draft') setMode('draft');
    draftOwned.current = true;
    setError('');
  }

  function updateForm(patch: Partial<Form>) {
    markDraft();
    setDistinctRequired(false);
    setForm(value => ({ ...value, ...patch }));
  }

  function enterDraft(clientId: string, description: string, seed?: Form) {
    draftOwned.current = true;
    operation.current = null;
    serverPending.current = null;
    serverBlockedRef.current = false;
    setMode('draft');
    setForm(seed
      ? { ...seed, request_id: crypto.randomUUID(), client_id: clientId || seed.client_id }
      : newForm(clientId, description));
    uncertainPayload.current = null;
    currentCreated.current = null;
    setCategories([]);
    setUncertain(false);
    setDistinctRequired(false);
    setCreated(null);
    setServerBlocked(false);
    setLegacyRequests([]);
    setPendingCheckFailed(false);
    setPendingChecked(true);
    setLoading(!!clientId);
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
    if (found || operation.current || serverBlockedRef.current) return;
    const clientId = clients.some(client => client.id === initialClient && client.active && client.glpi_entity_id !== null) ? initialClient : '';
    distinctIntent.current = null;
    enterDraft(clientId, initialDescription);
  }

  async function authorizeDistinctRequest() {
    const request = begin('intent');
    try {
      const previousRequestId = operation.current?.request_id || serverPending.current?.payload.request_id;
      const response = await fetch('/api/glpi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'beginDistinctCreation', ...(previousRequestId ? { previous_request_id: previousRequestId } : {}) }),
        signal: request.controller.signal,
      });
      const value = await response.json() as ApiValue;
      if (!request.valid()) return false;
      if (!response.ok || typeof value.intent_id !== 'string' || !/^[a-f0-9]{64}$/.test(value.intent_id)) throw new Error(value.error || 'L’intention de nouvelle demande n’a pas pu être autorisée.');
      distinctIntent.current = value.intent_id;
      const clientId = clients.some(client => client.id === form.client_id && client.active && client.glpi_entity_id !== null) ? form.client_id : '';
      enterDraft(clientId, '', form);
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
    const blockedForForm = serverBlocked;
    if (blockedForForm || pendingCheckFailed || !pendingChecked) {
      setError('L’état de cette demande ne peut pas être vérifié de façon sûre. Vérifiez votre connexion avant de créer un ticket.');
      return;
    }
    sending.current = true;
    setBusy(true);
    setError('');
    const payload = canonical(form);
    setForm(payload);
    const stored = savePendingGlpiRequest(payload, undefined, memberId);
    if (!stored.ok) setStorageIssue(stored.reason);
    announcePendingGlpiRequest(memberId, { payload, savedAt: Date.now() });
    const request = begin('submit');
    let certainResponse = false;
    let distinctConflict = false;
    try {
      const response = await fetch('/api/glpi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, action: 'createTicket', ...(distinctIntent.current ? { distinct_intent: distinctIntent.current } : {}) }), signal: request.controller.signal });
      const value = await response.json() as ApiValue;
      if (!request.valid()) return;
      if (!response.ok) {
        distinctIntent.current = null;
        certainResponse = value.uncertain !== true;
        distinctConflict = response.status === 409 && (value.distinct_required === true || /demande identique|nouvelle demande distincte|utilisez explicitement.*distinct/i.test(value.error || ''));
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
      distinctIntent.current = null;
      const authoritative = value.operation || { payload, createdAt: new Date().toISOString(), ticket: value.ticket };
      operation.current = authoritative.payload;
      uncertainPayload.current = authoritative.payload;
      serverPending.current = authoritative;
      draftOwned.current = false;
      setForm(authoritative.payload);
      setUncertain(false);
      setMode('result');
      currentCreated.current = value.ticket;
      setCreated(value.ticket);
      removePendingGlpiRequest(authoritative.payload.request_id, undefined, memberId);
      announcePendingGlpiRequest(memberId, null);
      setError('Ticket créé dans GLPI. Confirmez sa consommation pour clore cette opération.');
    } catch (reason) {
      if (!request.valid()) return;
      if (!certainResponse) {
        draftOwned.current = false;
        setMode('uncertain');
        setUncertain(true);
        uncertainPayload.current = operation.current || payload;
        operation.current = uncertainPayload.current;
        setForm(uncertainPayload.current);
        setError('Résultat incertain : la demande a peut-être été acceptée par GLPI. Vérifiez vos tickets avant toute nouvelle demande.');
      } else {
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
    let certainResponse = false;
    try {
      const response = await fetch('/api/glpi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, action: 'createTicket', ...(distinctIntent.current ? { distinct_intent: distinctIntent.current } : {}) }), signal: request.controller.signal });
      const value = await response.json() as ApiValue;
      if (!request.valid()) return;
      if (!response.ok) {
        if (value.operation || value.uncertain) distinctIntent.current = null;
        certainResponse = value.uncertain !== true;
        if (value.operation?.payload) {
          operation.current = value.operation.payload;
          uncertainPayload.current = value.operation.payload;
          setForm(value.operation.payload);
        }
        throw new Error(value.error || 'Le résultat reste incertain.');
      }
      if (!value.ticket) throw new Error('Le résultat reste incertain.');
      distinctIntent.current = null;
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
      removePendingGlpiRequest(authoritative.payload.request_id, undefined, memberId);
      announcePendingGlpiRequest(memberId, null);
      setError('Résultat récupéré explicitement. Confirmez sa consommation pour clore cette opération.');
    } catch (reason) {
      if (request.valid()) {
        if (certainResponse) {
          const fresh = { ...(uncertainPayload.current || operation.current || payload), request_id: crypto.randomUUID() };
          distinctIntent.current = null;
          operation.current = null;
          uncertainPayload.current = null;
          serverPending.current = null;
          draftOwned.current = true;
          setUncertain(false);
          setMode('draft');
          setDistinctRequired(false);
          setForm(fresh);
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
      const value = await response.json() as ApiValue & { ok?: boolean };
      if (!request.valid()) return;
      if (!response.ok || value.ok !== true) throw new Error('Le résultat n’a pas pu être confirmé. Il reste conservé pour récupération.');
      consumedOperations.add(consumedKey(memberId, payload.request_id));
      removePendingGlpiRequest(payload.request_id, undefined, memberId);
      announcePendingGlpiRequest(memberId, null);
      operation.current = null;
      uncertainPayload.current = null;
      serverPending.current = null;
      currentCreated.current = null;
      draftOwned.current = false;
      setCreated(null);
      setUncertain(false);
      setDistinctRequired(false);
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

  const blockedForForm = serverBlocked || (pendingCheckFailed && mode !== 'draft') || (!pendingChecked && mode !== 'draft');
  return <>
    <button type="button" className="text-button" disabled={disabled} onClick={() => void openNew()}><Plus size={15} />Nouveau ticket GLPI</button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="calendar-dialog quick-dialog" onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
        <DialogTitle>{created ? 'Ticket créé dans GLPI' : uncertain ? 'Résultat incertain' : distinctRequired ? 'Nouvelle demande distincte requise' : 'Créer un ticket GLPI'}</DialogTitle>
        <DialogDescription>Le ticket sera créé dans l’entité du client avec vos droits GLPI personnels.</DialogDescription>
        {error && <div className="alert error" role="alert">{error}</div>}
        {storageIssue && <div className="alert error" role="status">Le stockage local de ce navigateur est indisponible ou invalide. L’état serveur membre-scopé est utilisé ; aucune nouvelle création ne sera envoyée sans vérification.</div>}
        {legacyRequests.length > 0 && <div className="alert error glpi-legacy" role="alert"><strong>Création GLPI historique à résoudre</strong><span>Cette ancienne opération n’a ni payload ni résultat confirmé. Vérifiez GLPI avant toute création, puis abandonnez-la explicitement si aucun ticket n’existe.</span><button type="button" className="secondary" disabled={busy} onClick={() => void abandonLegacyRequest()}>J’ai vérifié GLPI — abandonner l’opération</button></div>}
        {distinctRequired && !created && !uncertain && <div className="alert error glpi-conflict" role="alert"><strong>Nouvelle demande distincte requise</strong><span>Ces champs correspondent à une demande déjà terminée. Autorisez explicitement une nouvelle intention pour conserver les mêmes champs métier.</span><button type="button" className="text-button" disabled={busy} onClick={() => void startDistinctRequest()}>Commencer une nouvelle demande distincte</button></div>}
        {uncertain && !created && <div className="alert error glpi-uncertain" role="status"><strong>Résultat incertain</strong><span>La réponse de GLPI n’a pas pu être confirmée. Le même UUID et le même payload restent conservés ; aucun renvoi automatique ne sera effectué.</span><div className="quick-actions"><button type="button" className="secondary" disabled={busy} onClick={() => void reconcile()}>Récupérer le résultat</button>{status?.web && <a href={status.web} target="_blank" rel="noreferrer" className="text-button">Vérifier dans GLPI</a>}</div><button type="button" className="text-button" disabled={busy} onClick={() => void startDistinctRequest()}>Commencer une nouvelle demande distincte</button></div>}
        {created ? <div className="glpi-created"><p role="status"><Check size={18} />GLPI-{created.id} · {created.title}</p><a href={created.url} target="_blank" rel="noreferrer" className="text-button"><ExternalLink size={16} />Ouvrir dans GLPI</a><div className="quick-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>Fermer</button><button type="button" className="primary" disabled={busy} onClick={() => void consumeCreated()}>Utiliser ce ticket</button></div><button type="button" className="text-button" disabled={busy} onClick={() => void startDistinctRequest()}>Commencer une nouvelle demande distincte</button></div> : !status ? <p>Vérification de la connexion GLPI…</p> : !status.configured || !status.connected ? <p>Connectez d’abord votre compte depuis « Mes tickets GLPI ».</p> : !status.canCreate ? <p>La création de tickets est désactivée dans cet environnement. Votre administrateur peut l’activer pour une instance GLPI autorisée.</p> : <form className="quick-form" onSubmit={submit}>
          <fieldset disabled={busy || uncertain || blockedForForm}>
            <label>Client<select required value={form.client_id} onChange={event => updateClient(event.target.value)}><option value="">Choisir le client</option>{clients.filter(client => client.active && client.glpi_entity_id !== null).map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
            <label>Type<select value={form.type} onChange={event => updateForm({ type: Number(event.target.value) })}><option value={1}>Incident</option><option value={2}>Demande</option></select></label>
            <label className="span-all">Titre<input autoFocus required maxLength={250} value={form.title} onChange={event => updateForm({ title: event.target.value })} /></label>
            <label className="span-all">Description<textarea required rows={4} maxLength={4000} value={form.description} onChange={event => updateForm({ description: event.target.value })} /></label>
            <label>Catégorie<select disabled={loading} value={form.category} onChange={event => updateForm({ category: Number(event.target.value) })}><option value={0}>{loading ? 'Chargement…' : 'Non précisée'}</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label>Urgence<select value={form.urgency} onChange={event => updateForm({ urgency: Number(event.target.value) })}>{['Très basse', 'Basse', 'Moyenne', 'Haute', 'Très haute'].map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label>
          </fieldset>
          <p className="form-note">Seuls les clients associés à une entité GLPI sont proposés. Les règles et champs obligatoires de GLPI restent applicables.</p>
          <div className="quick-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>Fermer</button><button className="primary" disabled={busy || loading || uncertain || blockedForForm || !form.client_id}>{busy ? 'Création…' : 'Créer dans GLPI'}</button></div>
        </form>}
      </DialogContent>
    </Dialog>
  </>;
}
