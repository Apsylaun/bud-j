'use client';
import { useEffect, useMemo, useState } from 'react';
import { getSupabase } from '../../lib/supabase.js';
import { loadAccounts, loadTransactions, loadRules, reapplyRules } from '../../lib/data.js';
import { categoryNames } from '../../lib/categories.js';
import { suggestPattern, norm } from '../../lib/rules.js';
import { eur, dateFr, resolvePeriod } from '../../lib/format.js';
import { PeriodPicker } from '../../components/Filters.js';
import { TagSelect } from '../../components/Tag.js';
import PotSplit from '../../components/PotSplit.js';
import { loadPots, loadEntries, ownBalances, buildTree, flatNodes, fundedByTx } from '../../lib/pots.js';

const PAGE = 100;
const today = () => new Date().toISOString().slice(0, 10);
const num = (s) => Number(String(s).replace(',', '.')) || 0;

function TxEditor({ tx, accounts, onSaved, onCancel }) {
  const isNew = !tx;
  const [f, setF] = useState(() => ({
    date: tx ? tx.date : today(),
    label: tx ? tx.label : '',
    type: tx && tx.amount >= 0 ? 'in' : 'out',
    amount: tx ? String(Math.abs(tx.amount)) : '',
    account: tx ? tx.account_id : (accounts[0] ? accounts[0].id : ''),
    category: tx ? tx.category || '' : '',
  }));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p) => setF((x) => ({ ...x, ...p }));

  async function save(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const amount = (f.type === 'out' ? -1 : 1) * Math.abs(num(f.amount));
      if (!amount) throw new Error('Montant invalide.');
      if (!f.account) throw new Error('Choisis un compte.');
      const sb = getSupabase();
      const cat = f.category || null;
      if (isNew) {
        const { error } = await sb.from('transactions').insert({
          account_id: f.account, date: f.date, label: f.label.trim(), amount, category: cat,
          cat_source: cat ? 'manual' : null, hash: `manual:${crypto.randomUUID()}`,
        });
        if (error) throw error;
      } else {
        const patch = { account_id: f.account, date: f.date, label: f.label.trim(), amount, category: cat };
        if (cat !== (tx.category || null)) patch.cat_source = cat ? 'manual' : null;
        const { error } = await sb.from('transactions').update(patch).eq('id', tx.id);
        if (error) throw error;
      }
      onSaved();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  }

  async function remove() {
    if (!window.confirm('Supprimer cette opération ?')) return;
    const { error } = await getSupabase().from('transactions').delete().eq('id', tx.id);
    if (error) return setErr(error.message);
    onSaved();
  }

  return (
    <form className="panel formgrid" onSubmit={save}>
      <div className="form">
        <input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} required aria-label="Date" />
        <select value={f.account} onChange={(e) => set({ account: e.target.value })} aria-label="Compte">
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.shared ? ' (commun)' : ''}</option>)}
        </select>
      </div>
      <input type="text" placeholder="Libellé" value={f.label} onChange={(e) => set({ label: e.target.value })} required />
      <div className="form">
        <select value={f.type} onChange={(e) => set({ type: e.target.value })} aria-label="Sens">
          <option value="out">Dépense</option>
          <option value="in">Revenu</option>
        </select>
        <input type="text" inputMode="decimal" className="num" placeholder="Montant €" value={f.amount} onChange={(e) => set({ amount: e.target.value })} required aria-label="Montant" />
        <TagSelect value={f.category} onChange={(c) => set({ category: c })} options={categoryNames()} />
      </div>
      {err && <p className="err">{err}</p>}
      <div className="form">
        <button className="btn" disabled={busy}>{isNew ? 'Ajouter' : 'Enregistrer'}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Annuler</button>
        {!isNew && <button type="button" className="btn danger" onClick={remove}>Supprimer</button>}
      </div>
    </form>
  );
}

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
  const [potData, setPotData] = useState(null);
  const [splitFor, setSplitFor] = useState(null);
  const [editFor, setEditFor] = useState(null); // id | 'new'
  const [state, setState] = useState({ loading: true, error: null });

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('todo') === '1') { setTodo(true); setPeriod({ preset: 'all' }); }
  }, []);

  const range = resolvePeriod(period);
  useEffect(() => {
    let off = false;
    setState({ loading: true, error: null });
    Promise.all([
      loadAccounts(),
      loadTransactions({ ...range, select: 'id,account_id,date,label,amount,category,cat_source' }),
      Promise.all([loadPots(), loadEntries()]).catch(() => null),
    ])
      .then(([a, t, p]) => { if (!off) { setAccounts(a); setTxs(t); setPotData(p && p[0].length ? { pots: p[0], entries: p[1] } : null); setState({ loading: false, error: null }); } })
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

  const potTree = useMemo(() => (potData ? buildTree(potData.pots, ownBalances(potData.entries)) : []), [potData]);
  const potNodes = useMemo(() => flatNodes(potTree), [potTree]);
  const funded = useMemo(() => (potData ? fundedByTx(potData.entries) : {}), [potData]);
  const spendLines = (id) => {
    const m = {};
    for (const e of potData.entries) if (e.kind === 'spend' && e.transaction_id === id) m[e.pot_id] = (m[e.pot_id] || 0) - Number(e.amount);
    return Object.entries(m).map(([pot_id, amount]) => ({ pot_id, amount: Math.round(amount * 100) / 100 }));
  };

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

  const done = () => { setEditFor(null); setTick((n) => n + 1); };

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
      {accounts.length > 0 && (editFor === 'new'
        ? <TxEditor accounts={accounts} onSaved={done} onCancel={() => setEditFor(null)} />
        : <button className="btn ghost" onClick={() => setEditFor('new')}>Ajouter une opération</button>)}

      {msg && <div className="warn">{msg}</div>}
      {state.error && <p className="err">{state.error}</p>}
      {state.loading ? <p className="muted">Chargement…</p> : (
        <>
          <p className="hint">{shown.length} opération{shown.length > 1 ? 's' : ''}</p>
          {shown.length === 0 ? <p className="muted">Rien à afficher.</p> : (
            <>
              <div className="txhead"><span>Date</span><span>Libellé</span><span>Compte</span><span>Catégorie</span><span>Montant</span><span /></div>
              <ul className="list" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: 0 }}>
                {shown.slice(0, limit).map((t) => (
                  <li key={t.id} className="txrow">
                    <span className="c-date muted">{dateFr(t.date)}</span>
                    <span className="c-label">{t.label}</span>
                    <span className="c-acct muted">{accById[t.account_id] ? accById[t.account_id].name : ''}</span>
                    <span className="c-cat"><TagSelect value={t.category || ''} onChange={(c) => setCategory(t, c)} options={categoryNames()} /></span>
                    <span className={'c-amt amt' + (t.amount > 0 ? ' pos' : '')}>{eur(t.amount, 2)}</span>
                    <span className="c-act">
                      <button className="btn ghost sm" onClick={() => addRule(t)} title="Appliquer cette catégorie à tous les libellés similaires">Règle</button>
                      {potData && t.amount < 0 && !(accById[t.account_id] && accById[t.account_id].shared) && (
                        <button className="btn ghost sm" onClick={() => setSplitFor(splitFor === t.id ? null : t.id)} title="Payer avec un ou plusieurs pots">
                          {funded[t.id] ? `Pot ${eur(funded[t.id])}` : 'Pot'}
                        </button>
                      )}
                      <button className="btn ghost sm" onClick={() => setEditFor(editFor === t.id ? null : t.id)}>Modifier</button>
                    </span>
                    {editFor === t.id && (
                      <div className="c-edit"><TxEditor tx={t} accounts={accounts} onSaved={done} onCancel={() => setEditFor(null)} /></div>
                    )}
                    {splitFor === t.id && (
                      <div className="c-edit">
                        <PotSplit tx={t} nodes={potNodes} existing={spendLines(t.id)}
                          onDone={() => { setSplitFor(null); setTick((n) => n + 1); }} onCancel={() => setSplitFor(null)} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {shown.length > limit && <button className="btn ghost more" onClick={() => setLimit((l) => l + PAGE)}>Afficher plus</button>}
        </>
      )}
    </>
  );
}
