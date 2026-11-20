import { useState, type FormEvent } from 'react';
import { apiLogin, type AuthUser } from './api';
import { useAuth } from './auth-context';

// Ecran de connexion : affiché par la Gate quand aucune session active.
export function Login() {
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const u: AuthUser = await apiLogin(email, password, totp || undefined);
      if (!u || !u.email) throw new Error('Réponse invalide');
      await refresh();
    } catch (ex) {
      const m = ex instanceof Error ? ex.message : String(ex);
      setErr(
        m === 'unauthorized' ? 'Email ou mot de passe incorrect.'
        : m === 'too_many_requests' ? 'Trop de tentatives — réessayez dans 15 minutes.'
        : m === 'forbidden' ? 'Requête refusée (origine ou CSRF).'
        : 'Connexion impossible : ' + m
      );
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <form onSubmit={submit} className="bg-white shadow rounded-lg p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold text-slate-800 mb-1">QualityPlan</h1>
        <p className="text-slate-500 text-sm mb-6">Connexion requise</p>
        <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
        <input
          type="email" autoComplete="username" required value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-slate-300 rounded px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
        <label className="block text-sm font-medium text-slate-700 mb-1">Mot de passe</label>
        <input
          type="password" autoComplete="current-password" required value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-slate-300 rounded px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
        <label className="block text-sm font-medium text-slate-700 mb-1">Code de vérification (si activé)</label>
        <input
          type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={totp}
          onChange={(e) => setTotp(e.target.value)}
          className="w-full border border-slate-300 rounded px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
        {err && <p className="text-red-700 text-sm mb-4">{err}</p>}
        <button
          type="submit" disabled={busy}
          className="w-full bg-slate-800 text-white rounded px-3 py-2 font-medium hover:bg-slate-700 disabled:opacity-50"
        >
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </div>
  );
}
