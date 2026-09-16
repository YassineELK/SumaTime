'use client';
import { useState } from 'react';
import { amountInput, euro } from '@/lib/pricing';
import type { Client, Member } from '@/lib/types';

function RateForm({ id, client, member, onSaved }: { id: string; client?: Client; member?: Member; onSaved: () => void }) {
  const [standard, setStandard] = useState(amountInput(client?.hourly_rate_cents));
  const [onsite, setOnsite] = useState(amountInput(client?.onsite_hourly_rate_cents));
  const [fee, setFee] = useState(amountInput(member?.travel_fee_cents));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  return <form className="billing-settings-form" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError(''); setDone(false);
    try {
      const result = await fetch('/api/time', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: client ? 'clientRates' : 'memberFee', id, hourly_rate: standard, onsite_hourly_rate: onsite, travel_fee: fee }) });
      const json = await result.json() as { error?: string };
      if (!result.ok) throw new Error(json.error || 'Enregistrement impossible.');
      setDone(true); onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }}>
    {client ? <><label>Tarif horaire standard (€)<input inputMode="decimal" placeholder="Non renseigné" value={standard} onChange={e => setStandard(e.target.value)} maxLength={9} /></label><label>Tarif horaire sur site (€)<input inputMode="decimal" placeholder="Identique au tarif standard" value={onsite} onChange={e => setOnsite(e.target.value)} maxLength={9} /></label><p>Le tarif sur site remplace le tarif standard uniquement pour les interventions sur site. Les montants utilisent la durée arrondie au quart d’heure.</p></> : <><label>Forfait de déplacement prestataire (€)<input inputMode="decimal" placeholder="Non renseigné" value={fee} onChange={e => setFee(e.target.value)} maxLength={9} /></label><p>Une fois par jour et par client pour ce prestataire. Ce forfait n’est pas ajouté automatiquement au montant facturé au client.</p></>}
    <p>Applicable aux nouvelles prestations{member ? ' et aux nouveaux jours de déplacement' : ''}. Vide = non renseigné ; 0 = aucun montant. Les montants n’incluent aucun calcul de TVA.</p>
    {error && <div className="alert error" role="alert">{error}</div>}{done && <p role="status">Paramètres enregistrés.</p>}
    <button className="secondary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer les montants'}</button>
  </form>;
}
export function ClientRates({ client, onSaved }: { client: Client; onSaved: () => void }) {
  return <details className="billing-settings"><summary>Tarifs · Standard {euro(client.hourly_rate_cents)} / h · Sur site {euro(client.onsite_hourly_rate_cents ?? client.hourly_rate_cents)} / h</summary><RateForm id={client.id} client={client} onSaved={onSaved} /></details>;
}
export function MemberFee({ member, onSaved }: { member: Member; onSaved: () => void }) {
  return <details className="billing-settings"><summary>Déplacement · {euro(member.travel_fee_cents)} / jour / client</summary><RateForm id={member.id} member={member} onSaved={onSaved} /></details>;
}
