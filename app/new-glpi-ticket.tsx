'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, ExternalLink, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { Client } from '@/lib/types';
import type { GlpiTicket } from '@/lib/glpi';
import { announcePendingGlpiRequest, getGlpiDraftStorageStatus, readPendingGlpiRequest, removePendingGlpiRequest, savePendingGlpiRequest, subscribePendingGlpiRequest, type GlpiDraftStorageStatus, type GlpiRequestPayload, type PendingGlpiRequest } from '@/lib/glpi-draft';

type Status = { configured: boolean; connected: boolean; canCreate: boolean; web: string | null };
type Category = { id: number; name: string };
type Form = GlpiRequestPayload;
type ServerRequest = { payload: GlpiRequestPayload; createdAt: string; ticket?: GlpiTicket };
type ApiValue = { error?: string; uncertain?: boolean; ticket?: GlpiTicket; categories?: Category[]; limited?: boolean; requests?: ServerRequest[]; blocked?: boolean } & Partial<Status>;

function newForm(clientId: string, description: string): Form {
  return { request_id: crypto.randomUUID(), client_id: clientId, title: '', description, type: 1, urgency: 3, category: 0 };
}

function blankForm(description: string): Form {
  return { request_id: '', client_id: '', title: '', description, type: 1, urgency: 3, category: 0 };
}

function canonical(form: Form): Form {
  return { ...form, title: form.title.trim(), description: form.description.trim() };
}

export default function NewGlpiTicket({ clients, memberId = '', initialClient = '', initialDescription = '', disabled = false, onCreated }: { clients: Client[]; memberId?: string; initialClient?: string; initialDescription?: string; disabled?: boolean; onCreated: (ticket: GlpiTicket) => void }) {
  const [initialPending] = useState<PendingGlpiRequest | null>(() => readPendingGlpiRequest(initialClient, initialDescription, undefined, memberId));
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [form, setForm] = useState<Form>(() => initialPending?.payload || blankForm(initialDescription));
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(!!initialPending);
  const [created, setCreated] = useState<GlpiTicket | null>(null);
  const [storageIssue, setStorageIssue] = useState<Exclude<GlpiDraftStorageStatus, 'ok'> | null>(() => {
    const value = getGlpiDraftStorageStatus(memberId);
    return value === 'ok' ? null : value;
  });
  const [pendingChecked, setPendingChecked] = useState(false);
  const [serverBlocked, setServerBlocked] = useState(false);
  const [pendingCheckFailed, setPendingCheckFailed] = useState(false);
  const sending = useRef(false);
  const uncertainPayload = useRef<Form | null>(initialPending?.payload || null);
  const currentMember = useRef(memberId);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const applyPending = useCallback((pendingRequest: PendingGlpiRequest) => {
    if (!mounted.current) return;
    uncertainPayload.current = pendingRequest.payload;
    setForm(pendingRequest.payload);
    setUncertain(true);
    setCreated(null);
    setCategories([]);
    setError('Résultat incertain : la demande conservée utilise le même UUID et le même payload. Récupérez son résultat avant toute nouvelle demande.');
  }, []);

  const acknowledge = useCallback((requestId: string) => {
    void fetch('/api/glpi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'acknowledgeCreation', request_id: requestId }) }).catch(() => {});
  }, []);

  const applyServerRequest = useCallback((request: ServerRequest) => {
    const value = { payload: request.payload, savedAt: Date.parse(request.createdAt) || Date.now() };
    if (request.ticket) {
      uncertainPayload.current = request.payload;
      setForm(request.payload);
      setUncertain(false);
      setCreated(request.ticket);
      setError('Résultat récupéré depuis le serveur membre-scopé. Aucun nouveau ticket ne sera créé.');
      acknowledge(request.payload.request_id);
    } else applyPending(value);
  }, [acknowledge, applyPending]);

  const refreshPending = useCallback(async () => {
    if (!mounted.current) return null;
    setPendingChecked(false);
    try {
      const response = await fetch('/api/glpi?uncertain=1', { cache: 'no-store' });
      const value = await response.json() as ApiValue;
      if (!response.ok) throw new Error(value.error || 'L’état GLPI ne peut pas être vérifié.');
      if (!mounted.current) return null;
      setPendingCheckFailed(false);
      setServerBlocked(value.blocked === true);
      if (value.blocked) setStorageIssue('corrupt');
      const requests = value.requests || [];
      const matching = requests.find(item => (!initialClient || item.payload.client_id === initialClient)
        && (!initialDescription.trim() || item.payload.description === initialDescription.trim())) || requests[0];
      if (matching) applyServerRequest(matching);
      setPendingChecked(true);
      return matching || null;
    } catch (reason) {
      if (!mounted.current) return null;
      setPendingCheckFailed(true);
      setPendingChecked(true);
      setError(reason instanceof Error ? reason.message : 'L’état GLPI ne peut pas être vérifié.');
      return null;
    }
  }, [applyServerRequest, initialClient, initialDescription]);

  useEffect(() => {
    if (currentMember.current !== memberId) {
      currentMember.current = memberId;
      const pending = readPendingGlpiRequest(initialClient, initialDescription, undefined, memberId);
      uncertainPayload.current = pending?.payload || null;
      setForm(pending?.payload || blankForm(initialDescription));
      setUncertain(!!pending);
      setCreated(null);
      setError('');
      setPendingChecked(false);
      setPendingCheckFailed(false);
      setServerBlocked(false);
      setStorageIssue((value => value === 'ok' ? null : value)(getGlpiDraftStorageStatus(memberId)));
    }
    const pendingCheck = setTimeout(() => { void refreshPending(); }, 0);
    const unsubscribe = subscribePendingGlpiRequest(memberId, pending => {
      if (pending) applyPending(pending);
      else void refreshPending();
    });
    return () => { clearTimeout(pendingCheck); unsubscribe(); };
  }, [applyPending, initialClient, initialDescription, memberId, refreshPending]);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => { void refreshPending(); }, 2000);
    return () => clearInterval(timer);
  }, [open, refreshPending]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch('/api/glpi', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const value = await response.json() as ApiValue;
        if (!response.ok) throw new Error(value.error || 'Connexion GLPI indisponible.');
        if (!controller.signal.aborted) {
          const next: Status = { configured: value.configured === true, connected: value.connected === true, canCreate: value.canCreate === true, web: value.web || null };
          setStatus(next);
          if (!next.connected || !next.canCreate) setLoading(false);
        }
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Connexion GLPI indisponible.'); });
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (!open || uncertain || !status?.connected || !status.canCreate || !form.client_id) return;
    const controller = new AbortController();
    void fetch('/api/glpi?' + new URLSearchParams({ createOptions: '1', client: form.client_id }), { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const value = await response.json() as ApiValue;
        if (!response.ok) throw new Error(value.error || 'Les catégories GLPI sont indisponibles.');
        if (!controller.signal.aborted) {
          setCategories(value.categories || []);
          if (value.limited) setError('Seules les 500 premières catégories sont affichées. Utilisez GLPI si la catégorie nécessaire manque.');
        }
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Les catégories GLPI sont indisponibles.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, status?.connected, status?.canCreate, form.client_id, uncertain]);

  async function openNew() {
    if (uncertain && form.request_id) {
      setOpen(true);
      return;
    }
    setOpen(true);
    const serverPending = await refreshPending();
    if (!mounted.current) return;
    if (serverPending) return;
    const clientId = clients.some(client => client.id === initialClient && client.active && client.glpi_entity_id !== null) ? initialClient : '';
    setForm(newForm(clientId, initialDescription));
    uncertainPayload.current = null;
    setCreated(null);
    setUncertain(false);
    setError('');
    setCategories([]);
    setLoading(!!clientId);
    setOpen(true);
  }

  function startDistinctRequest() {
    const clientId = clients.some(client => client.id === form.client_id && client.active && client.glpi_entity_id !== null) ? form.client_id : '';
    setForm(newForm(clientId, ''));
    uncertainPayload.current = null;
    setCategories([]);
    setUncertain(false);
    setCreated(null);
    setError('');
    setLoading(!!clientId);
  }

  function updateClient(clientId: string) {
    setForm(value => ({ ...value, client_id: clientId, category: 0 }));
    setCategories([]);
    setError('');
    setLoading(!!clientId);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (sending.current || uncertain || created) return;
    if (serverBlocked || pendingCheckFailed || !pendingChecked) {
      setError('L’état de cette demande ne peut pas être vérifié de façon sûre. Vérifiez votre connexion avant de créer un ticket.');
      return;
    }
    sending.current = true;
    setBusy(true);
    setError('');
    const payload = canonical(form);
    setForm(payload);
    // Reserve the exact canonical request before sending. If the browser or
    // network disappears after GLPI accepted it, remounting still has the
    // identity needed for a safe idempotent reconciliation.
    const stored = savePendingGlpiRequest(payload, undefined, memberId);
    if (!stored.ok) setStorageIssue(stored.reason);
    announcePendingGlpiRequest(memberId, { payload, savedAt: Date.now() });
    let certainResponse = false;
    try {
      const response = await fetch('/api/glpi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, action: 'createTicket' }) });
      let value: ApiValue;
      try { value = await response.json() as ApiValue; } catch { throw new Error('La réponse GLPI est illisible.'); }
      if (!response.ok) {
        certainResponse = value.uncertain !== true;
        if (value.uncertain) setUncertain(true);
        throw new Error(value.error || 'Création impossible.');
      }
      if (!value.ticket) throw new Error('La réponse GLPI est incomplète.');
      removePendingGlpiRequest(payload.request_id, undefined, memberId);
      announcePendingGlpiRequest(memberId, null);
      uncertainPayload.current = null;
      setUncertain(false);
      setCreated(value.ticket);
      acknowledge(payload.request_id);
    } catch (reason) {
      if (!certainResponse) {
        uncertainPayload.current = payload;
        setUncertain(true);
        setError('Résultat incertain : la demande a peut-être été acceptée par GLPI. Vérifiez vos tickets avant toute nouvelle demande.');
      } else {
        removePendingGlpiRequest(payload.request_id, undefined, memberId);
        announcePendingGlpiRequest(memberId, null);
        setError(reason instanceof Error ? reason.message : 'Création refusée. Corrigez le formulaire puis réessayez.');
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  async function reconcile() {
    if (sending.current || !uncertain) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const payload = uncertainPayload.current;
      if (!payload) return;
      setForm(payload);
      const stored = savePendingGlpiRequest(payload, undefined, memberId);
      if (!stored.ok) setStorageIssue(stored.reason);
      announcePendingGlpiRequest(memberId, { payload, savedAt: Date.now() });
      const response = await fetch('/api/glpi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, action: 'createTicket' }) });
      const value = await response.json() as ApiValue;
      if (!response.ok) throw new Error(value.error || 'Le résultat reste incertain.');
      if (!value.ticket) throw new Error('Le résultat reste incertain.');
      setForm(payload);
      setCreated(value.ticket);
      setUncertain(false);
      uncertainPayload.current = null;
      removePendingGlpiRequest(payload.request_id, undefined, memberId);
      announcePendingGlpiRequest(memberId, null);
      acknowledge(payload.request_id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Le résultat reste incertain. Vérifiez vos tickets dans GLPI.');
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return <>
    <button type="button" className="text-button" disabled={disabled} onClick={openNew}><Plus size={15} />Nouveau ticket GLPI</button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="calendar-dialog quick-dialog" onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
        <DialogTitle>{created ? 'Ticket créé dans GLPI' : uncertain ? 'Résultat incertain' : 'Créer un ticket GLPI'}</DialogTitle>
        <DialogDescription>Le ticket sera créé dans l’entité du client avec vos droits GLPI personnels.</DialogDescription>
        {error && <div className="alert error" role="alert">{error}</div>}
        {storageIssue && <div className="alert error" role="status">Le stockage local de ce navigateur est indisponible ou invalide. L’état serveur membre-scopé est utilisé ; aucune nouvelle création ne sera envoyée sans vérification.</div>}
        {uncertain && !created && <div className="alert error glpi-uncertain" role="status"><strong>Résultat incertain</strong><span>La réponse de GLPI n’a pas pu être confirmée. Le même UUID et le même payload restent conservés ; aucun renvoi automatique ne sera effectué.</span><div className="quick-actions"><button type="button" className="secondary" disabled={busy} onClick={() => void reconcile()}>Récupérer le résultat</button>{status?.web && <a href={status.web} target="_blank" rel="noreferrer" className="text-button">Vérifier dans GLPI</a>}</div><button type="button" className="text-button" disabled={busy} onClick={startDistinctRequest}>Commencer une nouvelle demande distincte</button></div>}
        {created ? <div className="glpi-created"><p role="status"><Check size={18} />GLPI-{created.id} · {created.title}</p><a href={created.url} target="_blank" rel="noreferrer" className="text-button"><ExternalLink size={16} />Ouvrir dans GLPI</a><div className="quick-actions"><button type="button" className="secondary" onClick={() => setOpen(false)}>Fermer</button><button type="button" className="primary" onClick={() => { onCreated(created); setOpen(false); }}>Utiliser ce ticket</button></div></div> : !status ? <p>Vérification de la connexion GLPI…</p> : !status.configured || !status.connected ? <p>Connectez d’abord votre compte depuis « Mes tickets GLPI ».</p> : !status.canCreate ? <p>La création de tickets est désactivée dans cet environnement. Votre administrateur peut l’activer pour une instance GLPI autorisée.</p> : <form className="quick-form" onSubmit={submit}>
          <fieldset disabled={busy || uncertain || serverBlocked || pendingCheckFailed || !pendingChecked}>
            <label>Client<select required value={form.client_id} onChange={event => updateClient(event.target.value)}><option value="">Choisir le client</option>{clients.filter(client => client.active && client.glpi_entity_id !== null).map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
            <label>Type<select value={form.type} onChange={event => setForm({ ...form, type: Number(event.target.value) })}><option value={1}>Incident</option><option value={2}>Demande</option></select></label>
            <label className="span-all">Titre<input autoFocus required maxLength={250} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label>
            <label className="span-all">Description<textarea required rows={4} maxLength={4000} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
            <label>Catégorie<select disabled={loading} value={form.category} onChange={event => setForm({ ...form, category: Number(event.target.value) })}><option value={0}>{loading ? 'Chargement…' : 'Non précisée'}</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label>Urgence<select value={form.urgency} onChange={event => setForm({ ...form, urgency: Number(event.target.value) })}>{['Très basse', 'Basse', 'Moyenne', 'Haute', 'Très haute'].map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label>
          </fieldset>
          <p className="form-note">Seuls les clients associés à une entité GLPI sont proposés. Les règles et champs obligatoires de GLPI restent applicables.</p>
          <div className="quick-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>Fermer</button><button className="primary" disabled={busy || loading || uncertain || serverBlocked || pendingCheckFailed || !pendingChecked || !form.client_id}>{busy ? 'Création…' : 'Créer dans GLPI'}</button></div>
        </form>}
      </DialogContent>
    </Dialog>
  </>;
}
