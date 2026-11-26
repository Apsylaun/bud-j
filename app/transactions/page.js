'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getSupabase } from '../../lib/supabase.js';
import { loadAccounts, loadTransactions, loadRules, reapplyRules } from '../../lib/data.js';
import { categoryNames, categoryList } from '../../lib/categories.js';
import { suggestPattern, norm } from '../../lib/rules.js';
import { eur, dateFr } from '../../lib/format.js';
import { TagSelect, Tag } from '../../components/Tag.js';
import { FilterMenu, Checklist } from '../../components/FilterMenu.js';
import PotSplit from '../../components/PotSplit.js';
import { loadPots, loadEntries, ownBalances, buildTree, flatNodes, fundedByTx } from '../../lib/pots.js';

const PAGE = 100;
const TODO = '__todo__';
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const pad = (n) => String(n).padStart(2, '0');
const today = () => new Date().toISOString().slice(0, 10);
const num = (s) => Number(String(s).replace(',', '.')) || 0;
const EMPTY = { years: [], months: [], accounts: [], cats: [], sens: '', min: '', max: '' };

function currentMonthFilter() {
  const d = new Date();
  return { ...EMPTY, years: [String(d.getFullYear())], months: [pad(d.getMonth() + 1)] };
}

// Valeurs par défaut d'une nouvelle opération d'après les filtres actifs (une seule valeur choisie = propriété imposée).
function defaultsFromFilters(f) {
  const d = new Date(), cy = String(d.getFullYear()), cm = pad(d.getMonth() + 1);
  const o = {};
  if (f.years.length === 1 || f.months.length === 1) {
    const y = f.years.length === 1 ? f.years[0] : cy;
    const m = f.months.length === 1 ? f.months[0] : cm;
    o.date = y === cy && m === cm ? today() : `${y}-${m}-01`;
  }
  if (f.accounts.length === 1) o.account = f.accounts[0];
  if (f.cats.length === 1 && f.cats[0] !== TODO) o.category = f.cats[0];
  if (f.sens) o.type = f.sens;
  return o;
}

// Cellule modifiable par double-clic : Entrée valide, Échap annule.
function Editable({ value, display, type = 'text', options, onSave, className = '', title }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState('');
  const cancelled = useRef(false);
  const start = () => { cancelled.current = false; setV(value); setEdit(true); };
  const commit = (nv) => {
    if (cancelled.current) return;
    setEdit(false);
    if (String(nv) !== String(value)) onSave(nv);
  };
  if (!edit) return <span className={className} title={title} onDoubleClick={start}>{display}</span>;
  const cls = `inl ${className}`;
  if (type === 'select') {
    return (
      <select autoFocus className={cls} value={v} onChange={(e) => commit(e.target.value)} onBlur={() => setEdit(false)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  const keys = (e) => {
    if (e.key === 'Escape') { cancelled.current = true; setEdit(false); }
    else if (e.key === 'Enter' && !(type === 'textarea' && e.shiftKey)) { e.preventDefault(); commit(v); }
  };
  const common = { autoFocus: true, className: cls, value: v, onChange: (e) => setV(e.target.value), onBlur: () => commit(v), onKeyDown: keys };
  if (type === 'textarea') return <textarea {...common} rows={Math.min(5, Math.max(2, Math.ceil(v.length / 38)))} />;
  return <input {...common} type={type === 'number' ? 'text' : type} inputMode={type === 'number' ? 'decimal' : undefined} />;
}

function TxEditor({ tx, defaults, accounts, onSaved, onCancel }) {
  const isNew = !tx;
  const d0 = defaults || {};
  const [f, setF] = useState(() => ({
    date: tx ? tx.date : d0.date || today(),
    label: tx ? tx.label : '',
    type: tx ? (tx.amount >= 0 ? 'in' : 'out') : d0.type || 'out',
    amount: tx ? String(Math.abs(tx.amount)) : '',
    account: tx ? tx.account_id : d0.account || (accounts[0] ? accounts[0].id : ''),
    category: tx ? tx.category || '' : d0.category || '',
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
      </div>
    </form>
  );
}

export default function Operations() {
  const [accounts, setAccounts] = useState([]);
  const [txs, setTxs] = useState([]);
  const [flt, setFlt] = useState(currentMonthFilter);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [msg, setMsg] = useState('');
  const [tick, setTick] = useState(0);
  const [potData, setPotData] = useState(null);
  const [splitFor, setSplitFor] = useState(null);
  const [editFor, setEditFor] = useState(null); // id | 'new'
  const [state, setState] = useState({ loading: true, error: null });

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('todo') === '1') setFlt({ ...EMPTY, cats: [TODO] });
  }, []);

  useEffect(() => {
    let off = false;
    setState({ loading: true, error: null });
    Promise.all([
      loadAccounts(),
      loadTransactions({ select: 'id,account_id,date,label,amount,category,cat_source' }),
      Promise.all([loadPots(), loadEntries()]).catch(() => null),
    ])
      .then(([a, t, p]) => { if (!off) { setAccounts(a); setTxs(t); setPotData(p && p[0].length ? { pots: p[0], entries: p[1] } : null); setState({ loading: false, error: null }); } })
      .catch((e) => { if (!off) setState({ loading: false, error: e.message }); });
    return () => { off = true; };
  }, [tick]);

  useEffect(() => setLimit(PAGE), [flt, q]);

  const accById = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);
  const years = useMemo(() => {
    const ys = new Set(txs.map((t) => t.date.slice(0, 4)));
    ys.add(String(new Date().getFullYear()));
    return [...ys].sort().reverse();
  }, [txs]);

  const shown = useMemo(() => {
    const nq = norm(q.trim());
    return txs.filter((t) => {
      if (flt.years.length && !flt.years.includes(t.date.slice(0, 4))) return false;
      if (flt.months.length && !flt.months.includes(t.date.slice(5, 7))) return false;
      if (flt.accounts.length && !flt.accounts.includes(t.account_id)) return false;
      if (flt.cats.length && !flt.cats.includes(t.category || TODO)) return false;
      if (flt.sens === 'out' && t.amount >= 0) return false;
      if (flt.sens === 'in' && t.amount <= 0) return false;
      const abs = Math.abs(t.amount);
      if (flt.min !== '' && abs < num(flt.min)) return false;
      if (flt.max !== '' && abs > num(flt.max)) return false;
      return !nq || norm(t.label).includes(nq);
    });
  }, [txs, flt, q]);
  const sum = shown.reduce((s, t) => s + t.amount, 0);

  const potTree = useMemo(() => (potData ? buildTree(potData.pots, ownBalances(potData.entries)) : []), [potData]);
  const potNodes = useMemo(() => flatNodes(potTree), [potTree]);
  const funded = useMemo(() => (potData ? fundedByTx(potData.entries) : {}), [potData]);
  const spendLines = (id) => {
    const m = {};
    for (const e of potData.entries) if (e.kind === 'spend' && e.transaction_id === id) m[e.pot_id] = (m[e.pot_id] || 0) - Number(e.amount);
    return Object.entries(m).map(([pot_id, amount]) => ({ pot_id, amount: Math.round(amount * 100) / 100 }));
  };

  async function patchTx(t, patch) {
    setTxs((xs) => xs.map((x) => (x.id === t.id ? { ...x, ...patch } : x)));
    const { error } = await getSupabase().from('transactions').update(patch).eq('id', t.id);
    if (error) { setMsg(error.message); setTick((n) => n + 1); }
  }
  const setCategory = (t, category) =>
    patchTx(t, category ? { category, cat_source: 'manual' } : { category: null, cat_source: null });

  async function removeTx(t) {
    if (!window.confirm(`Supprimer « ${t.label} » ?`)) return;
    const { error } = await getSupabase().from('transactions').delete().eq('id', t.id);
    if (error) return setMsg(error.message);
    setTxs((xs) => xs.filter((x) => x.id !== t.id));
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
  const set = (p) => setFlt((f) => ({ ...f, ...p }));
  const active = JSON.stringify(flt) !== JSON.stringify(EMPTY);
  const sumOf = (list, label) => (list.length === 0 ? '' : list.length === 1 ? label(list[0]) : `${list.length}`);

  const accOptions = accounts.map((a) => ({ value: a.id, label: `${a.name}${a.shared ? ' (commun)' : ''}` }));
  const catOptions = [{ value: TODO, label: 'À catégoriser' }, ...categoryList().map((c) => ({ value: c.name, label: c.name, node: <Tag name={c.name} color={c.color} /> }))];
  const accountEdit = accounts.map((a) => ({ value: a.id, label: a.name }));

  return (
    <>
      <h1>Opérations</h1>
      <div className="fbar">
        <input type="search" placeholder="Rechercher" value={q} onChange={(e) => setQ(e.target.value)} />
        <FilterMenu label="Année" summary={sumOf(flt.years, (y) => y)} active={flt.years.length > 0}>
          <Checklist options={years.map((y) => ({ value: y, label: y }))} value={flt.years} onChange={(v) => set({ years: v })} />
        </FilterMenu>
        <FilterMenu label="Mois" summary={sumOf(flt.months, (m) => MONTHS[+m - 1])} active={flt.months.length > 0}>
          <Checklist options={MONTHS.map((m, i) => ({ value: pad(i + 1), label: m }))} value={flt.months} onChange={(v) => set({ months: v })} />
        </FilterMenu>
        <FilterMenu label="Compte" summary={sumOf(flt.accounts, (id) => (accById[id] ? accById[id].name : ''))} active={flt.accounts.length > 0}>
          <Checklist options={accOptions} value={flt.accounts} onChange={(v) => set({ accounts: v })} />
        </FilterMenu>
        <FilterMenu label="Catégorie" summary={sumOf(flt.cats, (c) => (c === TODO ? 'À catégoriser' : c))} active={flt.cats.length > 0}>
          <Checklist options={catOptions} value={flt.cats} onChange={(v) => set({ cats: v })} />
        </FilterMenu>
        <FilterMenu label="Montant" summary={flt.sens === 'out' ? 'dépenses' : flt.sens === 'in' ? 'revenus' : ''} active={!!(flt.sens || flt.min || flt.max)}>
          <select value={flt.sens} onChange={(e) => set({ sens: e.target.value })} aria-label="Sens">
            <option value="">Dépenses et revenus</option>
            <option value="out">Dépenses</option>
            <option value="in">Revenus</option>
          </select>
          <input type="text" inputMode="decimal" placeholder="Min €" value={flt.min} onChange={(e) => set({ min: e.target.value })} />
          <input type="text" inputMode="decimal" placeholder="Max €" value={flt.max} onChange={(e) => set({ max: e.target.value })} />
        </FilterMenu>
        {active && <button className="btn ghost sm" onClick={() => setFlt(EMPTY)}>Tout effacer</button>}
      </div>

      {accounts.length > 0 && (editFor === 'new'
        ? <TxEditor accounts={accounts} defaults={defaultsFromFilters(flt)} onSaved={done} onCancel={() => setEditFor(null)} />
        : <button className="btn ghost" onClick={() => setEditFor('new')}>Ajouter une opération</button>)}

      {msg && <div className="warn">{msg}</div>}
      {state.error && <p className="err">{state.error}</p>}
      {state.loading ? <p className="muted">Chargement…</p> : (
        <>
          <p className="hint">
            {shown.length} opération{shown.length > 1 ? 's' : ''} · total {eur(sum, 2)}. Double-clic sur une cellule pour la modifier ; un nouvel ajout reprend les filtres actifs.
          </p>
          {shown.length === 0 ? <p className="muted">Aucune opération avec ces filtres.</p> : (
            <>
              <div className="txhead"><span>Date</span><span>Année</span><span>Libellé</span><span>Compte</span><span>Catégorie</span><span>Montant</span><span /></div>
              <ul className="list" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
                {shown.slice(0, limit).map((t) => {
                  const dm = `${t.date.slice(8, 10)}/${t.date.slice(5, 7)}`;
                  const saveDate = (nv) => { if (/^\d{4}-\d{2}-\d{2}$/.test(nv)) patchTx(t, { date: nv }); };
                  return (
                    <li key={t.id} className="txrow">
                      <Editable className="c-date muted" type="date" value={t.date} onSave={saveDate}
                        display={<>{dm}<span className="yr-inline">/{t.date.slice(0, 4)}</span></>} title="Double-clic pour modifier la date" />
                      <Editable className="c-year muted" type="date" value={t.date} onSave={saveDate} display={t.date.slice(0, 4)} title="Double-clic pour modifier la date" />
                      <Editable className="c-label" type="textarea" value={t.label} title={t.label}
                        onSave={(nv) => { if (nv.trim()) patchTx(t, { label: nv.trim() }); }} display={t.label} />
                      <Editable className="c-acct muted" type="select" options={accountEdit} value={t.account_id}
                        onSave={(nv) => patchTx(t, { account_id: nv })} display={accById[t.account_id] ? accById[t.account_id].name : ''} />
                      <span className="c-cat"><TagSelect value={t.category || ''} onChange={(c) => setCategory(t, c)} options={categoryNames()} /></span>
                      <Editable className={'c-amt amt' + (t.amount > 0 ? ' pos' : '')} type="number" value={String(t.amount)}
                        title="Double-clic pour modifier (négatif = dépense)"
                        onSave={(nv) => { const n = Number(String(nv).replace(',', '.').replace(/\s/g, '')); if (Number.isFinite(n) && n !== 0) patchTx(t, { amount: Math.round(n * 100) / 100 }); }}
                        display={eur(t.amount, 2)} />
                      <span className="c-act">
                        <button className="btn ghost sm" onClick={() => addRule(t)} title="Appliquer cette catégorie à tous les libellés similaires">Règle</button>
                        {potData && t.amount < 0 && !(accById[t.account_id] && accById[t.account_id].shared) && (
                          <button className="btn ghost sm" onClick={() => setSplitFor(splitFor === t.id ? null : t.id)} title="Payer avec un ou plusieurs pots">
                            {funded[t.id] ? `Pot ${eur(funded[t.id])}` : 'Pot'}
                          </button>
                        )}
                        <button className="btn ghost sm" onClick={() => setEditFor(editFor === t.id ? null : t.id)}>Modifier</button>
                        <button className="btn danger sm" onClick={() => removeTx(t)}>Suppr.</button>
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
                  );
                })}
              </ul>
            </>
          )}
          {shown.length > limit && <button className="btn ghost more" onClick={() => setLimit((l) => l + PAGE)}>Afficher plus</button>}
        </>
      )}
    </>
  );
}
