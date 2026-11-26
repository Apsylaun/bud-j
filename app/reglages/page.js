'use client';
import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '../../lib/supabase.js';
import { loadAccounts, loadRules, loadBalances, reapplyRules, loadCategories } from '../../lib/data.js';
import { categoryNames, SWATCHES, KIND_LABEL, PROTECTED_KINDS } from '../../lib/categories.js';
import { Tag } from '../../components/Tag.js';
import Colors from '../../components/Colors.js';
import { eur, dateFr } from '../../lib/format.js';

const BANKS = ['Crédit Agricole', 'Fortuneo', 'Crédit Mutuel', 'Bourse Direct', 'Autre'];

export default function Reglages() {
  const [accounts, setAccounts] = useState([]);
  const [balances, setBalances] = useState({});
  const [rules, setRules] = useState([]);
  const [cats, setCats] = useState([]);
  const [catsOk, setCatsOk] = useState(true);
  const [paint, setPaint] = useState(null);
  const [msg, setMsg] = useState('');
  const [acc, setAcc] = useState({ name: '', bank: BANKS[0], shared: false });
  const [cat, setCat] = useState({ name: '', kind: 'expense', color: SWATCHES[0] });
  const [rule, setRule] = useState({ pattern: '', category: 'Courses' });
  const sb = getSupabase();

  const refresh = useCallback(async () => {
    try {
      const [a, r, b, c] = await Promise.all([loadAccounts(), loadRules(), loadBalances(), loadCategories()]);
      setAccounts(a); setRules(r); setBalances(b); setCatsOk(c !== null);
      setCats(c || []);
    } catch (e) { setMsg(e.message); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const attempt = async (fn) => {
    setMsg('');
    try { await fn(); await refresh(); } catch (e) { setMsg(e.message || String(e)); }
  };
  const check = ({ error }) => { if (error) throw error; };

  const addAccount = (e) => {
    e.preventDefault();
    attempt(async () => {
      check(await sb.from('accounts').insert({ name: acc.name.trim(), bank: acc.bank, shared: acc.shared }));
      setAcc({ name: '', bank: BANKS[0], shared: false });
    });
  };
  const delAccount = (a) => {
    if (window.confirm(`Supprimer « ${a.name} » et toutes ses opérations ?`)) attempt(async () => check(await sb.from('accounts').delete().eq('id', a.id)));
  };

  const addCat = (e) => {
    e.preventDefault();
    attempt(async () => {
      const sort = cats.reduce((m, c) => Math.max(m, c.sort || 0), 0) + 1;
      check(await sb.from('categories').insert({ name: cat.name.trim(), kind: cat.kind, color: cat.color, sort }));
      setCat({ ...cat, name: '' });
    });
  };
  const setColor = (c, color) => attempt(async () => check(await sb.from('categories').update({ color }).eq('id', c.id)));
  const renameCat = (c) => {
    const n = window.prompt('Nouveau nom :', c.name);
    if (n && n.trim() && n.trim() !== c.name) attempt(async () => check(await sb.rpc('rename_category', { p_old: c.name, p_new: n.trim() })));
  };
  const delCat = (c) => {
    if (window.confirm(`Supprimer « ${c.name} » ? Les opérations concernées repasseront en « à catégoriser ».`)) {
      attempt(async () => check(await sb.rpc('delete_category', { p_name: c.name })));
    }
  };

  const syncRules = async () => {
    const n = await reapplyRules(await loadRules());
    setMsg(`${n} opération(s) recatégorisée(s).`);
  };
  const addRule = (e) => {
    e.preventDefault();
    attempt(async () => {
      check(await sb.from('rules').insert({ pattern: rule.pattern.trim().toLowerCase(), category: rule.category }));
      setRule({ ...rule, pattern: '' });
      await syncRules();
    });
  };
  const delRule = (r) => attempt(async () => { check(await sb.from('rules').delete().eq('id', r.id)); await syncRules(); });

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

      <h2>Catégories</h2>
      {!catsOk && <div className="warn">Catégories modifiables indisponibles : exécute <code>supabase/005_budj.sql</code> dans Supabase.</div>}
      {catsOk && (
        <>
          <p className="hint">Les catégories sont communes aux deux utilisateurs. Renommer ou supprimer une catégorie met à jour toutes les opérations.</p>
          {cats.map((c) => (
            <div key={c.id}>
              <div className="item">
                <span><Tag name={c.name} color={c.color} /><span className="badge">{KIND_LABEL[c.kind]}</span></span>
                <span className="form">
                  <button className="btn ghost sm" onClick={() => setPaint(paint === c.id ? null : c.id)}>Couleur</button>
                  {!PROTECTED_KINDS.includes(c.kind) && <button className="btn ghost sm" onClick={() => renameCat(c)}>Renommer</button>}
                  {!PROTECTED_KINDS.includes(c.kind) && <button className="btn danger sm" onClick={() => delCat(c)}>Supprimer</button>}
                </span>
              </div>
              {paint === c.id && <Colors value={c.color} onPick={(col) => setColor(c, col)} />}
            </div>
          ))}
          <form onSubmit={addCat} style={{ marginTop: 12 }}>
            <div className="form">
              <input type="text" placeholder="Nouveau tag (ex : Cadeaux)" value={cat.name} onChange={(e) => setCat({ ...cat, name: e.target.value })} required />
              <select value={cat.kind} onChange={(e) => setCat({ ...cat, kind: e.target.value })} aria-label="Nature">
                <option value="expense">Dépense</option>
                <option value="income">Revenu</option>
              </select>
              <Tag name={cat.name || 'Aperçu'} color={cat.color} />
              <button className="btn">Créer</button>
            </div>
            <Colors value={cat.color} onPick={(color) => setCat({ ...cat, color })} />
          </form>
        </>
      )}

      <h2>Règles de catégorisation</h2>
      <p className="hint">Si le libellé contient le mot-clé, la catégorie est appliquée à l’import. Tes choix manuels ne sont jamais écrasés. Des règles par défaut existent (courses, transport, placement, retraits…).</p>
      {rules.map((r) => (
        <div className="item" key={r.id}>
          <span>« {r.pattern} » <Tag name={r.category} /></span>
          <button className="btn danger sm" onClick={() => delRule(r)}>Supprimer</button>
        </div>
      ))}
      <form className="form" onSubmit={addRule} style={{ marginTop: 12 }}>
        <input type="text" placeholder="Mot-clé (ex : martin yann)" value={rule.pattern} onChange={(e) => setRule({ ...rule, pattern: e.target.value })} required />
        <select value={rule.category} onChange={(e) => setRule({ ...rule, category: e.target.value })}>
          {categoryNames().map((c) => <option key={c}>{c}</option>)}
        </select>
        <button className="btn">Ajouter</button>
      </form>

      <h2>Session</h2>
      <button className="btn ghost" onClick={() => sb.auth.signOut()}>Se déconnecter</button>
    </>
  );
}
