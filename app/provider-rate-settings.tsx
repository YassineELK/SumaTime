'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { brusselsToday } from '@/lib/business';
import { amountInput, euro } from '@/lib/pricing';
type Rate = { effective_from: string; hourly_rate_cents: number | null; version: number };
export default function ProviderRateSettings({ memberId, onSaved, compact = false }: { memberId: string; onSaved: () => void; compact?: boolean }) {
  const [opened, setOpened] = useState(!compact), [rates, setRates] = useState<Rate[]>([]);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [date, setDate] = useState(brusselsToday), [amount, setAmount] = useState('');
  const selectedDate = useRef(date);
  const load = useCallback((signal?: AbortSignal) => {
    return fetch('/api/provider-rate?member=' + encodeURIComponent(memberId), { cache: 'no-store', signal }).then(async res => {
      const data = await res.json() as { error?: string; rates: Rate[] };
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(data.error || 'Chargement impossible.');
      setRates(data.rates); setAmount(amountInput(data.rates.find(r => r.effective_from === selectedDate.current)?.hourly_rate_cents)); setLoaded(true);
    }).catch((error: Error) => { if (!signal?.aborted) { setError(error.message); setLoaded(false); } });
  }, [memberId]);
  useEffect(() => { if (!opened) return; const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [opened, load]);
  const existing = rates.find(r => r.effective_from === date);
  const current = rates.find(r => r.effective_from <= brusselsToday());
  function selectDate(value: string) { selectedDate.current = value; setDate(value); setAmount(amountInput(rates.find(r => r.effective_from === value)?.hourly_rate_cents)); setNotice(''); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const res = await fetch('/api/provider-rate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ member_id: memberId, effective_from: date, hourly_rate: amount, version: existing?.version ?? 0 }) });
      const data = await res.json() as { error?: string; rates: Rate[] }; if (!res.ok) throw new Error(data.error || 'Enregistrement impossible.');
      setRates(data.rates); setNotice('Tarif enregistré. Les montants du relevé sont recalculés à partir de cette date.'); onSaved();
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <section className={compact ? 'provider-rate-settings' : 'panel management-form provider-rate-settings'}>
    {compact ? <button type="button" className="text-button" aria-expanded={opened} onClick={() => setOpened(!opened)}>Tarif avec Sumatoni</button> : <h2>Mon tarif avec Sumatoni</h2>}
    {opened && <><p>Tarif horaire actuel : <strong>{loaded ? euro(current?.hourly_rate_cents) : '…'}</strong> HT.</p><p className="fine">Votre rémunération avec Sumatoni, commune à tous les clients. Elle sert à valoriser votre relevé ; les tarifs de vente aux clients restent réservés aux administrateurs.</p>
      {error && <div className="alert error" role="alert">{error} <button type="button" className="text-button" disabled={busy} onClick={() => { setLoaded(false); setError(''); void load(); }}>Recharger les tarifs</button></div>}
      {notice && <div className="alert success" role="status">{notice}</div>}
      <form aria-label="Tarif avec Sumatoni" onSubmit={submit}>
        <label>Date d’application<input type="date" required disabled={!loaded || busy} value={date} onChange={e => selectDate(e.target.value)} /></label>
        <label>Tarif horaire avec Sumatoni · EUR HT<input inputMode="decimal" maxLength={9} placeholder="Ex. 50,00" disabled={!loaded || busy} value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <p className="fine">À partir de cette date, y compris pour les heures déjà saisies, jusqu’au prochain tarif. Les périodes antérieures conservent leur tarif. Un champ vide indique un tarif non renseigné ; 0 est un tarif nul. Les temps sont arrondis au quart d’heure supérieur par prestation. Les déplacements restent séparés.</p>
        <button className="primary" disabled={!loaded || busy}>{busy ? 'Enregistrement…' : existing ? 'Modifier ce tarif' : 'Ajouter ce tarif'}</button>
      </form>
      {!!rates.length && <div className="rate-history"><h3>Historique des tarifs</h3><ul>{rates.map(rate => <li key={rate.effective_from}><button type="button" className="text-button" disabled={busy} onClick={() => selectDate(rate.effective_from)}>Depuis le {rate.effective_from} : {euro(rate.hourly_rate_cents)} / h</button></li>)}</ul></div>}
    </>}
  </section>;
}
