'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, ExternalLink, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { Client } from '@/lib/types';
import type { GlpiTicket } from '@/lib/glpi';

type Status = { configured: boolean; connected: boolean; canCreate: boolean; web: string | null };
type Category = { id: number; name: string };
type Form = { request_id: string; client_id: string; title: string; description: string; type: number; urgency: number; category: number };
type ApiValue = { error?: string; uncertain?: boolean; ticket?: GlpiTicket; categories?: Category[]; limited?: boolean } & Partial<Status>;

function newForm(clientId: string, description: string): Form {
  return { request_id: crypto.randomUUID(), client_id: clientId, title: '', description, type: 1, urgency: 3, category: 0 };
}

function canonical(form: Form): Form {
  return { ...form, title: form.title.trim(), description: form.description.trim() };
}

export default function NewGlpiTicket({ clients, initialClient = '', initialDescription = '', disabled = false, onCreated }: { clients: Client[]; initialClient?: string; initialDescription?: string; disabled?: boolean; onCreated: (ticket: GlpiTicket) => void }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [form, setForm] = useState<Form>(() => newForm('', initialDescription));
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [created, setCreated] = useState<GlpiTicket | null>(null);
  const sending = useRef(false);

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

  function openNew() {
    if (uncertain && form.request_id) {
      setOpen(true);
      return;
    }
    const clientId = clients.some(client => client.id === initialClient && client.active && client.glpi_entity_id !== null) ? initialClient : '';
    setForm(newForm(clientId, initialDescription));
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
    sending.current = true;
    setBusy(true);
    setError('');
    const payload = canonical(form);
    setForm(payload);
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
      setCreated(value.ticket);
    } catch (reason) {
      if (!certainResponse) {
        setUncertain(true);
        setError('Résultat incertain : la demande a peut-être été acceptée par GLPI. Vérifiez vos tickets avant toute nouvelle demande.');
      } else setError(reason instanceof Error ? reason.message : 'Création refusée. Corrigez le formulaire puis réessayez.');
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
      const payload = canonical(form);
      const response = await fetch('/api/glpi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, action: 'createTicket' }) });
      const value = await response.json() as ApiValue;
      if (!response.ok) throw new Error(value.error || 'Le résultat reste incertain.');
      if (!value.ticket) throw new Error('Le résultat reste incertain.');
      setForm(payload);
      setCreated(value.ticket);
      setUncertain(false);
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
        {uncertain && !created && <div className="alert error glpi-uncertain" role="status"><strong>Résultat incertain</strong><span>La réponse de GLPI n’a pas pu être confirmée. Le même UUID et le même payload restent conservés ; aucun renvoi automatique ne sera effectué.</span><div className="quick-actions"><button type="button" className="secondary" disabled={busy} onClick={() => void reconcile()}>Récupérer le résultat</button>{status?.web && <a href={status.web} target="_blank" rel="noreferrer" className="text-button">Vérifier dans GLPI</a>}</div><button type="button" className="text-button" disabled={busy} onClick={startDistinctRequest}>Commencer une nouvelle demande distincte</button></div>}
        {created ? <div className="glpi-created"><p role="status"><Check size={18} />GLPI-{created.id} · {created.title}</p><a href={created.url} target="_blank" rel="noreferrer" className="text-button"><ExternalLink size={16} />Ouvrir dans GLPI</a><div className="quick-actions"><button type="button" className="secondary" onClick={() => setOpen(false)}>Fermer</button><button type="button" className="primary" onClick={() => { onCreated(created); setOpen(false); }}>Utiliser ce ticket</button></div></div> : !status ? <p>Vérification de la connexion GLPI…</p> : !status.configured || !status.connected ? <p>Connectez d’abord votre compte depuis « Mes tickets GLPI ».</p> : !status.canCreate ? <p>La création de tickets est désactivée dans cet environnement. Votre administrateur peut l’activer pour une instance GLPI autorisée.</p> : <form className="quick-form" onSubmit={submit}>
          <fieldset disabled={busy || uncertain}>
            <label>Client<select required value={form.client_id} onChange={event => updateClient(event.target.value)}><option value="">Choisir le client</option>{clients.filter(client => client.active && client.glpi_entity_id !== null).map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
            <label>Type<select value={form.type} onChange={event => setForm({ ...form, type: Number(event.target.value) })}><option value={1}>Incident</option><option value={2}>Demande</option></select></label>
            <label className="span-all">Titre<input autoFocus required maxLength={250} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label>
            <label className="span-all">Description<textarea required rows={4} maxLength={4000} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
            <label>Catégorie<select disabled={loading} value={form.category} onChange={event => setForm({ ...form, category: Number(event.target.value) })}><option value={0}>{loading ? 'Chargement…' : 'Non précisée'}</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label>Urgence<select value={form.urgency} onChange={event => setForm({ ...form, urgency: Number(event.target.value) })}>{['Très basse', 'Basse', 'Moyenne', 'Haute', 'Très haute'].map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label>
          </fieldset>
          <p className="form-note">Seuls les clients associés à une entité GLPI sont proposés. Les règles et champs obligatoires de GLPI restent applicables.</p>
          <div className="quick-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>Fermer</button><button className="primary" disabled={busy || loading || uncertain || !form.client_id}>{busy ? 'Création…' : 'Créer dans GLPI'}</button></div>
        </form>}
      </DialogContent>
    </Dialog>
  </>;
}
