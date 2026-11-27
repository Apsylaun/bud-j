'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '../../lib/supabase.js';
import { loadAccounts, loadBalances, updateRow } from '../../lib/data.js';
import {
  TYPES, CLASSES, TYPE_CLASS, RANGES, KINDS, loadAssets, loadValues, groupValues, latest, wealthSeries,
  breakdown, gainOf, portfolioGain, project, r2, fmtPct, guessType, enrichAssets, valueAt, monthAgoDate,
} from '../../lib/wealth.js';
import { KIND_PLURAL, guessEnvelope } from '../../lib/accounts.js';
import { readPositionsFile } from '../../lib/positions.js';
import { pushUndo, snapshotOf, onDataChange } from '../../lib/undo.js';
import { friendly } from '../../lib/errors.js';
import { eur, dateFr } from '../../lib/format.js';
import { colorOf, paletteColor } from '../../lib/categories.js';
import { Seg } from '../../components/Filters.js';
import { FilterMenu, Checklist } from '../../components/FilterMenu.js';
import Modal from '../../components/Modal.js';
import Term from '../../components/Term.js';
import VarTag from '../../components/VarTag.js';
import { Donut, WealthChart, TrendLines } from '../../components/Charts.js';

const TABS = [['vue', 'Patrimoine'], ['maj', 'Mise à jour'], ['simu', 'Simulateur']];
const num = (s) => Number(String(s).replace(',', '.')) || 0;
const today = () => new Date().toISOString().slice(0, 10);
const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const sgn = (n) => (n >= 0 ? '+' : '') + eur(n);

export default function Patrimoine() {
  const [tab, setTab] = useState('vue');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  const reload = useCallback(async () => {
    try {
      const [assets, values, accounts, balances] = await Promise.all([loadAssets(), loadValues(), loadAccounts(), loadBalances()]);
      setD({ assets: enrichAssets(assets, accounts), values, accounts, balances }); setErr('');
    } catch (e) {
      setErr(/relation|does not exist/i.test(e.message || '') && /assets|asset_values/.test(e.message || '') ? 'Tables absentes : exécute supabase/003_placements.sql dans Supabase.' : friendly(e));
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => onDataChange(reload), [reload]);

  const g = useMemo(() => (d ? groupValues(d.values) : {}), [d]);
  const lat = useMemo(() => latest(g), [g]);

  if (err) return <><h1>Patrimoine</h1><p className="err">{err}</p></>;
  if (!d) return <><h1>Patrimoine</h1><p className="muted">Chargement…</p></>;
  return (
    <>
      <h1>Patrimoine</h1>
      <Seg value={tab} onChange={setTab} options={TABS} />
      <div style={{ marginTop: 16 }}>
        {tab === 'vue' && <VueTab d={d} g={g} lat={lat} reload={reload} />}
        {tab === 'maj' && <MajTab d={d} lat={lat} reload={reload} />}
        {tab === 'simu' && <SimuTab d={d} lat={lat} />}
      </div>
    </>
  );
}

function VueTab({ d, g, lat, reload }) {
  const [range, setRange] = useState('ALL');
  const [by, setBy] = useState('asset');
  const [flt, setFlt] = useState({ kinds: [], banks: [], envs: [], classes: [] });
  const [group, setGroup] = useState(true);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ key: 'value', dir: 'desc' });
  const [closed, setClosed] = useState({});
  const [modal, setModal] = useState(null);
  const [msg, setMsg] = useState('');
  const { assets } = d;
  const ago = monthAgoDate(today());

  const total = r2(assets.reduce((s, a) => s + (lat[a.id] ? lat[a.id].value : 0), 0));
  const series = useMemo(() => wealthSeries(assets, g, range), [assets, g, range]);
  const first = series[0], last = series[series.length - 1];
  const diff = series.length > 1 ? r2(last.total - first.total) : 0;
  const dpct = series.length > 1 && first.total ? (diff / first.total) * 100 : null;

  const slices = useMemo(
    () => breakdown(assets, lat, by).map((r, i) => ({ ...r, color: by === 'class' ? colorOf(r.name) : paletteColor(i) })),
    [assets, lat, by]
  );

  const rows = useMemo(() => assets.map((a) => {
    const v = lat[a.id] ? lat[a.id].value : 0;
    const prev = valueAt(g[a.id], ago);
    return { a, v, pct: total ? (v / total) * 100 : 0, gain: gainOf(a, v), prev, var1: prev !== null && prev > 0 ? { abs: r2(v - prev), pct: ((v - prev) / prev) * 100 } : null };
  }), [assets, lat, g, ago, total]);

  const shown = useMemo(() => {
    const nq = q.trim().toLowerCase();
    const f = rows.filter(({ a }) =>
      (!flt.kinds.length || flt.kinds.includes(a.kind)) && (!flt.banks.length || flt.banks.includes(a.bank || 'Sans banque')) &&
      (!flt.envs.length || flt.envs.includes(a.envelope)) && (!flt.classes.length || flt.classes.includes(a.asset_class)) &&
      (!nq || `${a.name} ${a.accountName} ${a.envelope} ${a.bank}`.toLowerCase().includes(nq)));
    const val = { name: (r) => r.a.name.toLowerCase(), value: (r) => r.v, gain: (r) => (r.gain ? r.gain.abs : -Infinity), var: (r) => (r.var1 ? r.var1.abs : -Infinity) }[sort.key];
    return f.sort((x, y) => {
      const a = val(x), b = val(y);
      const c = typeof a === 'string' ? a.localeCompare(b) : a - b;
      return sort.dir === 'asc' ? c : -c;
    });
  }, [rows, flt, q, sort]);

  const sumRows = (list) => {
    const v = list.reduce((s, r) => s + r.v, 0);
    const gain = portfolioGain(list.map((r) => r.a), Object.fromEntries(list.map((r) => [r.a.id, { value: r.v }])));
    const withPrev = list.filter((r) => r.prev !== null && r.prev > 0);
    const pBase = withPrev.reduce((s, r) => s + r.prev, 0);
    const pDiff = withPrev.reduce((s, r) => s + (r.v - r.prev), 0);
    return { v, gain, var1: pBase > 0 ? { abs: r2(pDiff), pct: (pDiff / pBase) * 100 } : null };
  };

  const kinds = group ? KINDS.map((k) => ({ k, items: shown.filter((r) => r.a.kind === k) })).filter((x) => x.items.length) : [];
  const banks = [...new Set(assets.map((a) => a.bank || 'Sans banque'))].sort();
  const envs = [...new Set(assets.map((a) => a.envelope))].sort();
  const sumOf = (list) => (list.length === 0 ? '' : list.length === 1 ? list[0] : `${list.length}`);
  const setF = (p) => setFlt((f) => ({ ...f, ...p }));
  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));
  const arrow = (key) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ↕');

  const legacy = assets.filter((a) => !a.account_id);
  async function autoLink() {
    setMsg('');
    try {
      const sb = getSupabase();
      const by2 = new Map();
      for (const a of legacy) {
        const key = `${a.holder || 'Compte sans nom'}|${a.account_kind || 'Investissement'}`;
        if (!by2.has(key)) by2.set(key, []);
        by2.get(key).push(a.id);
      }
      for (const [key, ids] of by2) {
        const [holder, kind] = key.split('|');
        const r = await sb.from('accounts').insert({ name: holder, bank: 'À préciser', envelope: guessEnvelope(holder, kind), account_kind: kind, shared: false }).select('id').single();
        if (r.error) throw r.error;
        const u = await sb.from('assets').update({ account_id: r.data.id }).in('id', ids);
        if (u.error) throw u.error;
      }
      setMsg(`${by2.size} compte(s) créé(s). Précise leur banque et leur enveloppe dans Réglages › Comptes.`);
      reload();
    } catch (e) { setMsg(friendly(e)); }
  }

  async function delAsset(a) {
    if (!window.confirm(`Supprimer « ${a.name} » et tout son historique ? Cette action est définitive.`)) return;
    const { error } = await getSupabase().from('assets').delete().eq('id', a.id);
    if (error) return setMsg(friendly(error));
    reload();
  }

  const renderRow = (r) => (
    <div className="arow" key={r.a.id}>
      <span className="a-name">
        <span className="avatar" style={{ '--c': colorOf(r.a.asset_class) }}>{initials(r.a.name)}</span>
        <span className="nm" title={r.a.name}>{r.a.name}</span>
      </span>
      <span className="a-acct">{r.a.accountName} · {r.a.envelope}</span>
      <span className="a-pct">{r.pct.toFixed(2).replace('.', ',')} %</span>
      <span className="a-val">{eur(r.v)}</span>
      <span className="a-gain">
        {r.gain ? <><span className={r.gain.abs < 0 ? 'neg' : 'pos'}>{sgn(r.gain.abs)}</span><VarTag pct={r.gain.pct} /></> : <span className="muted">–</span>}
      </span>
      <span className="a-var">{r.var1 ? <VarTag pct={r.var1.pct} /> : <span className="muted">–</span>}</span>
      <span className="a-menu">
        <FilterMenu className="rowmenu" align="right" label="⋯">
          <button className="btn ghost sm" onClick={() => setModal({ type: 'hist', asset: r.a })}>Historique</button>
          <button className="btn ghost sm" onClick={() => setModal({ type: 'asset', asset: r.a })}>Modifier</button>
          <button className="btn danger sm" onClick={() => delAsset(r.a)}>Suppr.</button>
        </FilterMenu>
      </span>
    </div>
  );

  if (!assets.length) {
    return (
      <>
        {msg && <div className="warn">{msg}</div>}
        <p>Aucun actif pour le moment. Crée d’abord un compte dans Réglages (banque, enveloppe), puis ajoute tes actifs.</p>
        <div className="form">
          <button className="btn" onClick={() => setModal({ type: 'asset', asset: null })}>+ Ajouter un actif</button>
          <button className="btn ghost" onClick={() => setModal({ type: 'import' })}>Importer un portefeuille</button>
        </div>
        {modal && <Modals modal={modal} d={d} g={g} lat={lat} close={() => setModal(null)} done={(m) => { setModal(null); if (typeof m === 'string') setMsg(m); reload(); }} />}
      </>
    );
  }

  return (
    <>
      {msg && <div className="warn">{msg}</div>}
      {legacy.length > 0 && (
        <div className="warn">
          {legacy.length} actif{legacy.length > 1 ? 's' : ''} sans compte lié (ancien format). <button className="btn ghost sm" onClick={autoLink}>Créer les comptes à partir des enveloppes</button>
        </div>
      )}

      <div className="patgrid">
        <div className="card">
          <div className="bigtotal">{eur(total)}</div>
          <div className="vline">
            <span className={diff < 0 ? 'neg' : 'pos'}>{sgn(diff)}</span>
            <VarTag pct={dpct} />
            <span className="muted">{range === 'ALL' ? 'Variation depuis le début' : 'Variation sur la période'}</span>
          </div>
          <div style={{ marginTop: 10 }}><WealthChart data={series} long={['ALL', '1A', 'YTD', '6M'].includes(range)} /></div>
          <Seg value={range} onChange={setRange} options={RANGES} />
        </div>
        <div className="card">
          <div className="cardhead">
            <b>Actifs</b>
            <select value={by} onChange={(e) => setBy(e.target.value)} aria-label="Répartition par">
              <option value="asset">Par actif</option>
              <option value="account">Par compte</option>
              <option value="bank">Par banque</option>
              <option value="holder">Par enveloppe</option>
              <option value="kind">Par type de compte</option>
              <option value="class">Par classe d’actifs</option>
              <option value="type">Par type d’actif</option>
            </select>
          </div>
          <Donut data={slices} total={total} />
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, padding: 0 }}>
        <div style={{ padding: '16px 16px 0' }}>
          <div className="cardhead">
            <b>Mes actifs</b>
            <span className="form">
              <button className="btn" onClick={() => setModal({ type: 'asset', asset: null })}>+ Ajouter</button>
              <button className="btn ghost" onClick={() => setModal({ type: 'import' })}>Importer</button>
            </span>
          </div>
          <div className="toolbar">
            <FilterMenu className="dash" label="+ Type de compte" summary={sumOf(flt.kinds)} active={flt.kinds.length > 0}>
              <Checklist options={KINDS.map((k) => ({ value: k, label: k }))} value={flt.kinds} onChange={(v) => setF({ kinds: v })} />
            </FilterMenu>
            <FilterMenu className="dash" label="+ Banque" summary={sumOf(flt.banks)} active={flt.banks.length > 0}>
              <Checklist options={banks.map((b) => ({ value: b, label: b }))} value={flt.banks} onChange={(v) => setF({ banks: v })} />
            </FilterMenu>
            <FilterMenu className="dash" label="+ Enveloppe" summary={sumOf(flt.envs)} active={flt.envs.length > 0}>
              <Checklist options={envs.map((e) => ({ value: e, label: e }))} value={flt.envs} onChange={(v) => setF({ envs: v })} />
            </FilterMenu>
            <FilterMenu className="dash" label="+ Classe" summary={sumOf(flt.classes)} active={flt.classes.length > 0}>
              <Checklist options={CLASSES.map((c) => ({ value: c, label: c }))} value={flt.classes} onChange={(v) => setF({ classes: v })} />
            </FilterMenu>
            <span className="grow" />
            <span className="switchrow">Grouper par type de compte
              <button className={'switch' + (group ? ' on' : '')} role="switch" aria-checked={group} aria-label="Grouper par type de compte" onClick={() => setGroup((x) => !x)} />
            </span>
            <input type="search" placeholder="Rechercher" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        <div className="atable" style={{ border: 0, borderRadius: 0 }}>
          <div className="ahead">
            <span><button className="sortbtn" onClick={() => toggleSort('name')}>Nom{arrow('name')}</button></span>
            <span>Compte</span>
            <span><Term k="repartition">Répartition</Term></span>
            <span><button className="sortbtn" onClick={() => toggleSort('value')}>Valeur{arrow('value')}</button></span>
            <span><button className="sortbtn" onClick={() => toggleSort('gain')}><Term k="plusvalue" right>+/- value</Term>{arrow('gain')}</button></span>
            <span><button className="sortbtn" onClick={() => toggleSort('var')}><Term k="variation" right>Var. M-1</Term>{arrow('var')}</button></span>
            <span />
          </div>
          {shown.length === 0 && <p className="muted" style={{ padding: 16, margin: 0 }}>Aucun actif avec ces filtres.</p>}
          {group
            ? kinds.map(({ k, items }) => {
              const t = sumRows(items);
              return (
                <div key={k}>
                  <button className="agroup" onClick={() => setClosed((c) => ({ ...c, [k]: !c[k] }))}>
                    <span className="a-name"><span className={'chev' + (closed[k] ? '' : ' open')}>›</span><span className="nm">{KIND_PLURAL[k]}</span><span className="count">{items.length} actif{items.length > 1 ? 's' : ''}</span></span>
                    <span className="a-acct" />
                    <span className="a-pct">{total ? ((t.v / total) * 100).toFixed(2).replace('.', ',') : '0'} %</span>
                    <span className="a-val">{eur(t.v)}</span>
                    <span className="a-gain">{t.gain ? <><span className={t.gain.abs < 0 ? 'neg' : 'pos'}>{sgn(t.gain.abs)}</span><VarTag pct={t.gain.pct} /></> : null}</span>
                    <span className="a-var">{t.var1 ? <VarTag pct={t.var1.pct} /> : null}</span>
                    <span className="a-menu" />
                  </button>
                  {!closed[k] && items.map(renderRow)}
                </div>
              );
            })
            : shown.map(renderRow)}
        </div>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        <Term k="plusvalue">+/- value</Term> = valeur − montant investi (renseigné à l’ajout de l’actif). Entre deux relevés, la dernière valeur connue est reportée.
      </p>

      {modal && <Modals modal={modal} d={d} g={g} lat={lat} close={() => setModal(null)} done={(m) => { setModal(null); if (typeof m === 'string') setMsg(m); reload(); }} />}
    </>
  );
}

function Modals({ modal, d, g, lat, close, done }) {
  const perso = d.accounts.filter((a) => !a.shared);
  if (modal.type === 'asset') return <AssetModal asset={modal.asset} accounts={perso} onClose={close} onSaved={done} />;
  if (modal.type === 'hist') return <HistoryModal asset={modal.asset} g={g} onClose={close} onChange={() => done()} />;
  return <ImportModal accounts={perso} assets={d.assets} lat={lat} onClose={close} onDone={done} />;
}

function AssetModal({ asset, accounts, onClose, onSaved }) {
  const a = asset || {};
  const [f, setF] = useState({
    name: a.name || '', type: a.asset_type || 'ETF', cls: a.asset_class || 'Actions',
    account: a.account_id || (asset ? '' : (accounts[0] ? accounts[0].id : '')),
    isin: a.isin || '', ticker: a.ticker || '',
    qty: a.quantity != null ? String(a.quantity) : '', pru: '', invested: a.invested != null ? String(a.invested) : '',
    value: '', date: today(),
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const acc = accounts.find((x) => x.id === f.account);

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      if (!acc && !asset) throw new Error('Choisis un compte (à créer dans Réglages › Comptes si besoin).');
      const sb = getSupabase();
      const invested = f.invested !== '' ? num(f.invested) : f.qty !== '' && f.pru !== '' ? r2(num(f.qty) * num(f.pru)) : null;
      const row = {
        name: f.name.trim(), asset_type: f.type, asset_class: f.cls,
        account_id: acc ? acc.id : null,
        holder: acc ? acc.envelope : (asset ? asset.holder : null),
        account_kind: acc ? acc.account_kind : (asset ? asset.account_kind : 'Investissement'),
        isin: f.isin.trim() || null, ticker: f.ticker.trim() || null, quantity: f.qty !== '' ? num(f.qty) : null, invested,
      };
      if (asset) {
        const before = snapshotOf(asset, row);
        const { error } = await sb.from('assets').update(row).eq('id', asset.id);
        if (error) throw error;
        pushUndo(`Modification de « ${asset.name} »`, () => updateRow('assets', asset.id, before));
      } else {
        const { data, error } = await sb.from('assets').insert(row).select('id').single();
        if (error) throw error;
        if (f.value !== '') {
          const r = await sb.from('asset_values').insert({ asset_id: data.id, date: f.date, value: num(f.value) });
          if (r.error) throw r.error;
        }
        pushUndo('Ajout d’actif', async () => { const x = await getSupabase().from('assets').delete().eq('id', data.id); if (x.error) throw x.error; });
      }
      onSaved();
    } catch (e2) { setErr(friendly(e2)); setBusy(false); }
  }

  return (
    <Modal title={asset ? 'Modifier l’actif' : 'Nouvel actif'} onClose={onClose}>
      <form className="formgrid flat" onSubmit={submit}>
        <label className="fld"><span>Compte</span>
          <select value={f.account} onChange={(e) => set({ account: e.target.value })} required={!asset}>
            {asset && <option value="">Aucun compte lié</option>}
            {accounts.map((x) => <option key={x.id} value={x.id}>{x.name} — {x.bank}</option>)}
          </select>
        </label>
        {accounts.length === 0 && <p className="hint" style={{ margin: 0 }}>Aucun compte : crée-en un dans Réglages › Comptes (nom, banque, type d’enveloppe).</p>}
        {acc && (
          <p className="hint" style={{ margin: 0 }}>
            <Term k="banque">Banque</Term> : {acc.bank} · <Term k="enveloppe">Enveloppe</Term> : {acc.envelope || '–'} · <Term k="typecompte">Type de compte</Term> : {acc.account_kind}. Hérités du compte.
          </p>
        )}
        <label className="fld"><span>Nom de l’actif</span><input type="text" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="ex : ETF MSCI World" required /></label>
        <div className="form">
          <label className="fld"><span>Type d’actif</span>
            <select value={f.type} onChange={(e) => set({ type: e.target.value, cls: TYPE_CLASS[e.target.value] })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          </label>
          <label className="fld"><span><Term k="classe">Classe</Term></span>
            <select value={f.cls} onChange={(e) => set({ cls: e.target.value })}>{CLASSES.map((c) => <option key={c}>{c}</option>)}</select>
          </label>
        </div>
        {!asset && (
          <div className="form">
            <label className="fld"><span>Valeur actuelle (€)</span><input type="text" inputMode="decimal" className="num" value={f.value} onChange={(e) => set({ value: e.target.value })} /></label>
            <label className="fld"><span>À la date du</span><input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} /></label>
          </div>
        )}
        <div className="form">
          <label className="fld"><span>Quantité</span><input type="text" inputMode="decimal" className="num" value={f.qty} onChange={(e) => set({ qty: e.target.value })} /></label>
          <label className="fld"><span><Term k="pru">PRU</Term> (€)</span><input type="text" inputMode="decimal" className="num" value={f.pru} onChange={(e) => set({ pru: e.target.value })} /></label>
          <label className="fld"><span><Term k="investi">Investi</Term> (€)</span><input type="text" inputMode="decimal" className="num" value={f.invested} onChange={(e) => set({ invested: e.target.value })} /></label>
        </div>
        <p className="hint" style={{ margin: 0 }}>« Investi » vide : calculé avec quantité × PRU. Il sert à la <Term k="plusvalue">+/- value</Term>.</p>
        <details>
          <summary>Cours automatiques (plus tard)</summary>
          <div className="form" style={{ marginTop: 8 }}>
            <label className="fld"><span><Term k="isin">ISIN</Term></span><input type="text" value={f.isin} onChange={(e) => set({ isin: e.target.value })} /></label>
            <label className="fld"><span>Ticker</span><input type="text" value={f.ticker} onChange={(e) => set({ ticker: e.target.value })} /></label>
          </div>
        </details>
        {err && <p className="err">{err}</p>}
        <div className="form">
          <button className="btn" disabled={busy}>{asset ? 'Enregistrer' : 'Ajouter l’actif'}</button>
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
        </div>
      </form>
    </Modal>
  );
}

function HistoryModal({ asset, g, onClose, onChange }) {
  const [msg, setMsg] = useState('');
  const hist = [...(g[asset.id] || [])].reverse();
  async function delValue(v) {
    const { error } = await getSupabase().from('asset_values').delete().eq('id', v.id);
    if (error) return setMsg(friendly(error));
    pushUndo('Suppression de relevé', async () => {
      const r = await getSupabase().from('asset_values').insert({ id: v.id, asset_id: asset.id, date: v.date, value: v.value });
      if (r.error) throw r.error;
    });
    onChange();
  }
  return (
    <Modal title={`Historique · ${asset.name}`} onClose={onClose}>
      {msg && <p className="err">{msg}</p>}
      {hist.length === 0 && <p className="muted">Aucune valeur saisie.</p>}
      {hist.map((h, i) => {
        const prev = hist[i + 1];
        return (
          <div className="item" key={h.id}>
            <span>{dateFr(h.date)} <span className="muted">{prev && prev.value ? fmtPct(((h.value - prev.value) / prev.value) * 100) : ''}</span></span>
            <span className="form"><span className="amt">{eur(h.value, 2)}</span><button className="btn danger sm" onClick={() => delValue(h)}>Suppr.</button></span>
          </div>
        );
      })}
    </Modal>
  );
}

// Regroupe les lignes d'un même ISIN (quantités, valeurs et montants investis additionnés).
function mergeByIsin(list) {
  const m = new Map();
  for (const p of list) {
    const x = m.get(p.isin);
    if (!x) { m.set(p.isin, { ...p }); continue; }
    x.quantity += p.quantity; x.value = r2(x.value + p.value);
    x.invested = x.invested != null && p.invested != null ? r2(x.invested + p.invested) : null;
    x.price = p.price ?? x.price;
  }
  return [...m.values()];
}

function ImportModal({ accounts, assets, lat, onClose, onDone }) {
  const [accountId, setAccountId] = useState(accounts[0] ? accounts[0].id : '');
  const [date, setDate] = useState(today());
  const [closeMissing, setCloseMissing] = useState(true);
  const [pos, setPos] = useState(null);
  const [fileName, setFileName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const acc = accounts.find((x) => x.id === accountId);

  async function onFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setErr(''); setPos(null); setFileName(f.name);
    try { setPos(mergeByIsin(await readPositionsFile(f))); } catch (x) { setErr(x.message); }
  }

  const inAcc = assets.filter((a) => a.account_id === accountId);
  const plan = useMemo(
    () => (pos ? pos.map((p) => ({ ...p, existing: inAcc.find((a) => a.isin === p.isin) || null })) : []),
    [pos, assets, accountId] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const absent = pos ? inAcc.filter((a) => a.isin && !pos.some((p) => p.isin === a.isin) && lat[a.id] && lat[a.id].value > 0) : [];
  const total = r2(plan.reduce((s, p) => s + p.value, 0));

  async function run() {
    setBusy(true); setErr('');
    try {
      const sb = getSupabase();
      const toCreate = plan.filter((p) => !p.existing);
      let created = [];
      if (toCreate.length) {
        const rows = toCreate.map((p) => {
          const type = guessType(p.name);
          return { name: p.name, asset_type: type, asset_class: TYPE_CLASS[type], account_id: acc.id, holder: acc.envelope, account_kind: acc.account_kind, isin: p.isin, quantity: p.quantity, invested: p.invested };
        });
        const r = await sb.from('assets').insert(rows).select('id,isin');
        if (r.error) throw r.error;
        created = r.data;
      }
      for (const p of plan.filter((x) => x.existing)) {
        const r = await sb.from('assets').update({ quantity: p.quantity, invested: p.invested }).eq('id', p.existing.id);
        if (r.error) throw r.error;
      }
      const values = plan.map((p) => ({
        asset_id: p.existing ? p.existing.id : created.find((c) => c.isin === p.isin).id,
        date, value: p.value, price: p.price, source: 'manual',
      }));
      if (closeMissing) for (const a of absent) values.push({ asset_id: a.id, date, value: 0, source: 'manual' });
      const r = await sb.from('asset_values').upsert(values, { onConflict: 'asset_id,date' });
      if (r.error) throw r.error;
      onDone(`${plan.length} position(s) importée(s) dans « ${acc.name} » (${toCreate.length} nouvelle(s))${closeMissing && absent.length ? `, ${absent.length} soldée(s)` : ''}.`);
    } catch (e) { setErr(friendly(e)); setBusy(false); }
  }

  return (
    <Modal title="Importer un portefeuille" onClose={onClose}>
      <div className="formgrid flat">
        <label className="fld"><span>Compte de destination</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((x) => <option key={x.id} value={x.id}>{x.name} — {x.bank}</option>)}
          </select>
        </label>
        {accounts.length === 0 && <p className="hint" style={{ margin: 0 }}>Crée d’abord un compte (ex. « PEA », enveloppe PEA) dans Réglages › Comptes.</p>}
        <label className="fld"><span>Date de valorisation</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <input type="file" accept=".xlsx,.csv" onChange={onFile} disabled={!acc} />
        <p className="hint" style={{ margin: 0 }}>Export Bourse Direct (.xlsx ou .csv : Nom, <Term k="isin">ISIN</Term>, Quantité, <Term k="pru">PRU</Term>, Valorisation). Les lignes déjà présentes (même ISIN, même compte) sont mises à jour.</p>
        {err && <p className="err">{err}</p>}
        {pos && (
          <>
            <p className="muted" style={{ margin: 0 }}>{fileName} : {plan.length} position(s), valorisation {eur(total, 2)}.</p>
            <div className="scroll-x">
              <table className="prev"><tbody>
                {plan.slice(0, 40).map((p) => (
                  <tr key={p.isin}>
                    <td>{p.name}<br /><span className="muted">{p.isin} · {p.existing ? 'mise à jour' : 'nouveau'}</span></td>
                    <td>{p.quantity} × {p.price != null ? eur(p.price, 2) : '–'}</td>
                    <td>{eur(p.value, 2)}</td>
                  </tr>
                ))}
              </tbody></table>
            </div>
            {absent.length > 0 && (
              <label className="check">
                <input type="checkbox" checked={closeMissing} onChange={(e) => setCloseMissing(e.target.checked)} />
                Solder les {absent.length} ligne(s) absente(s) du fichier : {absent.map((a) => a.name).join(', ')}
              </label>
            )}
          </>
        )}
        <div className="form">
          <button className="btn" disabled={busy || !pos || !acc} onClick={run}>{busy ? 'Import…' : 'Importer'}</button>
          <button className="btn ghost" onClick={onClose}>Annuler</button>
        </div>
      </div>
    </Modal>
  );
}

function MajTab({ d, lat, reload }) {
  const [date, setDate] = useState(today());
  const [vals, setVals] = useState({});
  const [inv, setInv] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true); setMsg('');
    try {
      const sb = getSupabase();
      const rows = d.assets.filter((a) => (vals[a.id] ?? '') !== '').map((a) => ({ asset_id: a.id, date, value: num(vals[a.id]) }));
      if (rows.length) {
        const { error } = await sb.from('asset_values').upsert(rows, { onConflict: 'asset_id,date' });
        if (error) throw error;
      }
      for (const a of d.assets) {
        if ((inv[a.id] ?? '') === '') continue;
        const { error } = await sb.from('assets').update({ invested: num(inv[a.id]) }).eq('id', a.id);
        if (error) throw error;
      }
      const prevInv = d.assets.filter((a) => (inv[a.id] ?? '') !== '').map((a) => [a.id, a.invested]);
      const prevVals = rows.map((r) => ({ r, old: d.values.find((v) => v.asset_id === r.asset_id && v.date === date) }));
      pushUndo(`Relevé du ${dateFr(date)}`, async () => {
        const c = getSupabase();
        for (const { r, old } of prevVals) {
          const x = old ? await c.from('asset_values').upsert({ asset_id: r.asset_id, date, value: Number(old.value) }, { onConflict: 'asset_id,date' }) : await c.from('asset_values').delete().eq('asset_id', r.asset_id).eq('date', date);
          if (x.error) throw x.error;
        }
        for (const [id, invested] of prevInv) await updateRow('assets', id, { invested });
      });
      setVals({}); setInv({}); setMsg(`${rows.length} valeur(s) enregistrée(s) au ${dateFr(date)}.`);
      await reload();
    } catch (e) { setMsg(friendly(e)); }
    setBusy(false);
  }

  if (!d.assets.length) return <p className="muted">Ajoute d’abord des actifs.</p>;
  return (
    <>
      <p className="hint">Saisis la valeur de chaque ligne à une date (un relevé mensuel suffit). Laisse vide ce qui n’a pas changé. Le montant investi est facultatif : à renseigner si tu as versé de l’argent.</p>
      <div className="form" style={{ marginBottom: 8 }}>
        <label className="muted" htmlFor="md">Date du relevé</label>
        <input id="md" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      {d.assets.map((a) => {
        const l = lat[a.id];
        const bal = a.account_id ? d.balances[a.account_id] : null;
        return (
          <div className="item" key={a.id}>
            <div>
              {a.name}<span className="muted"> · {a.accountName}</span>
              <div className="muted">{l ? `Dernière valeur ${eur(l.value, 2)} au ${dateFr(l.date)}` : 'Aucune valeur'}</div>
              {bal && <button className="btn ghost" style={{ minHeight: 30, padding: '2px 8px', marginTop: 4 }} onClick={() => setVals({ ...vals, [a.id]: String(bal.balance) })}>Solde importé {eur(bal.balance, 2)} au {dateFr(bal.date)}</button>}
            </div>
            <span className="form">
              <input type="text" inputMode="decimal" className="num" placeholder="Valeur €" value={vals[a.id] ?? ''} onChange={(e) => setVals({ ...vals, [a.id]: e.target.value })} aria-label={`Valeur ${a.name}`} />
              <input type="text" inputMode="decimal" className="num" placeholder={a.invested != null ? `Investi ${a.invested}` : 'Investi €'} value={inv[a.id] ?? ''} onChange={(e) => setInv({ ...inv, [a.id]: e.target.value })} aria-label={`Investi ${a.name}`} />
            </span>
          </div>
        );
      })}
      {msg && <div className="warn">{msg}</div>}
      <p><button className="btn" disabled={busy} onClick={save}>Enregistrer le relevé</button></p>
    </>
  );
}

const DEFAULT_RATE = { 'Liquidité': 2, 'Actions': 7, 'Obligations': 3, 'Immobilier': 3, 'Alternatif': 5 };

function SimuTab({ d, lat }) {
  const classTotals = useMemo(() => {
    const t = {};
    for (const a of d.assets) t[a.asset_class] = (t[a.asset_class] || 0) + (lat[a.id] ? lat[a.id].value : 0);
    return t;
  }, [d.assets, lat]);
  const total = r2(Object.values(classTotals).reduce((s, v) => s + v, 0));

  const [mode, setMode] = useState('global');
  const [years, setYears] = useState('20');
  const [infl, setInfl] = useState('2');
  const [glob, setGlob] = useState({ start: String(total), rate: '4', monthly: '0' });
  const [cls, setCls] = useState(() => Object.fromEntries(CLASSES.map((c) => [c, { start: String(r2(classTotals[c] || 0)), rate: String(DEFAULT_RATE[c]), monthly: '0' }])));

  const rows = mode === 'global'
    ? [{ label: 'Patrimoine', start: num(glob.start), rate: num(glob.rate), monthly: num(glob.monthly) }]
    : CLASSES.map((c) => ({ label: c, start: num(cls[c].start), rate: num(cls[c].rate), monthly: num(cls[c].monthly) }));
  const n = Math.min(Math.max(Math.round(num(years)), 1), 60);
  const res = useMemo(() => project(rows, n, num(infl)), [mode, glob, cls, n, infl]); // eslint-disable-line react-hooks/exhaustive-deps

  const series = [
    { key: 'total', label: 'Valeur', color: '#2E7D5B' },
    { key: 'invested', label: 'Capital versé', color: '#7A8FA6', dash: '5 4' },
    ...(mode === 'classe' ? rows.map((r, i) => ({ key: `r${i}`, label: r.label, color: colorOf(r.label) })) : []),
  ];
  const inp = (obj, set, key, label) => (
    <input type="text" inputMode="decimal" className="num" value={obj[key]} onChange={(e) => set({ ...obj, [key]: e.target.value })} aria-label={label} />
  );

  return (
    <>
      <Seg value={mode} onChange={setMode} options={[['global', 'Global'], ['classe', 'Par classe']]} />
      <div className="simglobal" style={{ margin: '14px 0' }}>
        <label className="fld"><span>Durée (années)</span><input type="text" inputMode="numeric" className="num" value={years} onChange={(e) => setYears(e.target.value)} /></label>
        <label className="fld"><span><Term k="inflation">Inflation</Term> (% par an)</span><input type="text" inputMode="decimal" className="num" value={infl} onChange={(e) => setInfl(e.target.value)} /></label>
      </div>

      {mode === 'global' ? (
        <div className="simglobal">
          <label className="fld"><span>Capital de départ (€)</span>{inp(glob, setGlob, 'start', 'Capital de départ')}</label>
          <label className="fld"><span><Term k="rendement">Rendement</Term> (% par an)</span>{inp(glob, setGlob, 'rate', 'Rendement annuel')}</label>
          <label className="fld"><span>Versement (€ par mois)</span>{inp(glob, setGlob, 'monthly', 'Versement mensuel')}</label>
        </div>
      ) : (
        CLASSES.map((c) => (
          <div className="simrow" key={c}>
            <span className="simname"><i className="dot" style={{ background: colorOf(c) }} /> {c}</span>
            <label className="fld"><span>Capital de départ (€)</span>{inp(cls[c], (v) => setCls({ ...cls, [c]: v }), 'start', `Capital ${c}`)}</label>
            <label className="fld"><span><Term k="rendement">Rendement</Term> (% par an)</span>{inp(cls[c], (v) => setCls({ ...cls, [c]: v }), 'rate', `Rendement ${c}`)}</label>
            <label className="fld"><span>Versement (€ par mois)</span>{inp(cls[c], (v) => setCls({ ...cls, [c]: v }), 'monthly', `Versement ${c}`)}</label>
          </div>
        ))
      )}
      {mode === 'classe' && <p className="hint">Les capitaux de départ reprennent la valeur actuelle de chaque classe ; tu peux les modifier pour simuler un autre scénario.</p>}

      <div className="strip" style={{ marginTop: 14 }}>
        <div><span>Valeur à {n} ans</span><b>{eur(res.final)}</b></div>
        <div><span><Term k="capitalverse">Capital versé</Term></span><b>{eur(res.invested)}</b></div>
        <div><span><Term k="interets">Intérêts</Term></span><b className="pos">{eur(res.gain)}</b></div>
      </div>
      <p className="hint">En euros d’aujourd’hui (inflation {num(infl)} %) : {eur(res.real)}.</p>
      <div className="panel">
        <TrendLines data={res.data} series={series} xKey="year" xFormat={(y) => `${y} an${y > 1 ? 's' : ''}`} />
      </div>
      <p className="hint">Hypothèses : rendement annuel net constant, intérêts composés chaque mois, versements en fin de mois. Simulation indicative, pas une prévision.</p>
    </>
  );
}
