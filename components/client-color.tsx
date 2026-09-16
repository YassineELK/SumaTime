'use client';
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { Client } from '@/lib/types';

const palette = [
  ['Bleu Sumatoni', '#29A7DF'], ['Turquoise', '#008082'], ['Violet', '#8656C5'],
  ['Orange', '#D57724'], ['Rose', '#CC4E80'], ['Indigo', '#4F61BE'],
  ['Vert', '#508541'], ['Ardoise', '#607789'],
];
export default function ClientColor({ client, onSaved }: { client: Client; onSaved: () => void }) {
  const [color, setColor] = useState(client.color);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  useEffect(() => { setColor(client.color); }, [client.color]);
  const choose = (value: string | null) => { setColor(value); setDone(false); setError(''); };
  return <details className="billing-settings client-color-settings">
    <summary><span className="client-color-dot" style={{ backgroundColor: client.color || '#29A7DF' }} aria-hidden="true" />Couleur du calendrier · {client.color || 'Par défaut'}</summary>
    <form className="billing-settings-form" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError(''); setDone(false);
      try {
        const result = await fetch('/api/time', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'clientColor', id: client.id, color }) });
        const json = await result.json() as { error?: string };
        if (!result.ok) throw new Error(json.error || 'Enregistrement impossible.');
        setDone(true); onSaved();
      } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}>
      <div className="client-color-palette" role="group" aria-label={'Couleurs de ' + client.name}>{palette.map(([name, hex]) => <button type="button" key={hex} aria-label={name} aria-pressed={color === hex} title={name} disabled={busy} onClick={() => choose(hex)}><span style={{ backgroundColor: hex }} />{color === hex && <Check size={16} aria-hidden="true" />}</button>)}</div>
      <label className="client-color-custom">Couleur personnalisée<input type="color" aria-label={'Couleur personnalisée de ' + client.name} value={color || '#29A7DF'} disabled={busy} onChange={e => choose(e.target.value.toUpperCase())} /></label>
      <button type="button" className="secondary" disabled={busy || color === null} onClick={() => choose(null)}>Revenir à la couleur par défaut</button>
      <p>Appliquée à toutes les prestations de ce client, anciennes et nouvelles, pour toute l’équipe. Les prestations facturées gardent leur cadenas.</p>
      {error && <div className="alert error" role="alert">{error}</div>}{done && <p role="status">Couleur enregistrée.</p>}
      <button className="primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer la couleur'}</button>
    </form>
  </details>;
}
