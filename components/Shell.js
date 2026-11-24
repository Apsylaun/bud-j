'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getSupabase } from '../lib/supabase.js';

const NAV = [['/', 'Tableau de bord'], ['/transactions', 'Opérations'], ['/import', 'Import'], ['/reglages', 'Réglages']];

function Login() {
  const [email, setEmail] = useState('');
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    const { error } = await getSupabase().auth.signInWithPassword({ email, password: pwd });
    if (error) setErr('Email ou mot de passe incorrect.');
    setBusy(false);
  }

  return (
    <form className="login" onSubmit={submit}>
      <h1>Comptes</h1>
      <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
      <input type="password" placeholder="Mot de passe" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="current-password" required />
      <button className="btn" disabled={busy}>Se connecter</button>
      {err && <p className="err">{err}</p>}
    </form>
  );
}

export default function Shell({ children }) {
  const [session, setSession] = useState(undefined);
  const [fatal, setFatal] = useState('');
  const path = usePathname();

  useEffect(() => {
    try {
      const sb = getSupabase();
      sb.auth.getSession().then(({ data }) => setSession(data.session));
      const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
      return () => data.subscription.unsubscribe();
    } catch (e) {
      setFatal('Configuration manquante : NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY (voir README).');
    }
  }, []);

  if (fatal) return <div className="center err">{fatal}</div>;
  if (session === undefined) return <div className="center muted">Chargement…</div>;
  if (!session) return <Login />;

  return (
    <div className="app">
      <nav className="nav">
        <span className="brand">Comptes</span>
        {NAV.map(([href, label]) => (
          <Link key={href} href={href} className={(href === '/' ? path === '/' : path.startsWith(href)) ? 'on' : ''}>{label}</Link>
        ))}
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
