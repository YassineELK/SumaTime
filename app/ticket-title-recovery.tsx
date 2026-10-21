'use client';
import { useEffect, useRef, useState } from 'react';
import type { Entry } from '@/lib/types';
import { historicalTicketId } from '@/lib/ticket-title';
export default function TicketTitleRecovery({ entries, onUpdated }: { entries: Entry[]; onUpdated: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [unavailable, setUnavailable] = useState<string[]>([]);
  const updated = useRef(onUpdated);
  useEffect(() => { updated.current = onUpdated; }, [onUpdated]);
  const candidates = entries.filter(e => !e.ticket_title?.trim() && historicalTicketId(e) !== null && !unavailable.includes(e.id));
  const batch: Entry[] = [], pairs = new Set<string>();
  for (const entry of candidates) {
    const key = entry.client_id + ':' + historicalTicketId(entry);
    if (!pairs.has(key) && pairs.size >= 20) continue;
    if (batch.length >= 40) break;
    pairs.add(key); batch.push(entry);
  }
  async function recover() {
    if (busy || !batch.length) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/ticket-titles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: batch.map(e => e.id) }) });
      const result = await response.json() as { error?: string; updated: string[]; unavailable: string[]; conflicts: string[] };
      if (!response.ok) throw new Error(result.error || 'Récupération impossible.');
      setUnavailable(prev => [...new Set([...prev, ...result.unavailable])]);
      setNotice(`${result.updated.length} intitulé(s) complété(s).` + (result.unavailable.length ? ` ${result.unavailable.length} ticket(s) inaccessible(s), introuvable(s) ou associés à un autre client ; titres laissés vides.` : '') + (result.conflicts.length ? ' Certaines prestations ont changé : actualisez avant de réessayer.' : ''));
      updated.current();
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  if (!candidates.length && !unavailable.length && !notice && !error) return null;
  return <div className="ticket-title-recovery">
    {!!candidates.length && <><button type="button" className="secondary" disabled={busy} onClick={() => void recover()}>{busy ? 'Récupération des intitulés…' : `Compléter les intitulés manquants (${candidates.length})`}</button><p className="fine">Depuis GLPI avec votre accès personnel, pour les prestations filtrées. Les titres déjà enregistrés et les heures restent conservés. {candidates.length > batch.length ? 'La récupération procède par petits lots.' : ''}</p></>}
    {error && <div role="alert" className="alert error">{error}</div>}
    {notice && <div role="status" className="alert success">{notice}</div>}
    {!!unavailable.length && <button type="button" className="text-button" disabled={busy} onClick={() => { setUnavailable([]); setNotice(''); }}>Réessayer les tickets inaccessibles</button>}
  </div>;
}
