'use client';
import { useEffect, useState } from 'react';
import Brand from '@/components/brand';
import { ArrowRight, ShieldCheck } from 'lucide-react';

export default function Login() {
  const [state, setState] = useState<{ setup: boolean; ldap: boolean; entra?: 'disabled' | 'incomplete' | 'ready' } | null>(null);
  const [form, setForm] = useState({ name: '', email: '', login: '', password: '', confirm: '', token: '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const update = (key: keyof typeof form, value: string) => setForm(f => ({ ...f, [key]: value }));
  useEffect(() => {
    const errors: Record<string, string> = { unavailable: 'La connexion Microsoft est indisponible. Utilisez votre accès habituel ou réessayez plus tard.', cancelled: 'Connexion Microsoft annulée ou refusée. Réessayez ou contactez votre administrateur.', denied: 'Ce compte Microsoft n’a pas accès à SumaTime. Contactez votre administrateur.', invalid: 'La connexion Microsoft a expiré ou son retour n’est pas valide. Réessayez.' };
    const code = new URLSearchParams(window.location.search).get('entra_error');
    const token = new URLSearchParams(window.location.hash.slice(1)).get('setup');
    if (code || token) history.replaceState(null, '', '/login');
    fetch('/api/auth').then(r => r.json() as Promise<{ setup: boolean; ldap: boolean; entra?: 'disabled' | 'incomplete' | 'ready'; me?: unknown }>).then(data => { if (data.me) window.location.assign(new URL('/', window.location.origin).href); else { setState(data); if (code) setError(errors[code] || errors.invalid); if (token) setForm(f => ({ ...f, token })); } }).catch(() => setError('Connexion au serveur impossible. Rechargez la page.'));
  }, []);
  return <div className="welcome"><div className="welcome-card"><div className="brand dark-brand"><Brand /></div><span className="eyebrow">VOTRE ESPACE DE PRESTATIONS</span><h1>{state?.setup ? 'Créons votre accès.' : 'Heureux de vous retrouver.'}</h1><p>{state?.setup ? 'Choisissez votre compte administrateur. Vos clients et prestations existants seront conservés.' : 'Connectez-vous pour retrouver votre calendrier et enregistrer vos interventions.'}</p>{error && <div className="alert error" role="alert">{error}</div>}{state && !state.setup && state.entra === 'ready' && <><a className="microsoft-login" href="/api/auth/entra/start"><span className="microsoft-mark" aria-hidden="true"><i /><i /><i /><i /></span>Se connecter avec Microsoft</a><p className="fine microsoft-hint">Votre compte Microsoft 365 Sumatoni.</p><a className="text-button microsoft-switch" href="/api/auth/entra/start?switch=1">Choisir un autre compte Microsoft</a><div className="login-divider">{state.ldap ? 'ou votre accès local / LDAP' : 'ou votre accès local'}</div></>}{state && !state.setup && state.entra === 'incomplete' && <p className="fine microsoft-hint">L’accès Microsoft n’est pas encore activé. Utilisez votre accès habituel.</p>}{!state ? <p>Chargement…</p> : <form onSubmit={async e => {
    e.preventDefault(); setError('');
    if (state.setup && form.password !== form.confirm) { setError('Les mots de passe ne correspondent pas.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: state.setup ? 'setup' : 'login', ...form }) });
      const result = await res.json() as { error?: string };
      if (!res.ok) throw new Error(result.error);
      window.location.assign(new URL('/', window.location.origin).href);
    } catch (e) { setError(e instanceof Error ? e.message : 'Connexion impossible.'); setBusy(false); }
  }}>
    {state.setup ? <><label>Votre nom<input required autoComplete="name" maxLength={100} value={form.name} onChange={e => update('name', e.target.value)} /></label><label>Adresse e-mail<input required type="email" autoComplete="username" maxLength={254} value={form.email} onChange={e => update('email', e.target.value)} /></label><label>Code d’installation<input required type="password" autoComplete="off" value={form.token} onChange={e => update('token', e.target.value)} /></label><p className="fine">Le code figure dans le fichier setup-token.txt du dossier de données du serveur.</p></> : <label>{state.ldap ? 'E-mail local ou identifiant AD / LDAP' : 'Adresse e-mail'}<input required autoComplete="username" maxLength={254} value={form.login} onChange={e => update('login', e.target.value)} autoFocus /></label>}
    <label>Mot de passe<input required type="password" autoComplete={state.setup ? 'new-password' : 'current-password'} minLength={state.setup ? 12 : 1} maxLength={128} value={form.password} onChange={e => update('password', e.target.value)} /></label>
    {state.setup && <label>Confirmer le mot de passe<input required type="password" autoComplete="new-password" minLength={12} maxLength={128} value={form.confirm} onChange={e => update('confirm', e.target.value)} /></label>}
    <button className="primary full" disabled={busy}>{busy ? 'Connexion…' : state.setup ? 'Créer mon espace' : 'Se connecter'}<ArrowRight size={18} /></button>
    <div className="info-line"><ShieldCheck size={20} /><span>{state.setup ? '12 caractères minimum. Ce compte administrateur sera indépendant de votre annuaire.' : 'Accès individuel. Pour créer un compte ou réinitialiser votre mot de passe, contactez votre administrateur.'}</span></div>
  </form>}</div><div className="welcome-footer">SUMATONI / TIME REGISTRATION</div></div>;
}
