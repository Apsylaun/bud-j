'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getSupabase } from '../../lib/supabase.js';
import { loadAccounts, loadTransactions, loadRules, reapplyRules, updateRow } from '../../lib/data.js';
import { categoryNames, categoryList } from '../../lib/categories.js';
import { suggestPattern, norm } from '../../lib/rules.js';
import { eur } from '../../lib/format.js';
import { pushUndo, snapshotOf, onDataChange } from '../../lib/undo.js';
import { friendly } from '../../lib/errors.js';
import { TagSelect, Tag } from '../../components/Tag.js';
import { FilterMenu, Checklist } from '../../components/FilterMenu.js';
import Modal from '../../components/Modal.js';
import ImportPanel from '../../components/ImportPanel.js';
import PotSplit from '../../components/PotSplit.js';
import { loadPots, loadEntries, ownBalances, buildTree, flatNodes, fundedByTx } from '../../lib/pots.js';

const PAGE = 100;
const TODO = '__todo__';
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const pad = (n) => String(n).padStart(2, '0');
const today = () => new Date().toISOString().slice(0, 10);
const num = (s) => Number(String(s).replace(',', '.')) || 0;
const EMPTY = { years: [], months: [], accounts: [], cats: [], sens: '', min: '', max: '' };

const PlusIcon = () => <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
const UploadIcon = () => <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 11V2M4.5 5.5 8 2l3.5 3.5M2 10v3.5h12V10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const BubbleIcon = () => <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3h11a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H8l-3 2.5v-2.5H2.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="currentColor" opacity=".9" /></svg>;

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

// Fenêtre d'ajout / modification d'une opération (commentaire et règle de catégorisation inclus).
function TxModal({ tx, defaults, accounts, onClose, onSaved }) {
  const isNew = !tx;
  const d0 = defaults || {};
  const [f, setF] = useState(() => ({
    date: tx ? tx.date : d0.date || today(),
    label: tx ? tx.label : '',
    type: tx ? (tx.amount >= 0 ? 'in' : 'out') : d0.type || 'out',
    amount: tx ? String(Math.abs(tx.amount)) : '',
    account: tx ? tx.account_id : d0.account || (accounts[0] ? accounts[0].id : ''),
    category: tx ? tx.category || '' : d0.category || '',
    comment: tx ? tx.comment || '' : '',
    rule: false, pattern: '',
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
      const comment = f.comment.trim() || null;
      const undos = [];
      let label;
      if (isNew) {
        const { data, error } = await sb.from('transactions').insert({
          account_id: f.account, date: f.date, label: f.label.trim(), amount, category: cat, comment,
          cat_source: cat ? 'manual' : null, hash: `manual:${crypto.randomUUID()}`,
        }).select('id').single();
        if (error) throw error;
        undos.push(async () => { const r = await getSupabase().from('transactions').delete().eq('id', data.id); if (r.error) throw r.error; });
        label = 'Ajout d’opération';
      } else {
        const patch = { account_id: f.account, date: f.date, label: f.label.trim(), amount, category: cat, comment };
        if (cat !== (tx.category || null)) patch.cat_source = cat ? 'manual' : null;
        const before = snapshotOf(tx, patch);
        const { error } = await sb.from('transactions').update(patch).eq('id', tx.id);
        if (error) throw error;
        undos.push(() => updateRow('transactions', tx.id, before));
        label = 'Modification d’opération';
      }
      if (f.rule && cat && f.pattern.trim()) {
        const r = await sb.from('rules').insert({ pattern: f.pattern.trim().toLowerCase(), category: cat }).select('id').single();
        if (r.error) throw r.error;
        await reapplyRules(await loadRules());
        undos.push(async () => {
          const d = await getSupabase().from('rules').delete().eq('id', r.data.id);
          if (d.error) throw d.error;
          await reapplyRules(await loadRules());
        });
      }
      pushUndo(label, async () => { for (const u of undos.reverse()) await u(); });
      onSaved();
    } catch (e2) { setErr(friendly(e2)); setBusy(false); }
  }

  async function remove() {
    onSaved('delete');
  }

  return (
    <Modal title={isNew ? 'Nouvelle opération' : 'Modifier l’opération'} onClose={onClose}>
      <form className="formgrid flat" onSubmit={save}>
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
        <textarea placeholder="Commentaire (facultatif)" value={f.comment} onChange={(e) => set({ comment: e.target.value })} />
        {f.category && (
          <div className="rulebox">
            <label className="check">
              <input type="checkbox" checked={f.rule}
                onChange={(e) => set({ rule: e.target.checked, pattern: f.pattern || suggestPattern(f.label) })} />
              Appliquer « {f.category} » à tous les libellés contenant un mot-clé
            </label>
            {f.rule && (
              <>
                <input type="text" placeholder="Mot-clé (sans accents ni date)" value={f.pattern} onChange={(e) => set({ pattern: e.target.value })} />
                <span className="hint" style={{ margin: 0 }}>La règle s’applique aux opérations existantes (hors choix manuels) et aux prochains imports.</span>
              </>
            )}
          </div>
        )}
        {err && <p className="err">{err}</p>}
        <div className="form">
          <button className="btn" disabled={busy}>{isNew ? 'Ajouter' : 'Enregistrer'}</button>
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
          {!isNew && <button type="button" className="btn danger" onClick={remove}>Suppr.</button>}
        </div>
      </form>
    </Modal>
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
  const [noteFor, setNoteFor] = useState(null);
  const [modal, setModal] = useState(null); // 'new' | transaction | null
  const [importing, setImporting] = useState(false);
  const [state, setState] = useState({ loading: true, error: null });

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('todo') === '1') setFlt({ ...EMPTY, cats: [TODO] });
  }, []);
  useEffect(() => onDataChange(() => setTick((n) => n + 1)), []);

  useEffect(() => {
    let off = false;
    setState({ loading: true, error: null });
    Promise.all([
      loadAccounts(),
      loadTransactions({ select: 'id,account_id,date,label,amount,category,cat_source,comment,hash' }),
      Promise.all([loadPots(), loadEntries()]).catch(() => null),
    ])
      .then(([a, t, p]) => { if (!off) { setAccounts(a); setTxs(t); setPotData(p && p[0].length ? { pots: p[0], entries: p[1] } : null); setState({ loading: false, error: null }); } })
      .catch((e) => { if (!off) setState({ loading: false, error: friendly(e) }); });
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
      return !nq || norm(t.label).includes(nq) || norm(t.comment || '').includes(nq);
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

  async function patchTx(t, patch, label = 'Modification d’opération') {
    const before = snapshotOf(t, patch);
    setTxs((xs) => xs.map((x) => (x.id === t.id ? { ...x, ...patch } : x)));
    const { error } = await getSupabase().from('transactions').update(patch).eq('id', t.id);
    if (error) { setMsg(friendly(error)); setTick((n) => n + 1); return; }
    pushUndo(label, () => updateRow('transactions', t.id, before));
  }
  const setCategory = (t, category) =>
    patchTx(t, category ? { category, cat_source: 'manual' } : { category: null, cat_source: null }, 'Changement de catégorie');

  async function removeTx(t) {
    if (!window.confirm(`Supprimer « ${t.label} » ?`)) return;
    const entries = potData ? potData.entries.filter((e) => e.transaction_id === t.id) : [];
    const { error } = await getSupabase().from('transactions').delete().eq('id', t.id);
    if (error) return setMsg(friendly(error));
    setTxs((xs) => xs.filter((x) => x.id !== t.id));
    pushUndo('Suppression d’opération', async () => {
      const sb = getSupabase();
      const r = await sb.from('transactions').insert(t);
      if (r.error) throw r.error;
      if (entries.length) {
        const r2 = await sb.from('pot_entries').insert(entries);
        if (r2.error) throw r2.error;
      }
    });
  }

  const set = (p) => setFlt((f) => ({ ...f, ...p }));
  const active = JSON.stringify(flt) !== JSON.stringify(EMPTY);
  const sumOf = (list, label) => (list.length === 0 ? '' : list.length === 1 ? label(list[0]) : `${list.length}`);

  const accOptions = accounts.map((a) => ({ value: a.id, label: `${a.name}${a.shared ? ' (commun)' : ''}` }));
  const catOptions = [{ value: TODO, label: 'À catégoriser' }, ...categoryList().map((c) => ({ value: c.name, label: c.name, node: <Tag name={c.name} color={c.color} /> }))];
  const accountEdit = accounts.map((a) => ({ value: a.id, label: a.name }));

  const onModalSaved = (what) => {
    const t = modal;
    setModal(null);
    if (what === 'delete' && t && t !== 'new') removeTx(t);
    else setTick((n) => n + 1);
  };

  return (
    <>
      <h1>Opérations</h1>
      <div className="actionbar">
        {accounts.length > 0 && <button className="btn cta" onClick={() => setModal('new')}><PlusIcon />Ajouter une opération</button>}
        {accounts.length > 0 && <button className="btn ghost" onClick={() => setImporting(true)}><UploadIcon />Importer</button>}
      </div>
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

      {msg && <div className="warn">{msg}</div>}
      {state.error && <p className="err">{state.error}</p>}
      {!state.loading && !state.error && accounts.length === 0 && <div className="warn">Aucun compte : crée-en un dans Réglages pour ajouter ou importer des opérations.</div>}
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
                      <span className="c-label">
                        <Editable className="lbl" type="textarea" value={t.label} title={t.label}
                          onSave={(nv) => { if (nv.trim()) patchTx(t, { label: nv.trim() }); }} display={t.label} />
                        {t.comment && <button className="bubble" onClick={() => setNoteFor(noteFor === t.id ? null : t.id)} aria-label="Voir le commentaire" title="Commentaire"><BubbleIcon /></button>}
                      </span>
                      <Editable className="c-acct muted" type="select" options={accountEdit} value={t.account_id}
                        onSave={(nv) => patchTx(t, { account_id: nv })} display={accById[t.account_id] ? accById[t.account_id].name : ''} />
                      <span className="c-cat"><TagSelect value={t.category || ''} onChange={(c) => setCategory(t, c)} options={categoryNames()} /></span>
                      <Editable className={'c-amt amt' + (t.amount > 0 ? ' pos' : '')} type="number" value={String(t.amount)}
                        title="Double-clic pour modifier (négatif = dépense)"
                        onSave={(nv) => { const n = Number(String(nv).replace(',', '.').replace(/\s/g, '')); if (Number.isFinite(n) && n !== 0) patchTx(t, { amount: Math.round(n * 100) / 100 }); }}
                        display={eur(t.amount, 2)} />
                      <span className="c-act">
                        {potData && t.amount < 0 && !(accById[t.account_id] && accById[t.account_id].shared) && (
                          <button className="btn ghost sm" onClick={() => setSplitFor(splitFor === t.id ? null : t.id)} title="Payer avec un ou plusieurs pots">
                            {funded[t.id] ? `Pot ${eur(funded[t.id])}` : 'Pot'}
                          </button>
                        )}
                        <button className="btn ghost sm" onClick={() => setModal(t)}>Modifier</button>
                        <button className="btn danger sm" onClick={() => removeTx(t)}>Suppr.</button>
                      </span>
                      {noteFor === t.id && t.comment && (
                        <div className="c-edit"><div className="note"><span>{t.comment}</span><button className="btn ghost sm" onClick={() => setModal(t)}>Modifier</button></div></div>
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

      {modal && (
        <TxModal tx={modal === 'new' ? null : modal} defaults={modal === 'new' ? defaultsFromFilters(flt) : null}
          accounts={accounts} onClose={() => setModal(null)} onSaved={onModalSaved} />
      )}
      {importing && (
        <ImportPanel accounts={accounts} onClose={() => setImporting(false)}
          onDone={(m) => { setImporting(false); setMsg(m); setFlt(EMPTY); setTick((n) => n + 1); }} />
      )}
    </>
  );
}
