'use client';
import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '../../lib/supabase.js';
import { loadAccounts, loadRules, loadBalances, reapplyRules } from '../../lib/data.js';
import { CATEGORIES } from '../../lib/categories.js';
import { eur, dateFr } from '../../lib/format.js';

const BANKS = ['Crédit Agricole', 'Fortuneo', 'Crédit Mutuel', 'Bourse Direct', 'Autre'];

export default function Reglages() {
  const [accounts, setAccounts] = useState([]);
  const [balances, setBalances] = useState({});
  const [rules, setRules] = useState([]);
  const [msg, setMsg] = useState('');
  const [acc, setAcc] = useState({ name: '', bank: BANKS[0], shared: false });
  const [rule, setRule] = useState({ pattern: '', category: 'Courses' });

  const refresh = useCallback(async () => {
    try {
      const [a, r, b] = await Promise.all([loadAccounts(), loadRules(), loadBalances()]);
      setAccounts(a); setRules(r); setBalances(b);
    } catch (e) { setMsg(e.message); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function addAccount(e) {
    e.preventDefault();
    const { error } = await getSupabase().from('accounts').insert({ name: acc.name.trim(), bank: acc.bank, shared: acc.shared });
    if (error) return setMsg(error.message);
    setAcc({ name: '', bank: BANKS[0], shared: false }); setMsg(''); refresh();
  }

  async function delAccount(a) {
    if (!window.confirm(`Supprimer « ${a.name} » et toutes ses opérations ?`)) return;
    const { error } = await getSupabase().from('accounts').delete().eq('id', a.id);
    if (error) return setMsg(error.message);
    refresh();
  }

  async function syncRules() {
    const n = await reapplyRules(await loadRules());
    setMsg(`${n} opération(s) recatégorisée(s).`);
  }

  async function addRule(e) {
    e.preventDefault();
    try {
      const { error } = await getSupabase().from('rules').insert({ pattern: rule.pattern.trim().toLowerCase(), category: rule.category });
      if (error) throw error;
      setRule({ ...rule, pattern: '' });
      await syncRules(); refresh();
    } catch (err) { setMsg(err.message); }
  }

  async function delRule(r) {
    try {
      const { error } = await getSupabase().from('rules').delete().eq('id', r.id);
      if (error) throw error;
      await syncRules(); refresh();
    } catch (err) { setMsg(err.message); }
  }

  return (
    <>
      <h1>Réglages</h1>
      {msg && <div className="warn">{msg}</div>}

      <h2>Comptes</h2>
      {accounts.map((a) => (
        <div className="item" key={a.id}>
          <div>
            {a.name}<span className="badge">{a.bank}</span>{a.shared && <span className="badge">Commun</span>}
            {balances[a.id] && <div className="muted">Dernier solde connu : {eur(balances[a.id].balance, 2)} au {dateFr(balances[a.id].date)}</div>}
          </div>
          <button className="btn danger" onClick={() => delAccount(a)}>Supprimer</button>
        </div>
      ))}
      <form className="form" onSubmit={addAccount} style={{ marginTop: 12 }}>
        <input type="text" placeholder="Nom du compte" value={acc.name} onChange={(e) => setAcc({ ...acc, name: e.target.value })} required />
        <select value={acc.bank} onChange={(e) => setAcc({ ...acc, bank: e.target.value })}>
          {BANKS.map((b) => <option key={b}>{b}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={acc.shared} onChange={(e) => setAcc({ ...acc, shared: e.target.checked })} /> Compte commun</label>
        <button className="btn">Ajouter</button>
      </form>
      <p className="hint">Un compte commun est visible et modifiable par les deux utilisateurs. Un compte personnel n’est visible que par toi.</p>

      <h2>Règles de catégorisation</h2>
      <p className="hint">Si le libellé contient le mot-clé, la catégorie est appliquée à l’import. Tes choix manuels ne sont jamais écrasés. Des règles par défaut existent (courses, transport, retraits…).</p>
      {rules.map((r) => (
        <div className="item" key={r.id}>
          <span>« {r.pattern} » → {r.category}</span>
          <button className="btn danger" onClick={() => delRule(r)}>Supprimer</button>
        </div>
      ))}
      <form className="form" onSubmit={addRule} style={{ marginTop: 12 }}>
        <input type="text" placeholder="Mot-clé (ex : martin yann)" value={rule.pattern} onChange={(e) => setRule({ ...rule, pattern: e.target.value })} required />
        <select value={rule.category} onChange={(e) => setRule({ ...rule, category: e.target.value })}>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <button className="btn">Ajouter</button>
      </form>

      <h2>Session</h2>
      <button className="btn ghost" onClick={() => getSupabase().auth.signOut()}>Se déconnecter</button>
    </>
  );
}
