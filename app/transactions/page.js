'use client';
import { useEffect, useMemo, useState } from 'react';
import { getSupabase } from '../../lib/supabase.js';
import { loadAccounts, loadTransactions, loadRules, reapplyRules } from '../../lib/data.js';
import { CATEGORIES } from '../../lib/categories.js';
import { suggestPattern, norm } from '../../lib/rules.js';
import { eur, dateFr, resolvePeriod } from '../../lib/format.js';
import { PeriodPicker } from '../../components/Filters.js';

const PAGE = 100;

export default function Operations() {
  const [accounts, setAccounts] = useState([]);
  const [txs, setTxs] = useState([]);
  const [period, setPeriod] = useState({ preset: '3m' });
  const [accountId, setAccountId] = useState('');
  const [q, setQ] = useState('');
  const [todo, setTodo] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [msg, setMsg] = useState('');
  const [tick, setTick] = useState(0);
  const [state, setState] = useState({ loading: true, error: null });

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('todo') === '1') { setTodo(true); setPeriod({ preset: 'all' }); }
  }, []);

  const range = resolvePeriod(period);
  useEffect(() => {
    let off = false;
    setState({ loading: true, error: null });
    Promise.all([loadAccounts(), loadTransactions({ ...range, select: 'id,account_id,date,label,amount,category,cat_source' })])
      .then(([a, t]) => { if (!off) { setAccounts(a); setTxs(t); setState({ loading: false, error: null }); } })
      .catch((e) => { if (!off) setState({ loading: false, error: e.message }); });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, tick]);

  useEffect(() => setLimit(PAGE), [accountId, todo, q, period]);

  const accById = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);
  const shown = useMemo(() => {
    const nq = norm(q.trim());
    return txs.filter((t) =>
      (!accountId || t.account_id === accountId) && (!todo || !t.category) && (!nq || norm(t.label).includes(nq)));
  }, [txs, accountId, todo, q]);

  async function setCategory(t, category) {
    const patch = category ? { category, cat_source: 'manual' } : { category: null, cat_source: null };
    setTxs((xs) => xs.map((x) => (x.id === t.id ? { ...x, ...patch } : x)));
    const { error } = await getSupabase().from('transactions').update(patch).eq('id', t.id);
    if (error) { setMsg(error.message); setTick((n) => n + 1); }
  }

  async function addRule(t) {
    if (!t.category) return setMsg('Choisis d’abord une catégorie pour cette opération.');
    const input = window.prompt('Mot-clé à retrouver dans les libellés (sans accents ni date) :', suggestPattern(t.label));
    const pattern = (input || '').trim().toLowerCase();
    if (!pattern) return;
    try {
      const { error } = await getSupabase().from('rules').insert({ pattern, category: t.category });
      if (error) throw error;
      const n = await reapplyRules(await loadRules());
      setMsg(`Règle « ${pattern} » → ${t.category} créée. ${n} opération(s) mises à jour.`);
      setTick((x) => x + 1);
    } catch (e) { setMsg(e.message); }
  }

  return (
    <>
      <h1>Opérations</h1>
      <div className="filters">
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Compte">
          <option value="">Tous les comptes</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.shared ? ' (commun)' : ''}</option>)}
        </select>
        <input type="search" placeholder="Rechercher" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check"><input type="checkbox" checked={todo} onChange={(e) => setTodo(e.target.checked)} /> À catégoriser</label>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {msg && <div className="warn">{msg}</div>}
      {state.error && <p className="err">{state.error}</p>}
      {state.loading ? <p className="muted">Chargement…</p> : (
        <>
          <p className="hint">{shown.length} opération{shown.length > 1 ? 's' : ''}</p>
          {shown.length === 0 ? <p className="muted">Rien à afficher.</p> : (
            <ul className="list">
              {shown.slice(0, limit).map((t) => (
                <li key={t.id} className="tx">
                  <div className="tx-main">
                    <span className="tx-label">{t.label}</span>
                    <span className={'amt' + (t.amount > 0 ? ' pos' : '')}>{eur(t.amount, 2)}</span>
                  </div>
                  <div className="tx-sub">
                    <span className="tx-meta"><span>{dateFr(t.date)}</span><span>{accById[t.account_id]?.name}</span></span>
                    <span className="tx-actions">
                      <select className={t.category ? '' : 'todo'} value={t.category || ''} onChange={(e) => setCategory(t, e.target.value)} aria-label="Catégorie">
                        <option value="">À catégoriser</option>
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <button className="btn ghost" onClick={() => addRule(t)} title="Appliquer cette catégorie à tous les libellés similaires">Règle</button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {shown.length > limit && <button className="btn ghost more" onClick={() => setLimit((l) => l + PAGE)}>Afficher plus</button>}
        </>
      )}
    </>
  );
}
