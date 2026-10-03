'use client';
import NewGlpiTicket from './new-glpi-ticket';
import { useEffect, useState, type FormEvent } from 'react';
import { Check, Play, Save } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import TimeInput from '@/components/time-input';
import LocationField from '@/components/location-field';
import { brusselsToday, duration } from '@/lib/business';
import { suggestedTimes } from '@/lib/workday';
import type { EntrySeed, State } from '@/lib/types';
export const draftKey = (id: string) => 'sumatoni-quick-draft-v2:' + id;
type Draft = Required<EntrySeed> & { id: string };
export function readDraft(id: string): Draft | null {
  try { const d = JSON.parse(localStorage.getItem(draftKey(id)) || 'null'); return d && ['id','client_id','ticket','description','date','start','end'].every(k => typeof d[k] === 'string') && typeof d.on_site === 'boolean' ? d : null; } catch { return null; }
}
export default function QuickEntry({ data, seed, mode, onClose, onSaved }: { data: State; seed: EntrySeed | null; mode: 'entry' | 'timer'; onClose: () => void; onSaved: (message: string) => void }) {
  const [form, setForm] = useState<Draft>(() => (seed === null && mode === 'entry' ? readDraft(data.me!.id) : null) || { id: crypto.randomUUID(), ...suggestedTimes(), client_id: '', ticket: '', description: '', on_site: false, ...seed });
  const [restored] = useState(seed === null && mode === 'entry' && !!readDraft(data.me!.id));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [storageError, setStorageError] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [dirty, setDirty] = useState(restored || !!seed?.ticket);
  const minutes = (v: string) => /^\d\d:\d\d$/.test(v) ? Number(v.slice(0,2)) * 60 + Number(v.slice(3)) : NaN;
  const real = (form.end === '00:00' ? 1440 : minutes(form.end)) - minutes(form.start);
  useEffect(() => { if (mode !== 'entry' || !dirty) return; try { localStorage.setItem(draftKey(data.me!.id), JSON.stringify(form)); } catch { queueMicrotask(() => setStorageError(true)); } }, [form, dirty, mode, data.me]);
  const update = (patch: Partial<Draft>) => { setDirty(true); setForm(value => ({ ...value, ...patch })); };
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      const response = await fetch(mode === 'timer' ? '/api/workday' : '/api/time', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, action: mode === 'timer' ? 'start' : 'saveEntry' }) });
      const result = await response.json() as { error?: string }; if (!response.ok) throw new Error(result.error || 'Enregistrement impossible.');
      if (mode === 'entry') { try { localStorage.removeItem(draftKey(data.me!.id)); } catch {} }
      onSaved(mode === 'timer' ? 'Chronomètre démarré. Vous pouvez fermer l’onglet et le retrouver plus tard.' : 'Prestation enregistrée.'); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Enregistrement non confirmé. Réessayez sans fermer ce formulaire.'); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="calendar-dialog quick-dialog" onInteractOutside={e => e.preventDefault()}><DialogTitle>{mode === 'timer' ? 'Commencer une intervention' : restored ? 'Reprendre mon brouillon' : 'Ajouter une prestation'}</DialogTitle><DialogDescription>{mode === 'timer' ? 'Le temps commence à la validation. Vous vérifierez les horaires à la fin.' : 'Quelques champs, et votre relevé est à jour.'}</DialogDescription>
    {error && <div className="alert error" role="alert">{error}</div>}
    <form className="quick-form" onSubmit={save}><fieldset disabled={busy}>
      <label>Client <span className="required">*</span><select required autoFocus value={form.client_id} onChange={e => update({ client_id: e.target.value })}><option value="">Choisir un client</option>{data.clients.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Ticket <span className="required">*</span><input required maxLength={120} value={form.ticket} placeholder="Ex. GLPI-123 ou INC-042" onChange={e => update({ ticket: e.target.value })} /></label>
      <div className="span-all"><NewGlpiTicket clients={data.clients} memberId={data.me!.id} initialClient={form.client_id} initialDescription={form.description} disabled={busy} onCreated={ticket=>update({client_id:ticket.client_id||form.client_id,ticket:'GLPI-'+ticket.id,description:form.description||ticket.title})}/></div>
      {mode === 'entry' && <><label className="span-all">Date de l’intervention <span className="required">*</span><input type="date" required max={brusselsToday()} value={form.date} onChange={e => update({ date: e.target.value })} /></label><TimeInput label="Début" value={form.start} onChange={start => update({ start })} /><TimeInput label="Fin" value={form.end} onChange={end => update({ end })} /></>}
      <div className="span-all"><LocationField value={form.on_site} onChange={on_site => update({ on_site })} /></div>
      <label className="span-all">Travail réalisé <span className="optional">facultatif</span><textarea maxLength={2000} rows={3} value={form.description} placeholder="Le contexte utile pour votre relevé…" onChange={e => update({ description: e.target.value })} /></label>
    </fieldset>
    {mode === 'entry' && <div className="duration-preview"><div><span>Temps réel</span><strong>{real > 0 ? duration(real) : '—'}</strong></div><div><span>À facturer</span><strong>{real > 0 ? duration(Math.ceil(real / 15) * 15) : '—'}</strong></div></div>}
    <div className="quick-actions"><button type="button" className="secondary" disabled={busy} onClick={onClose}>Fermer</button><button className="primary" disabled={busy || (mode === 'entry' && !(real > 0))}>{mode === 'timer' ? <Play size={17} /> : <Check size={17} />}{busy ? 'Enregistrement…' : mode === 'timer' ? 'Démarrer le chronomètre' : 'Enregistrer la prestation'}</button></div>
    {mode === 'entry' && <p className="draft-note"><Save size={14} />{storageError ? 'Brouillon non conservé : le stockage de ce navigateur est indisponible.' : dirty ? 'Brouillon conservé sur cet appareil jusqu’à l’enregistrement.' : 'Votre brouillon sera conservé sur cet appareil.'}</p>}
    {mode === 'entry' && restored && <button type="button" className="text-button" disabled={busy} onClick={() => setDiscard(true)}>Supprimer le brouillon</button>}{discard && <div className="inline-confirm"><p>Supprimer ce brouillon de cet appareil ?</p><div><button type="button" className="secondary" onClick={() => setDiscard(false)}>Conserver</button><button type="button" className="secondary" onClick={() => { try { localStorage.removeItem(draftKey(data.me!.id)); } catch {} onClose(); }}>Confirmer la suppression</button></div></div>}
    </form></DialogContent></Dialog>;
}
