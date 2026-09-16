'use client';
import { useState, type FormEvent } from 'react';
import type { Member } from '@/lib/types';
export async function authAction(payload: object) {
  const res = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const result = await res.json() as { error?: string };
  if (!res.ok) throw new Error(result.error || 'Opération impossible.');
}
export function Logout({ children, className }: { children: React.ReactNode; className?: string }) {
  return <button type="button" className={className} aria-label="Se déconnecter" title="Se déconnecter" onClick={async () => { try { await authAction({ action: 'logout' }); window.location.assign('/login'); } catch { alert('Déconnexion impossible. Réessayez.'); } }}>{children}</button>;
}
export default function AccountPanel({ me, onDone }: { me: Member; onDone: () => void }) {
  const [current, setCurrent] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setDone(false);
    if (password !== confirm) { setError('Les mots de passe ne correspondent pas.'); return; }
    setBusy(true);
    try { await authAction({ action: 'password', current, password }); setCurrent(''); setPassword(''); setConfirm(''); setDone(true); onDone(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="panel management-form account-panel"><h2>{me.must_change ? 'Choisissez votre mot de passe' : 'Mon compte'}</h2><p>{me.name} · {me.email}</p>{me.provider === 'ldap' ? <p>Vous utilisez votre compte AD / LDAP. Le mot de passe se change dans votre annuaire d’entreprise.</p> : <><p>{me.must_change ? 'Votre mot de passe provisoire doit être remplacé avant d’accéder aux prestations.' : 'Après modification, vos autres sessions seront déconnectées.'}</p>{error && <div className="alert error" role="alert">{error}</div>}{done && <div className="alert success" role="status">Mot de passe modifié.</div>}<form onSubmit={submit}><label>{me.must_change ? 'Mot de passe provisoire' : 'Mot de passe actuel'}<input required type="password" autoComplete="current-password" maxLength={128} value={current} onChange={e => setCurrent(e.target.value)} /></label><label>Nouveau mot de passe<input required type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} /></label><label>Confirmer le nouveau mot de passe<input required type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirm} onChange={e => setConfirm(e.target.value)} /></label><p className="fine">12 caractères minimum.</p><button className="primary full" disabled={busy}>{busy ? 'Enregistrement…' : 'Changer mon mot de passe'}</button></form></>}</section>;
}
