'use client';
import NewGlpiTicket from './new-glpi-ticket';
import CalendarItem from './calendar-item';
import TimeInput from '@/components/time-input';
import LocationField from '@/components/location-field';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Check, LockKeyhole, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { billedMinutes, brusselsToday, clockTime, duration, parseTime, validDate } from '@/lib/business';
import { addDays, findCalendarFocus, layoutEntries, overlaps, restoreEntryPayload, selectedRange, slotAt, SLOT_COUNT, SLOT_HEIGHT, type CalendarFocusTarget } from '@/lib/calendar';
import { weekStart } from '@/lib/calendar';
import type { Entry, State } from '@/lib/types';

type Selection = { date: string; first: number; last: number; mode: 'mouse' | 'touch' | 'keyboard' };
type Draft = { id: string; version?: number; client_id: string; ticket: string; date: string; start: string; end: string; description: string; on_site: boolean | null; member_id: string; member: string; billed: number };
type UndoMove = { id: string; original: Pick<Entry, 'date' | 'start' | 'end'>; version: number };
type FocusTarget = CalendarFocusTarget & { date: string };
const dayName = (date: string, long = false) => new Date(date + 'T12:00:00Z').toLocaleDateString('fr-BE', { timeZone: 'UTC', weekday: long ? 'long' : 'short', day: 'numeric', month: long ? 'long' : undefined });

export default function TimeCalendar({ data, onSaved }: { data: State; onSaved: () => void | Promise<void> }) {
  const me = data.me!;
  const today = brusselsToday();
  const [anchor, setAnchor] = useState(today);
  const [member, setMember] = useState(me.id);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const selectionRef = useRef<Selection | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const initialDraft = useRef('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [operationError,setOperationError]=useState(false);
  const [undo, setUndo] = useState<UndoMove | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const lastPointer = useRef('mouse');
  const returnFocus = useRef<HTMLElement | null>(null);
  const focusTarget = useRef<FocusTarget | null>(null);
  const [focusRestoreReady, setFocusRestoreReady] = useState(false);
  const loadSequence = useRef(0);
  const [cursor, setCursor] = useState(32);
  const startOfWeek = weekStart(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek, i));
  const setRange = useCallback((value: Selection | null) => { selectionRef.current = value; setSelection(value); }, []);
  const invalidateFocusTarget = useCallback(() => { focusTarget.current = null; setFocusRestoreReady(false); }, []);

  useEffect(() => {
    const controller = new AbortController();
    const request = ++loadSequence.current;
    const q = new URLSearchParams({ from: startOfWeek, to: addDays(startOfWeek, 6), member });
    void Promise.resolve().then(() => {
      if (controller.signal.aborted || request !== loadSequence.current) return null;
      setLoading(true); setLoadError(''); setRange(null);
      return fetch('/api/time?' + q, { signal: controller.signal, cache: 'no-store' });
    }).then(async res => {
      if (!res || controller.signal.aborted || request !== loadSequence.current) return;
      const json = await res.json() as State & { error?: string };
      if (!res.ok || !json.me) throw new Error(json.error || 'Votre accès a changé. Actualisez votre espace.');
      if (!controller.signal.aborted && request === loadSequence.current) setEntries(json.entries);
    }).catch(e => { if (!controller.signal.aborted && request === loadSequence.current) setLoadError(e instanceof Error ? e.message : 'Chargement impossible. Réessayez.'); })
      .finally(() => { if (!controller.signal.aborted && request === loadSequence.current) setLoading(false); });
    return () => controller.abort();
  }, [startOfWeek, member, revision, data, setRange]);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 8 * 4 * SLOT_HEIGHT; }, []);
  useEffect(() => {
    if (!notice || operationError || undo) return;
    const timer = setTimeout(() => setNotice(''), 6500);
    return () => clearTimeout(timer);
  }, [notice,operationError,undo]);
  useEffect(() => {
    const cancel = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setRange(null); };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [setRange]);

  useEffect(() => {
    const target = focusTarget.current;
    if (loading || !target || !focusRestoreReady) return;
    const entry = entries.find(value => value.id === target.id);
    const frame = requestAnimationFrame(() => {
      const controls = [...document.querySelectorAll<HTMLElement>('[data-entry-id]')];
      const control = entry && findCalendarFocus(controls, target);
      if (control) {
        control.focus({ preventScroll: true });
        focusTarget.current = null;
        setFocusRestoreReady(false);
        return;
      }
      const requestedDate = entry?.date || target.date;
      const preferredColumn = days.includes(requestedDate)
        ? [...document.querySelectorAll<HTMLElement>('[data-date]')].find(value => value.dataset.date === requestedDate)
        : null;
      const columns = preferredColumn ? [preferredColumn, ...[...document.querySelectorAll<HTMLElement>('[data-date]')].filter(value => value !== preferredColumn)]
        : [...document.querySelectorAll<HTMLElement>('[data-date]')];
      const fallback = columns.flatMap(column => [...column.querySelectorAll<HTMLElement>('[data-time-slot]')]).find(value => !value.hasAttribute('disabled'))
        || document.querySelector<HTMLElement>('[aria-label="Aujourd’hui"]:not([disabled])')
        || document.querySelector<HTMLElement>('[aria-label="Semaine précédente"]:not([disabled])');
      focusTarget.current = null;
      setFocusRestoreReady(false);
      if (fallback) fallback.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [days, entries, loading, focusRestoreReady]);

  function showDraft(value: Draft) {
    returnFocus.current = document.activeElement as HTMLElement;
    initialDraft.current = JSON.stringify(value);
    setDraft(value); setSaveError(''); setDeleting(false); setRange(null);
  }
  function openRange(date: string, first: number, last: number) {
    if (loading || loadError || date > today) return;
    const { start, end } = selectedRange(first, last);
    showDraft({ id: crypto.randomUUID(), client_id: data.clients.find(c => c.active)?.id || '', ticket: '', date, start: clockTime(start), end: end === 1440 ? '00:00' : clockTime(end), description: '', on_site: false, member_id: me.id, member: me.name, billed: 0 });
  }
  function openEntry(entry: Entry) {
    showDraft({ id: entry.id, version: entry.version, client_id: entry.client_id, ticket: entry.ticket, date: entry.date, start: clockTime(entry.start), end: entry.end === 1440 ? '00:00' : clockTime(entry.end), description: entry.description, on_site: entry.on_site === null ? null : !!entry.on_site, member_id: entry.member_id, member: entry.member, billed: entry.billed });
  }
  function closeDraft() {
    if (savingRef.current) return;
    if (draft && !draft.billed && JSON.stringify(draft) !== initialDraft.current && !confirm('Fermer sans enregistrer cette prestation ?')) return;
    setDraft(null); setSaveError('');
  }
  function position(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return slotAt(event.clientY, rect.top, rect.height);
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>, date: string) {
    lastPointer.current = event.pointerType;
    if (event.pointerType === 'touch' || event.button !== 0 || loading || loadError || date > today || !(event.target as HTMLElement).closest('[data-time-slot]')) return;
    event.preventDefault();
    const slot = position(event);
    (event.target as HTMLElement).focus({ preventScroll: true });
    setRange({ date, first: slot, last: slot, mode: 'mouse' });
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const range = selectionRef.current;
    if (!range || range.mode !== 'mouse' || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    setRange({ ...range, last: position(event) });
    const box = scroll.current?.getBoundingClientRect();
    if (box && scroll.current) {
      if (event.clientY > box.bottom - 38) scroll.current.scrollTop += 18;
      else if (event.clientY < box.top + 38) scroll.current.scrollTop -= 18;
    }
  }
  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    const range = selectionRef.current;
    if (!range || range.mode !== 'mouse' || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    openRange(range.date, range.first, position(event));
  }
  function tap(date: string, slot: number) {
    const current = selectionRef.current;
    if (current?.mode === 'touch' && current.date === date) openRange(date, current.first, slot);
    else setRange({ date, first: slot, last: slot, mode: 'touch' });
  }
  function key(event: KeyboardEvent<HTMLButtonElement>, date: string, slot: number) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const current = selectionRef.current;
      if (current?.mode === 'keyboard' && current.date === date) openRange(date, current.first, current.last);
      else openRange(date, slot, slot);
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let next = slot, nextDate = date;
    if (event.key === 'ArrowUp') next = Math.max(0, slot - 1);
    if (event.key === 'ArrowDown') next = Math.min(95, slot + 1);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = 95;
    if (event.key === 'ArrowLeft') nextDate = addDays(date, -1);
    if (event.key === 'ArrowRight') nextDate = addDays(date, 1);
    if (!days.includes(nextDate) || nextDate > today) return;
    if (event.shiftKey && nextDate === date) {
      const current = selectionRef.current;
      setRange({ date, first: current?.mode === 'keyboard' && current.date === date ? current.first : slot, last: next, mode: 'keyboard' });
    } else setRange(null);
    setCursor(next);
    if (nextDate !== date) { invalidateFocusTarget(); setAnchor(nextDate); }
    requestAnimationFrame(() => scroll.current?.querySelector<HTMLButtonElement>(`[data-date="${nextDate}"] [data-time-slot="${next}"]`)?.focus());
  }
  function changeWeek(offset: number) { invalidateFocusTarget(); setRange(null); const next = addDays(anchor, offset * 7); setAnchor(next > today ? today : next); }
  function update(field: keyof Draft, value: string) { setDraft(prev => prev ? { ...prev, [field]: value } : null); setSaveError(''); }
  let begin = 0, end = 0;
  try { if (draft) { begin = parseTime(draft.start); end = draft.end === '00:00' ? 1440 : parseTime(draft.end); } } catch { /* Native inputs show missing times. */ }
  const validTimes = !!draft?.start && !!draft?.end && end > begin;
  const conflict = !!draft && validTimes && overlaps(begin, end, entries, draft.member_id, draft.date, draft.id);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || draft.billed || savingRef.current) return;
    savingRef.current = true; setSaving(true); setSaveError('');
    try {
      const res = await fetch('/api/time', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, action: 'saveEntry' }) });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error || 'Enregistrement impossible.');
      setAnchor(draft.date); setMember(draft.member_id); setDraft(null); setUndo(null); setOperationError(false);
      setNotice(draft.version ? 'Prestation mise à jour dans le calendrier.' : 'Prestation enregistrée dans le calendrier.');
      setRevision(n => n + 1); onSaved();
    } catch (e) { setSaveError(e instanceof Error ? e.message : 'Enregistrement non confirmé. Vos champs sont conservés ; réessayez.'); }
    finally { savingRef.current = false; setSaving(false); }
  }
  async function removeEntry() {
    if (!draft?.version || draft.billed || savingRef.current) return;
    focusTarget.current = { id: draft.id, handle: 'body', date: draft.date };
    setFocusRestoreReady(false);
    savingRef.current=true; setSaving(true); setLoading(true); setSaveError('');
    try {
      const res=await fetch('/api/time',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'deleteEntry',id:draft.id,version:draft.version})});
      const result=await res.json() as {error?:string};if(!res.ok)throw new Error(result.error||'Suppression impossible.');
      setDraft(null);setDeleting(false);setUndo(null);setOperationError(false);setNotice('Prestation supprimée. Les totaux ont été actualisés.');setRevision(n=>n+1);void onSaved();setFocusRestoreReady(true);
    }catch(e){setSaveError(e instanceof Error?e.message:'Suppression non confirmée. Actualisez avant de réessayer.');setLoading(false);setFocusRestoreReady(true);}
    finally{savingRef.current=false;setSaving(false);}
  }
  async function changeEntry(entry: Entry, next: {date:string;start:number;end:number}) {
    if(savingRef.current||entry.billed)return;
    if(overlaps(next.start,next.end,entries,entry.member_id,next.date,entry.id)){setOperationError(true);setNotice('Déplacement impossible : ce créneau chevauche une autre prestation.');return;}
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const activeHandle = active?.dataset.calendarHandle;
    if (active?.dataset.entryId === entry.id && (activeHandle === 'body' || activeHandle === 'start' || activeHandle === 'end' || activeHandle === 'move')) {
      focusTarget.current = { id: entry.id, handle: activeHandle, date: next.date };
      setFocusRestoreReady(false);
    }
    savingRef.current=true;setSaving(true);setLoading(true);setOperationError(false);setNotice('Enregistrement des horaires…');
    try{
      const res=await fetch('/api/time',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...entry,...next,action:'saveEntry',start:clockTime(next.start),end:next.end===1440?'00:00':clockTime(next.end),on_site:entry.on_site===null?null:!!entry.on_site})});
      const result=await res.json() as {error?:string};if(!res.ok)throw new Error(result.error||'Modification impossible.');
      setUndo({ id: entry.id, original: { date: entry.date, start: entry.start, end: entry.end }, version: entry.version + 1 });setNotice(`Horaires enregistrés : ${clockTime(next.start)}–${clockTime(next.end)}.`);setRevision(n=>n+1);await Promise.resolve(onSaved());
      if (focusTarget.current) setFocusRestoreReady(true);
    }catch(e){setOperationError(true);setNotice(e instanceof Error?e.message:'Enregistrement non confirmé. Actualisez avant de réessayer.');setRevision(n=>n+1);if(focusTarget.current)setFocusRestoreReady(true);}
    finally{savingRef.current=false;setSaving(false);}
  }
  async function undoMove(value: UndoMove) {
    if (savingRef.current) return;
    focusTarget.current = { id: value.id, handle: 'move', date: value.original.date };
    setFocusRestoreReady(false);
    savingRef.current = true; setSaving(true); setLoading(true); setOperationError(false); setNotice('Restauration des horaires précédents…');
    try {
      const res = await fetch('/api/time', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(restoreEntryPayload(value)) });
      const result = await res.json() as { error?: string };
      if (!res.ok) throw new Error(result.error || 'Annulation impossible.');
      setUndo(null); setNotice('Horaires précédents restaurés.'); setRevision(n => n + 1); await Promise.resolve(onSaved());
      if (focusTarget.current) setFocusRestoreReady(true);
    } catch (e) {
      setOperationError(true); setNotice(e instanceof Error ? e.message : 'Annulation non confirmée. Actualisez avant de réessayer.'); setLoading(false); setRevision(n => n + 1); if (focusTarget.current) setFocusRestoreReady(true);
    } finally { savingRef.current = false; setSaving(false); }
  }
  const range = selection ? selectedRange(selection.first, selection.last) : null;
  const readOnly = !!draft?.billed;
  const clientColors = new Map(data.clients.map(client => [client.id, client.color]));
  const eventColor = (clientId: string): CSSProperties => {
    const color = clientColors.get(clientId);
    return color ? { '--client-color': color, '--client-tint': color + '1A', '--client-hover': color + '2E', '--client-border': color + '66' } as CSSProperties : {};
  };

  return <section className="time-calendar" aria-label="Calendrier des prestations">
    {notice && <div className={'alert '+(operationError?'error':'success')} role={operationError?'alert':'status'}><Check size={18} />{notice}{undo&&<button className="text-button" disabled={saving} onClick={()=>void undoMove(undo)}>Annuler le déplacement</button>}</div>}
    <div className="calendar-toolbar"><div className="calendar-navigation"><button className="secondary" aria-label="Semaine précédente" onClick={() => changeWeek(-1)}><ChevronLeft size={18} /></button><button className="secondary" onClick={() => { invalidateFocusTarget(); setAnchor(today); setRange(null); }}>Aujourd’hui</button><button className="secondary" aria-label="Semaine suivante" disabled={addDays(startOfWeek, 7) > today} onClick={() => changeWeek(1)}><ChevronRight size={18} /></button><h2>{new Date(startOfWeek + 'T12:00:00Z').toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}<span> — {new Date(addDays(startOfWeek, 6) + 'T12:00:00Z').toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', timeZone: 'UTC' })}</span></h2></div><div className="calendar-controls"><label><span className="sr-only">Aller à une date</span><input type="date" max={today} value={anchor} onChange={e => { if (validDate(e.target.value) && e.target.value <= today) { invalidateFocusTarget(); setAnchor(e.target.value); } }} /></label>{me.role === 'admin' && <label><span className="sr-only">Calendrier du partenaire</span><select value={member} onChange={e => { invalidateFocusTarget(); setMember(e.target.value); }}><option value="">Toute l’équipe</option>{data.members.map(m => <option key={m.id} value={m.id}>{m.id === me.id ? 'Mon calendrier' : m.name}</option>)}</select></label>}<button className="primary" disabled={loading || !!loadError} onClick={() => openRange(anchor, 36, 39)}><Plus size={17} />Prestation</button></div></div>
    <div className="calendar-instructions"><span><Clock3 size={16} /><span className="mouse-instruction">Sélectionnez une plage, déplacez une prestation ou étirez ses bords. Pas de 15 min ; horaires précis au clavier.</span><span className="touch-instruction">Touchez le premier puis le dernier quart d’heure de votre prestation.</span></span><span>Saisie pour <strong>{me.name}</strong> · Bruxelles</span></div>
    {loadError && <div className="alert error" role="alert"><span>{loadError}</span><button className="secondary" onClick={() => setRevision(n => n + 1)}><RefreshCw size={16} />Réessayer</button></div>}
    {selection && range && <div className="calendar-selection-bar" role="status"><span>{dayName(selection.date)} · <strong>{clockTime(range.start)}–{clockTime(range.end)}</strong> · {duration(range.end - range.start)}</span>{selection.mode !== 'mouse' && <button className="primary" onClick={() => openRange(selection.date, selection.first, selection.last)}>Continuer</button>}<button className="icon-button" aria-label="Annuler la sélection" onClick={() => setRange(null)}><X size={18} /></button></div>}
    <div className="calendar-panel panel" aria-busy={loading}>
      <div className="calendar-day-head"><span className="calendar-zone">24 h</span>{days.map(date => <button key={date} className={'calendar-day-label' + (date === today ? ' is-today' : '') + (date === anchor ? ' selected-day' : '') + (date > today ? ' future-day' : '')} onClick={() => { invalidateFocusTarget(); setAnchor(date); setRange(null); }} disabled={date > today}><span>{new Date(date + 'T12:00:00Z').toLocaleDateString('fr-BE', { weekday: 'short', timeZone: 'UTC' })}</span><strong>{Number(date.slice(-2))}</strong><small>{loading ? '…' : duration(entries.filter(e => e.date === date).reduce((sum, e) => sum + billedMinutes(e.start, e.end), 0))}</small></button>)}</div>
      <div className="calendar-scroll" ref={scroll}>
        <div className="calendar-grid" style={{ height: SLOT_COUNT * SLOT_HEIGHT }}><div className="calendar-hours" aria-hidden="true">{Array.from({ length: 24 }, (_, h) => <span key={h} style={{ top: h * 4 * SLOT_HEIGHT }}>{String(h).padStart(2, '0')}:00</span>)}<span className="calendar-midnight">24:00</span></div>
        {days.map(date => <div key={date} data-date={date} aria-label={dayName(date, true)} className={'calendar-day-column' + (date === anchor ? ' selected-day' : '') + (date === today ? ' is-today' : '') + (date > today ? ' future-day' : '')} onPointerDown={e => pointerDown(e, date)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { if (selectionRef.current?.mode === 'mouse') setRange(null); }} onLostPointerCapture={() => { if (selectionRef.current?.mode === 'mouse') setRange(null); }}>
          {Array.from({ length: SLOT_COUNT }, (_, slot) => <button key={slot} type="button" data-time-slot={slot} aria-label={`${dayName(date, true)}, ${clockTime(slot * 15)} à ${clockTime((slot + 1) * 15)}`} className={'calendar-slot' + (slot % 4 === 0 ? ' hour-start' : '')} style={{ height: SLOT_HEIGHT }} tabIndex={slot === cursor && date <= today ? 0 : -1} disabled={loading || !!loadError || date > today} onFocus={() => setCursor(slot)} onKeyDown={e => key(e, date, slot)} onClick={e => { if (lastPointer.current === 'touch') tap(date, slot); else if (e.detail === 0) openRange(date, slot, slot); }}><span>{clockTime(slot * 15)}</span></button>)}
          {selection?.date === date && range && <div className="calendar-range" style={{ top: range.start / 15 * SLOT_HEIGHT, height: (range.end - range.start) / 15 * SLOT_HEIGHT }}><strong>{clockTime(range.start)}–{clockTime(range.end)}</strong></div>}
          {layoutEntries(entries.filter(e => e.date === date), 12.5).map(({ entry, lane, lanes }) => <CalendarItem key={entry.id} entry={entry} lane={lane} lanes={lanes} colorStyle={eventColor(entry.client_id)} colored={!!clientColors.get(entry.client_id)} team={member===''} disabled={loading} today={today} onOpen={()=>openEntry(entry)} onChange={(entry,next)=>void changeEntry(entry,next)} />)}
        </div>)}
        </div>
      </div>
      <div className="calendar-footer"><span>{loading ? 'Chargement de la semaine…' : `${entries.length} prestation${entries.length > 1 ? 's' : ''} · ${duration(entries.reduce((sum, e) => sum + billedMinutes(e.start, e.end), 0))} facturables`}</span><span className="calendar-keyboard-help">Clavier : flèches · Maj + ↑/↓ pour étendre · Entrée pour saisir</span></div>
    </div>
    <Dialog open={!!draft} onOpenChange={open => { if (!open) closeDraft(); }}>
      <DialogContent className="calendar-dialog" showCloseButton={false} onInteractOutside={e => e.preventDefault()} onEscapeKeyDown={e => { e.preventDefault(); closeDraft(); }} onCloseAutoFocus={e => { e.preventDefault(); if (returnFocus.current?.isConnected) returnFocus.current.focus(); }}>
        <div className="calendar-modal-heading"><span className="square-icon"><CalendarDays size={22} /></span><div><DialogTitle>{readOnly ? 'Prestation facturée' : draft?.version ? 'Modifier la prestation' : 'Nouvelle prestation'}</DialogTitle><DialogDescription>{draft ? `${dayName(draft.date, true)} · ${draft.member}` : ''}</DialogDescription></div><button type="button" aria-label="Fermer la fenêtre" className="icon-button" disabled={saving} onClick={closeDraft}><X size={20} /></button></div>
        {draft && <form className="calendar-entry-form" onSubmit={save}>
          {saveError && <div className="alert error" role="alert">{saveError}</div>}
          {readOnly && <div className="calendar-locked"><LockKeyhole size={18} /><span>Cette prestation est verrouillée. Un administrateur peut la rouvrir depuis le relevé.</span></div>}
          {!data.clients.some(c => c.active) && !draft.version && <div className="alert error">Ajoutez d’abord un client dans l’onglet Clients, puis revenez sélectionner votre plage horaire.</div>}
          <fieldset disabled={saving || readOnly}>
            <label>Client <span className="required">*</span><select autoFocus required value={draft.client_id} onChange={e => update('client_id', e.target.value)}><option value="">Choisir un client</option>{data.clients.filter(c => c.active || (draft.version && c.id === draft.client_id)).map(c => <option key={c.id} value={c.id}>{c.name}{c.active ? '' : ' (archivé)'}</option>)}</select></label>
            <label>Numéro de ticket <span className="required">*</span><input required maxLength={120} placeholder="Ex. INC-2026-042" value={draft.ticket} onChange={e => update('ticket', e.target.value)} /></label>
            {!readOnly&&<NewGlpiTicket clients={data.clients} memberId={data.me!.id} initialClient={draft.client_id} initialDescription={draft.description} disabled={saving} onCreated={ticket=>setDraft(prev=>prev?{...prev,client_id:ticket.client_id||prev.client_id,ticket:'GLPI-'+ticket.id,description:prev.description||ticket.title}:prev)}/>}
            <div className="calendar-modal-times"><label>Date <span className="required">*</span><input required type="date" max={today} value={draft.date} onChange={e => update('date', e.target.value)} /></label><TimeInput label="Début" value={draft.start} onChange={value => update('start', value)} disabled={saving || readOnly} /><TimeInput label="Fin" value={draft.end} onChange={value => update('end', value)} disabled={saving || readOnly} /></div>
            <LocationField value={draft.on_site} onChange={on_site => setDraft(prev => prev ? ({ ...prev, on_site }) : prev)} disabled={saving || readOnly} />
            <label>Description <span className="optional">facultatif</span><textarea rows={3} maxLength={2000} value={draft.description} onChange={e => update('description', e.target.value)} placeholder="Sur quoi avez-vous travaillé ?" /></label>
          </fieldset>
          <div className="duration-preview"><div><span>Temps réel</span><strong>{validTimes ? duration(end - begin) : '—'}</strong></div><ChevronRight size={18} /><div><span>À facturer</span><strong>{validTimes ? duration(billedMinutes(begin, end)) : '—'}</strong></div></div>
          {conflict && !readOnly && <p className="calendar-conflict" role="alert">Ce créneau chevauche une autre prestation de {draft.member}. Ajustez les horaires.</p>}
          {deleting&&<div className="inline-confirm" role="alert"><p>Supprimer la prestation <strong>{draft.ticket}</strong> de {data.clients.find(c=>c.id===draft.client_id)?.name}, le {draft.date}, de {draft.start} à {draft.end} ?</p><div><button type="button" className="secondary" disabled={saving} onClick={()=>setDeleting(false)}>Conserver</button><button type="button" className="primary danger-button" disabled={saving} onClick={()=>void removeEntry()}>Confirmer la suppression</button></div></div>}
          <div className="calendar-modal-actions">{draft.version&&!readOnly&&!deleting&&<button type="button" className="secondary danger-button" disabled={saving} onClick={()=>setDeleting(true)}><Trash2 size={16}/>Supprimer</button>}<button type="button" className="secondary" disabled={saving} onClick={closeDraft}>{readOnly ? 'Fermer' : 'Annuler'}</button>{!readOnly && <button className="primary" disabled={saving || !validTimes || conflict || !draft.client_id}><Check size={18} />{saving ? 'Enregistrement…' : 'Enregistrer la prestation'}</button>}</div>
          <p className="form-note">Heures de Bruxelles · Fin 00:00 = minuit · Arrondi au quart d’heure supérieur</p>
        </form>}
      </DialogContent>
    </Dialog>
  </section>;
}
