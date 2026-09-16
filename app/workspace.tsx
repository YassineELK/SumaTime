'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Building2, CalendarDays, Check, CheckCheck, ChevronRight, Clock3, FileText, HelpCircle, LayoutList, LockKeyhole, LogOut, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import { billedMinutes, brusselsToday, clockTime, duration, parseTime, validDate } from '@/lib/business';
import { registerPageTools } from '@/lib/webmcp';
import type { Entry, State } from '@/lib/types';
import TimeCalendar from './time-calendar';

type Filters = { from: string; to: string; client: string; member: string; status: string; q: string };
type EntryForm = { id: string; version?: number; client_id: string; ticket: string; date: string; start: string; end: string; description: string };
const freshForm = (): EntryForm => ({ id: '', client_id: '', ticket: '', date: brusselsToday(), start: '09:00', end: '10:00', description: '' });
const initialFilters = (): Filters => ({ from: brusselsToday().slice(0, 7) + '-01', to: brusselsToday(), client: '', member: '', status: '', q: '' });
const query = (filters: Filters) => new URLSearchParams(filters).toString();
const dateLabel = (date: string) => new Date(date + 'T12:00:00').toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' });

export default function Workspace() {
  const [data, setData] = useState<State | null>(null);
  const [tab, setTab] = useState('calendar');
  const [filters, setFilters] = useState(initialFilters);
  const [draftFilters, setDraftFilters] = useState(initialFilters);
  const [form, setForm] = useState<EntryForm>(freshForm);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [clientName, setClientName] = useState('');
  const [person, setPerson] = useState({ name: '', email: '' });
  const [setupName, setSetupName] = useState('');
  const [page, setPage] = useState(0);
  const sequence = useRef(0);
  const ticketInput = useRef<HTMLInputElement>(null);
  const currentState = useRef({ data, filters, form });
  currentState.current = { data, filters, form };
  useEffect(() => {
    if (!data?.me) return;
    return registerPageTools([
      {
        name: 'read_timesheet_selection', title: 'Lire le relevé affiché',
        description: 'Lire les filtres, clients disponibles et prestations déjà visibles pour le membre connecté. Inclut le brouillon du formulaire, sans aucune sauvegarde.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input) {
          if (!input || typeof input !== 'object' || Object.keys(input).length) throw new Error('Aucun paramètre attendu.');
          const s = currentState.current;
          return { filters: s.filters, clients: s.data?.clients, entries: s.data?.entries, draft: s.form };
        },
      },
      {
        name: 'stage_time_entry', title: 'Préparer une prestation',
        description: 'Remplir un nouveau brouillon visible, sans enregistrer de prestation. Refuse de remplacer un brouillon déjà saisi. La sauvegarde se fait avec le bouton Enregistrer.',
        inputSchema: { type: 'object', properties: { client_id: { type: 'string' }, ticket: { type: 'string', maxLength: 120 }, date: { type: 'string', format: 'date' }, start: { type: 'string' }, end: { type: 'string' }, description: { type: 'string', maxLength: 2000 } }, required: ['client_id', 'ticket', 'date', 'start', 'end'], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        async execute(input) {
          if (!input || typeof input !== 'object') throw new Error('Paramètres invalides.');
          const x = input as Record<string, unknown>;
          const keys = ['client_id', 'ticket', 'date', 'start', 'end', 'description'];
          if (Object.keys(x).some(key => !keys.includes(key)) || keys.slice(0, 5).some(key => typeof x[key] !== 'string')) throw new Error('Paramètres invalides.');
          const draft = currentState.current.form;
          if (draft.ticket || draft.description || draft.version) throw new Error('Un brouillon est déjà présent. Terminez-le avant de préparer une autre prestation.');
          if (!currentState.current.data?.clients.some(c => c.id === x.client_id && c.active)) throw new Error('Client actif requis.');
          if (!(x.ticket as string).trim() || (x.ticket as string).length > 120 || !validDate(x.date as string) || (x.date as string) > brusselsToday()) throw new Error('Ticket ou date invalide.');
          const start = parseTime(x.start), end = x.end === '00:00' ? 1440 : parseTime(x.end);
          if (end <= start || (x.description !== undefined && (typeof x.description !== 'string' || x.description.length > 2000))) throw new Error('Heures ou description invalides.');
          setForm({ id: '', client_id: x.client_id as string, ticket: x.ticket as string, date: x.date as string, start: x.start as string, end: x.end as string, description: (x.description as string) || '' });
          setTab('entries');
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          return { staged: true, saved: false, real_minutes: end - start, billable_minutes: billedMinutes(start, end) };
        },
      },
    ]);
  }, [!!data?.me]);
  const reload = useCallback(async () => {
    const call = ++sequence.current;
    setLoading(true);
    try {
      const res = await fetch('/api/time?' + query(filters), { cache: 'no-store' });
      const json = await res.json() as State & { error?: string };
      if (!res.ok) throw new Error(json.error || 'Chargement impossible.');
      if (call === sequence.current) { setData(json); setPage(0); }
    } catch (e) { if (call === sequence.current) { setData(prev => prev ? { ...prev, entries: [] } : null); setError(e instanceof Error ? e.message : 'Chargement impossible. Vérifiez votre connexion.'); } }
    finally { if (call === sequence.current) setLoading(false); }
  }, [filters]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6500); return () => clearTimeout(timer); }, [notice]);
  async function act(payload: object, success: string) {
    if (busy) return false;
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await fetch('/api/time', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error || 'Enregistrement impossible.');
      setNotice(success); await reload(); return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'Enregistrement non confirmé. Vérifiez votre connexion et réessayez.'); return false; }
    finally { setBusy(false); }
  }
  const isAdmin = data?.me?.role === 'admin';
  const rows = data?.entries || [];
  const real = rows.reduce((sum, e) => sum + e.end - e.start, 0);
  const bill = rows.reduce((sum, e) => sum + billedMinutes(e.start, e.end), 0);
  const open = rows.filter(e => !e.billed).reduce((sum, e) => sum + billedMinutes(e.start, e.end), 0);
  const activeClients = data?.clients.filter(c => c.active || c.id === form.client_id) || [];
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const formMinutes = (form.end === '00:00' ? 1440 : minutes(form.end)) - minutes(form.start);
  const updateForm = (key: keyof EntryForm, value: string) => setForm(prev => ({ ...prev, [key]: value }));
  const applyFilters = (next: Filters) => { setDraftFilters(next); setFilters(next); setError(''); };
  function edit(e: Entry) {
    setForm({ id: e.id, version: e.version, client_id: e.client_id, ticket: e.ticket, date: e.date, start: clockTime(e.start), end: e.end === 1440 ? '00:00' : clockTime(e.end), description: e.description });
    setError(''); setTab('entries'); window.scrollTo({ top: 0, behavior: 'smooth' }); ticketInput.current?.focus();
  }
  async function saveEntry(event: FormEvent) {
    event.preventDefault();
    const id = form.id || crypto.randomUUID();
    setForm(prev => ({ ...prev, id }));
    const saved = await act({ ...form, id, action: 'saveEntry' }, form.version ? 'Prestation mise à jour.' : 'Prestation enregistrée.');
    if (saved) {
      if (form.date < filters.from || form.date > filters.to || filters.client || filters.member || filters.status || filters.q) applyFilters({ ...initialFilters(), from: form.date, to: form.date });
      setForm({ ...freshForm(), client_id: form.client_id, date: form.date, start: form.end, end: '' });
      ticketInput.current?.focus();
    }
  }
  async function exportCsv(kind: 'detail' | 'summary') {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/time?' + query(filters) + '&export=' + kind, { cache: 'no-store' });
      if (!res.ok) { const error = await res.json() as { error: string }; throw new Error(error.error); }
      if (!res.headers.get('content-type')?.includes('text/csv')) throw new Error('Export indisponible. Reconnectez-vous et réessayez.');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = `sumatoni-${kind}-${filters.from}-${filters.to}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Relevé téléchargé. Les prestations restent dans leur état actuel.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Export impossible.'); }
    finally { setBusy(false); }
  }

  const feedback = <>{error && <div className="alert error" role="alert"><span>{error}</span><button aria-label="Fermer l’erreur" className="icon-button" onClick={() => setError('')}><X size={18} /></button></div>}{notice && <div className="alert success" role="status"><Check size={18} /><span>{notice}</span></div>}</>;
  if (!data?.me) return <div className="welcome"><div className="welcome-card"><div className="brand dark-brand"><span className="brand-icon"><Clock3 /></span><span>sumatoni<span className="brand-sub">TIME</span></span></div>{feedback}{loading ? <><h1>Ouverture de votre espace…</h1><p>Chargement des prestations.</p></> : data?.setup ? <><span className="eyebrow">BIENVENUE DANS VOTRE ESPACE</span><h1>Le temps bien enregistré.</h1><p>Saisissez vos interventions, retrouvez celles de vos partenaires et préparez votre facturation.</p><form onSubmit={async e => { e.preventDefault(); await act({ action: 'setup', name: setupName }, 'Votre espace est prêt. Ajoutez votre premier client.'); }}><label>Votre nom<input autoComplete="name" required maxLength={100} value={setupName} onChange={e => setSetupName(e.target.value)} placeholder="Prénom et nom" /></label><div className="info-line"><ShieldCheck size={20} /><span>Votre compte <strong>{data.email}</strong> sera administrateur de cet espace.</span></div><button className="primary full" disabled={busy}>Activer mon espace <ArrowRight size={18} /></button></form><p className="fine">Arrondi au quart d’heure · Heures de Bruxelles · Accès individuels</p></> : data?.denied ? <><h1>Votre accès reste à autoriser.</h1><p>Demandez à l’administrateur d’ajouter l’adresse <strong>{data.email}</strong> à l’équipe.</p><button className="primary" onClick={() => void reload()}>Vérifier mon accès</button><a className="signout" href="/signout-with-chatgpt?return_to=/" target="_top">Changer de compte</a></> : <><h1>Impossible d’ouvrir votre espace</h1><button className="primary" onClick={() => void reload()}>Réessayer</button><a className="signout" href="/signin-with-chatgpt?return_to=/" target="_top">Se reconnecter</a></>}</div><div className="welcome-footer">SUMATONI / TIME REGISTRATION</div></div>;

  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="/"><span className="brand-icon"><Clock3 /></span><span>sumatoni<span className="brand-sub">TIME</span></span></a><a className="mobile-signout" aria-label="Se déconnecter" href="/signout-with-chatgpt?return_to=/" target="_top"><LogOut size={20} /></a><span className="nav-caption">VOTRE ESPACE</span><nav aria-label="Navigation principale">
      <button className={tab === 'calendar' ? 'active' : ''} onClick={() => setTab('calendar')}><CalendarDays size={20} /><span>Calendrier</span></button>
      <button className={tab === 'entries' ? 'active' : ''} onClick={() => setTab('entries')}><LayoutList size={20} /><span>Prestations</span><ChevronRight className="nav-chevron" size={16} /></button>
      {isAdmin && <><button className={tab === 'clients' ? 'active' : ''} onClick={() => setTab('clients')}><Building2 size={20} /><span>Clients</span></button><button className={tab === 'team' ? 'active' : ''} onClick={() => setTab('team')}><Users size={20} /><span>Équipe</span></button></>}
      <button className={tab === 'help' ? 'active' : ''} onClick={() => setTab('help')}><HelpCircle size={20} /><span>Guide pratique</span></button>
    </nav><div className="sidebar-note"><div className="tiny-clock"><Clock3 size={19} /></div><strong>Précis à la minute.<br />Facturé au quart d’heure.</strong><p>Vos horaires réels sont toujours conservés.</p><span>BRUXELLES · EUROPE</span></div><div className="profile"><span className="avatar">{data.me.name.slice(0, 2).toUpperCase()}</span><div><strong>{data.me.name}</strong><small>{isAdmin ? 'Administrateur' : 'Partenaire'}</small></div><a aria-label="Se déconnecter" title="Se déconnecter" href="/signout-with-chatgpt?return_to=/" target="_top"><LogOut size={18} /></a></div></aside>
    <main className="main-content"><header className="topbar"><span>ESPACE DE TRAVAIL <span className="slash">/</span> <strong>SUMATONI</strong></span><span className="role"><ShieldCheck size={16} />{isAdmin ? 'Vue administrateur' : 'Espace partenaire'}</span></header>
    <div className="page-content">{feedback}<div className="page-heading"><div><span className="eyebrow">{tab === 'entries' ? 'DU TEMPS SAISI AU TEMPS FACTURÉ' : 'VOTRE ESPACE SUMATONI'}</span><h1>{({ calendar: 'Calendrier', entries: 'Prestations', clients: 'Vos clients', team: 'Votre équipe', help: 'Guide pratique' } as Record<string, string>)[tab]}</h1><p>{tab === 'calendar' ? 'Sélectionnez votre plage horaire. Complétez votre prestation.' : tab === 'entries' ? (isAdmin ? 'Un relevé clair pour vous et vos partenaires.' : 'Vos interventions et votre temps facturable, au même endroit.') : tab === 'clients' ? 'Un répertoire commun pour des relevés cohérents.' : tab === 'team' ? 'Chaque partenaire dispose de son propre accès.' : 'Quelques repères pour aller à l’essentiel.'}</p></div><button className="secondary refresh" disabled={loading || busy} onClick={() => { setError(''); void reload(); }}><RefreshCw size={16} className={loading ? 'spinning' : ''} />Actualiser</button></div>

    {tab === 'calendar' && <TimeCalendar data={data} onSaved={() => void reload()} />}
    {tab === 'entries' && <>
      <div className="stats"><div className="stat"><span><Clock3 size={17} />Temps réel</span><strong>{duration(real)}</strong><small>Heures de début et de fin conservées</small></div><div className="stat"><span><FileText size={17} />Temps facturable</span><strong>{duration(bill)}</strong><small>Arrondi à 15 min par prestation</small></div><div className="stat stat-accent"><span><ArrowDownToLine size={17} />Reste à facturer</span><strong>{duration(open)}</strong><small>{rows.filter(e => !e.billed).length} prestation{rows.filter(e => !e.billed).length > 1 ? 's' : ''} dans la sélection</small></div></div>
      <div className="work-grid"><section className="entry-panel panel" aria-labelledby="entry-title"><div className="panel-heading"><span className="square-icon"><Plus size={20} /></span><h2 id="entry-title">{form.version ? 'Modifier la prestation' : 'Nouvelle prestation'}</h2></div>
      {activeClients.length === 0 ? <div className="onboard"><Building2 size={30} /><h3>{isAdmin ? 'Tout commence par un client.' : 'Votre premier client arrive bientôt.'}</h3><p>{isAdmin ? 'Ajoutez un client pour enregistrer votre première intervention.' : 'Demandez à l’administrateur de créer un client.'}</p>{isAdmin && <button className="primary full" onClick={() => setTab('clients')}><Plus size={17} />Ajouter un client</button>}</div> : <form className="entry-form" onSubmit={saveEntry}>
        <label>Client <span className="required">*</span><select required value={form.client_id} onChange={e => updateForm('client_id', e.target.value)}><option value="">Choisir un client</option>{activeClients.map(c => <option key={c.id} value={c.id}>{c.name}{c.active ? '' : ' (archivé)'}</option>)}</select></label>
        <label>Ticket <span className="required">*</span><input ref={ticketInput} required maxLength={120} placeholder="Ex. INC-2026-042" value={form.ticket} onChange={e => updateForm('ticket', e.target.value)} /></label>
        <label>Date de l’intervention <span className="required">*</span><input required type="date" max={brusselsToday()} value={form.date} onChange={e => updateForm('date', e.target.value)} /></label>
        <div className="time-fields"><label>Début <span className="required">*</span><input required type="time" value={form.start} onChange={e => updateForm('start', e.target.value)} /></label><span>→</span><label>Fin <span className="required">*</span><input required type="time" value={form.end} onChange={e => updateForm('end', e.target.value)} /></label></div>
        <label>Description <span className="optional">facultatif</span><textarea rows={3} maxLength={2000} placeholder="Sur quoi avez-vous travaillé ?" value={form.description} onChange={e => updateForm('description', e.target.value)} /></label>
        <div className="duration-preview"><div><span>Temps réel</span><strong>{form.start && form.end && formMinutes > 0 ? duration(formMinutes) : '—'}</strong></div><ChevronRight size={18} /><div><span>À facturer</span><strong>{form.start && form.end && formMinutes > 0 ? duration(Math.ceil(formMinutes / 15) * 15) : '—'}</strong></div></div>
        <button className="primary full" disabled={busy || !form.end || formMinutes <= 0}><Check size={18} />{busy ? 'Enregistrement…' : form.version ? 'Enregistrer les modifications' : 'Enregistrer la prestation'}</button>
        {form.version && <button type="button" className="text-button" onClick={() => setForm(freshForm())}>Annuler la modification</button>}<p className="form-note">Bruxelles · Fin 00:00 = minuit · <span>*</span> Champs obligatoires</p>
      </form>}</section>
      <section className="ledger panel" aria-labelledby="ledger-title"><div className="ledger-heading"><div><h2 id="ledger-title">Le relevé <span className="count">{rows.length}</span></h2><p>{dateLabel(filters.from)} — {dateLabel(filters.to)} {filters.to.slice(0, 4)}</p></div><details className="export-menu"><summary><ArrowDownToLine size={17} />Exporter</summary><div><button disabled={busy || loading || !rows.length} onClick={() => void exportCsv('detail')}>CSV détaillé <FileText size={16} /></button><button disabled={busy || loading || !rows.length} onClick={() => void exportCsv('summary')}>Synthèse par client <Building2 size={16} /></button><small>Compatible Excel · Filtres appliqués</small></div></details></div>
        <form className="filters" onSubmit={e => { e.preventDefault(); applyFilters(draftFilters); }}><div className="date-filters"><label>Du<input aria-label="Début de période" type="date" required value={draftFilters.from} onChange={e => setDraftFilters({ ...draftFilters, from: e.target.value })} /></label><label>Au<input aria-label="Fin de période" type="date" required value={draftFilters.to} onChange={e => setDraftFilters({ ...draftFilters, to: e.target.value })} /></label><button type="button" className="period-button" onClick={() => applyFilters(initialFilters())}>Ce mois</button></div><div className="select-filters"><label><span className="sr-only">Filtrer par client</span><select value={draftFilters.client} onChange={e => setDraftFilters({ ...draftFilters, client: e.target.value })}><option value="">Tous les clients</option>{data.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{isAdmin && <label><span className="sr-only">Filtrer par partenaire</span><select value={draftFilters.member} onChange={e => setDraftFilters({ ...draftFilters, member: e.target.value })}><option value="">Toute l’équipe</option>{data.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}<label><span className="sr-only">Filtrer par statut</span><select value={draftFilters.status} onChange={e => setDraftFilters({ ...draftFilters, status: e.target.value })}><option value="">Tous les statuts</option><option value="open">À facturer</option><option value="billed">Facturé</option></select></label></div><div className="search-row"><label className="search"><Search size={16} /><span className="sr-only">Rechercher un ticket ou une description</span><input maxLength={120} placeholder="Rechercher un ticket, une description…" value={draftFilters.q} onChange={e => setDraftFilters({ ...draftFilters, q: e.target.value })} /></label><button className="filter-button" disabled={loading}>Appliquer</button></div></form>
        <div className={'entries-list' + (loading ? ' refreshing' : '')} aria-busy={loading}>
          <div className="list-head"><span>INTERVENTION</span><span>HORAIRES / TEMPS</span><span>FACTURATION</span></div>
          {!rows.length ? <div className="empty"><span className="empty-icon"><LayoutList size={32} /></span><h3>Votre relevé commence ici.</h3><p>{data.clients.length ? 'Enregistrez une prestation ou ajustez les filtres pour retrouver vos interventions.' : 'Ajoutez votre premier client, puis saisissez votre temps. Vos prestations apparaîtront ici.'}</p><span>Une saisie. Un relevé fiable.</span></div> : rows.slice(page * 12, (page + 1) * 12).map(e => <article className="entry-row" key={e.id}><div className="entry-details"><span className="entry-date">{dateLabel(e.date)} <span>· {e.member}</span></span><strong>{e.client}</strong><span className="ticket">{e.ticket}</span>{e.description && <p>{e.description}</p>}</div><div className="entry-time"><span>{clockTime(e.start)} <span className="muted">→</span> {clockTime(e.end)}</span><strong>{duration(billedMinutes(e.start, e.end))}</strong><small>{duration(e.end - e.start)} réelles</small></div><div className="entry-status"><span className={'badge ' + (e.billed ? 'billed' : 'open')}>{e.billed ? <LockKeyhole size={12} /> : null}{e.billed ? 'Facturé' : 'À facturer'}</span><div className="row-actions">{!e.billed && <><button aria-label={'Modifier ' + e.ticket} title="Modifier" className="icon-button" disabled={busy} onClick={() => edit(e)}><Pencil size={16} /></button><button aria-label={'Supprimer ' + e.ticket} title="Supprimer" className="icon-button danger" disabled={busy} onClick={() => { if (confirm(`Supprimer la prestation ${e.ticket} du ${dateLabel(e.date)} ? Cette action est définitive.`)) void act({ action: 'deleteEntry', id: e.id, version: e.version }, 'Prestation supprimée.'); }}><Trash2 size={16} /></button></>}{isAdmin && <button className="icon-button" disabled={busy} aria-label={(e.billed ? 'Rouvrir ' : 'Marquer facturé ') + e.ticket} title={e.billed ? 'Rouvrir' : 'Marquer facturé'} onClick={() => { if (confirm(e.billed ? 'Rouvrir cette prestation et autoriser sa modification ?' : 'Marquer cette prestation comme facturée et verrouiller sa modification ?')) void act({ action: 'billed', id: e.id, version: e.version, billed: !e.billed }, e.billed ? 'Prestation rouverte.' : 'Prestation marquée comme facturée.'); }}>{e.billed ? <RefreshCw size={16} /> : <CheckCheck size={17} />}</button>}</div></div></article>)}
        </div><div className="ledger-footer"><span>{rows.length} prestation{rows.length !== 1 ? 's' : ''}<span className="footer-dot">·</span><strong>{duration(bill)} facturables</strong></span>{rows.length > 12 && <div className="pagination"><button aria-label="Page précédente" disabled={page === 0} onClick={() => setPage(page - 1)}><ArrowLeft size={16} /></button><span>{page + 1} / {Math.ceil(rows.length / 12)}</span><button aria-label="Page suivante" disabled={(page + 1) * 12 >= rows.length} onClick={() => setPage(page + 1)}><ArrowRight size={16} /></button></div>}</div>
      </section></div><div className="bottom-note"><ShieldCheck size={15} /><span>{isAdmin ? 'Vous consultez les prestations de toute votre équipe.' : 'Seules vos prestations sont visibles dans cet espace.'} Les exports respectent vos filtres.</span></div>
    </>}

    {tab === 'clients' && isAdmin && <div className="management-grid"><section className="panel management-form"><span className="square-icon"><Building2 size={20} /></span><h2>Ajouter un client</h2><p>Un nom commun à toute l’équipe, pour retrouver facilement chaque prestation.</p><form onSubmit={async e => { e.preventDefault(); if (await act({ action: 'client', name: clientName }, 'Client ajouté. Vous pouvez saisir une prestation.')) setClientName(''); }}><label>Nom du client<input required maxLength={120} value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Nom de l’entreprise" /></label><button className="primary full" disabled={busy}><Plus size={18} />Ajouter le client</button></form></section><section className="panel management-list"><div className="panel-heading"><h2>Répertoire clients</h2><span className="count">{data.clients.length}</span></div>{!data.clients.length && <div className="empty"><Building2 size={30} /><h3>Votre répertoire est prêt.</h3><p>Ajoutez votre premier client avec le formulaire.</p></div>}{data.clients.map(c => <div className="management-row" key={c.id}><span className="client-monogram">{c.name.slice(0, 2).toUpperCase()}</span><div><strong>{c.name}</strong><small>{c.active ? 'Disponible pour la saisie' : 'Archivé · Historique conservé'}</small></div><button className="secondary" disabled={busy} onClick={() => void act({ action: 'clientActive', id: c.id, active: !c.active }, c.active ? 'Client archivé. Son historique est conservé.' : 'Client réactivé.')}>{c.active ? 'Archiver' : 'Réactiver'}</button></div>)}</section></div>}

    {tab === 'team' && isAdmin && <div className="management-grid"><section className="panel management-form"><span className="square-icon"><Users size={20} /></span><h2>Autoriser un partenaire</h2><p>Utilisez l’adresse de son compte ChatGPT. Le partenaire verra uniquement ses propres prestations.</p><form onSubmit={async e => { e.preventDefault(); if (await act({ action: 'invite', ...person }, 'Partenaire autorisé. Partagez-lui le lien après avoir ouvert l’accès du site.')) setPerson({ name: '', email: '' }); }}><label>Prénom et nom<input required maxLength={100} autoComplete="off" value={person.name} onChange={e => setPerson({ ...person, name: e.target.value })} placeholder="Nom du partenaire" /></label><label>Adresse e-mail<input required maxLength={254} type="email" autoComplete="off" value={person.email} onChange={e => setPerson({ ...person, email: e.target.value })} placeholder="prenom@entreprise.be" /></label><button className="primary full" disabled={busy}><Plus size={18} />Autoriser le partenaire</button></form><div className="info-line"><LockKeyhole size={20} /><span>Aucun e-mail n’est envoyé. L’accès au site doit aussi être ouvert au partenaire dans les réglages de partage Sites.</span></div></section><section className="panel management-list"><div className="panel-heading"><h2>Les membres de l’équipe</h2><span className="count">{data.members.length}</span></div>{data.members.map(m => <div className="management-row" key={m.id}><span className="client-monogram">{m.name.slice(0, 2).toUpperCase()}</span><div><strong>{m.name} {m.id === data.me?.id && <span className="you">vous</span>}</strong><small>{m.email}</small><small>{m.role === 'admin' ? 'Administrateur · Toutes les prestations' : !m.active ? 'Accès désactivé' : m.user_id ? 'Partenaire · Accès actif' : 'Partenaire · En attente de connexion'}</small></div>{m.role !== 'admin' && <button className="secondary" disabled={busy} onClick={() => void act({ action: 'memberActive', id: m.id, active: !m.active }, m.active ? 'Accès désactivé.' : 'Accès réactivé.')}>{m.active ? 'Désactiver' : 'Réactiver'}</button>}</div>)}</section></div>}

    {tab === 'help' && <div className="help-grid">{[
      ['01', 'Enregistrer une intervention', 'Choisissez le client, indiquez la référence du ticket, la date et les heures. La description est facultative. Les heures sont celles de Bruxelles, quel que soit votre appareil. Une intervention passant minuit doit être scindée en deux lignes.'],
      ['02', 'Comprendre l’arrondi', 'Chaque prestation est arrondie au quart d’heure supérieur : 15 minutes donnent 15 minutes facturables ; 16 minutes donnent 30 minutes. Les totaux additionnent ces durées arrondies. Les horaires réels restent disponibles.'],
      ['03', 'Préparer votre facturation', 'Choisissez une période, un client, un partenaire ou un statut, puis cliquez sur Appliquer. Exportez le CSV détaillé pour les justificatifs ou la synthèse pour les totaux par client et partenaire. Les fichiers s’ouvrent dans Excel.'],
      ['04', 'Conserver un relevé fiable', 'Après facturation, l’administrateur peut verrouiller chaque ligne avec la double coche. Les prestations facturées ne sont plus modifiables. Exporter seul ne modifie aucun statut. Le bouton Rouvrir permet une correction explicite.'],
      ['05', 'Travailler avec vos partenaires', 'L’administrateur autorise chaque partenaire avec l’adresse de son compte ChatGPT dans Équipe. Il faut également lui permettre d’accéder au site dans les réglages de partage Sites. Aucun e-mail d’invitation n’est envoyé automatiquement.'],
      ['06', 'En cas de doute', 'La connexion Internet est nécessaire. En cas d’erreur, les champs restent présents : réessayez sans fermer la page. Un chevauchement avec une autre prestation est refusé. Actualisez pour retrouver les dernières modifications.'],
    ].map(([n, title, body]) => <article className="panel help-card" key={n}><span>{n}</span><h2>{title}</h2><p>{body}</p></article>)}</div>}
    <footer className="page-footer"><span>sumatoni <strong>TIME</strong></span><span>Le temps enregistré. La facturation simplifiée.</span></footer></div></main>
  </div>;
}
