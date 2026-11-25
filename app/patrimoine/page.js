'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '../../lib/supabase.js';
import { loadAccounts, loadBalances } from '../../lib/data.js';
import {
  TYPES, CLASSES, TYPE_CLASS, RANGES, loadAssets, loadValues, groupValues, latest, wealthSeries,
  breakdown, gainOf, portfolioGain, project, r2, fmtPct, KINDS, kindForType, guessType, buildAssetTree,
} from '../../lib/wealth.js';
import { readPositionsFile } from '../../lib/positions.js';
import { eur, dateFr } from '../../lib/format.js';
import { colorOf, paletteColor } from '../../lib/categories.js';
import { Seg } from '../../components/Filters.js';
import { CategoryPie, WealthChart, TrendLines } from '../../components/Charts.js';

const TABS = [['vue', 'Vue'], ['actifs', 'Actifs'], ['maj', 'Mise à jour'], ['simu', 'Simulateur']];
const num = (s) => Number(String(s).replace(',', '.')) || 0;
const today = () => new Date().toISOString().slice(0, 10);

export default function Patrimoine() {
  const [tab, setTab] = useState('vue');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  const reload = useCallback(async () => {
    try {
      const [assets, values, accounts, balances] = await Promise.all([loadAssets(), loadValues(), loadAccounts(), loadBalances()]);
      setD({ assets, values, accounts, balances }); setErr('');
    } catch (e) {
      setErr(/schema cache|does not exist/i.test(e.message || '') ? 'Tables absentes : exécute supabase/003_placements.sql dans Supabase.' : e.message);
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const g = useMemo(() => (d ? groupValues(d.values) : {}), [d]);
  const lat = useMemo(() => latest(g), [g]);

  if (err) return <><h1>Patrimoine</h1><p className="err">{err}</p></>;
  if (!d) return <><h1>Patrimoine</h1><p className="muted">Chargement…</p></>;
  return (
    <>
      <h1>Patrimoine</h1>
      <Seg value={tab} onChange={setTab} options={TABS} />
      <div style={{ marginTop: 16 }}>
        {tab === 'vue' && <VueTab d={d} g={g} lat={lat} goTo={setTab} />}
        {tab === 'actifs' && <ActifsTab d={d} g={g} lat={lat} reload={reload} />}
        {tab === 'maj' && <MajTab d={d} lat={lat} reload={reload} />}
        {tab === 'simu' && <SimuTab d={d} lat={lat} />}
      </div>
    </>
  );
}

function VueTab({ d, g, lat, goTo }) {
  const [range, setRange] = useState('1A');
  const [by, setBy] = useState('class');
  const { assets } = d;
  const series = useMemo(() => wealthSeries(assets, g, range), [assets, g, range]);
  const total = r2(assets.reduce((s, a) => s + (lat[a.id] ? lat[a.id].value : 0), 0));
  const pg = portfolioGain(assets, lat);
  const first = series[0], last = series[series.length - 1];
  const delta = series.length > 1 ? r2(last.total - first.total) : 0;
  const dpct = series.length > 1 && first.total ? (delta / first.total) * 100 : null;
  const slices = useMemo(
    () => breakdown(assets, lat, by).map((r, i) => ({ ...r, color: by === 'class' ? colorOf(r.name) : paletteColor(i) })),
    [assets, lat, by]
  );

  if (!assets.length) {
    return <p>Aucun actif. <button className="btn" onClick={() => goTo('actifs')}>Ajouter un premier actif</button></p>;
  }
  return (
    <>
      <div className="strip">
        <div><span>Patrimoine</span><b>{eur(total)}</b></div>
        <div><span>+/- value latente</span><b className={pg && pg.abs < 0 ? 'neg' : 'pos'}>{pg ? eur(pg.abs) : '–'}</b>{pg && <span>{fmtPct(pg.pct)}</span>}</div>
        <div><span>Sur la période</span><b className={delta < 0 ? 'neg' : 'pos'}>{eur(delta)}</b>{dpct !== null && <span>{fmtPct(dpct)}</span>}</div>
      </div>

      <h2>Évolution</h2>
      <Seg value={range} onChange={setRange} options={RANGES} />
      <div className="panel" style={{ marginTop: 10 }}>
        <WealthChart data={series} long={['ALL', '1A', 'YTD', '6M'].includes(range)} />
      </div>
      <p className="hint">Entre deux relevés, la dernière valeur connue est reportée : les courtes périodes sont plates tant que tu ne mets pas à jour plus souvent.</p>

      <h2>Répartition</h2>
      <Seg value={by} onChange={setBy} options={[['class', 'Classe'], ['type', 'Type d’actif'], ['kind', 'Compte'], ['holder', 'Enveloppe'], ['asset', 'Actif']]} />
      <div className="panel" style={{ marginTop: 10 }}><CategoryPie data={slices} /></div>
    </>
  );
}

function AssetForm({ asset, accounts, holders, onSaved, onCancel }) {
  const a = asset || {};
  const [f, setF] = useState({
    name: a.name || '', type: a.asset_type || 'Livret', cls: a.asset_class || TYPE_CLASS.Livret,
    kind: a.account_kind || 'Épargne', holder: a.holder || '', isin: a.isin || '', ticker: a.ticker || '',
    qty: a.quantity != null ? String(a.quantity) : '', pru: '', invested: a.invested != null ? String(a.invested) : '',
    account: a.account_id || '', value: '', date: today(),
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const persoAccounts = accounts.filter((x) => !x.shared);

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const sb = getSupabase();
      const invested = f.invested !== '' ? num(f.invested) : f.qty !== '' && f.pru !== '' ? r2(num(f.qty) * num(f.pru)) : null;
      const row = {
        name: f.name.trim(), asset_type: f.type, asset_class: f.cls, account_kind: f.kind, holder: f.holder.trim() || null,
        isin: f.isin.trim() || null, ticker: f.ticker.trim() || null,
        quantity: f.qty !== '' ? num(f.qty) : null, invested, account_id: f.account || null,
      };
      if (asset) {
        const { error } = await sb.from('assets').update(row).eq('id', asset.id);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from('assets').insert(row).select('id').single();
        if (error) throw error;
        if (f.value !== '') {
          const r = await sb.from('asset_values').insert({ asset_id: data.id, date: f.date, value: num(f.value) });
          if (r.error) throw r.error;
        }
      }
      onSaved();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  }

  return (
    <form className="panel formgrid" onSubmit={submit}>
      <div className="form">
        <select value={f.kind} onChange={(e) => set({ kind: e.target.value })} aria-label="Type de compte">
          {KINDS.map((k) => <option key={k}>{k}</option>)}
        </select>
        <input type="text" list="holders" placeholder="Enveloppe (PEA, Assurance vie, Livret A…)" value={f.holder} onChange={(e) => set({ holder: e.target.value })} />
        <datalist id="holders">{holders.map((h) => <option key={h} value={h} />)}</datalist>
      </div>
      <input type="text" placeholder="Nom de l’actif (ex : ETF MSCI World)" value={f.name} onChange={(e) => set({ name: e.target.value })} required />
      <div className="form">
        <select value={f.type} onChange={(e) => set({ type: e.target.value, cls: TYPE_CLASS[e.target.value], kind: kindForType(e.target.value) })} aria-label="Type d’actif">
          {TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select value={f.cls} onChange={(e) => set({ cls: e.target.value })} aria-label="Classe">
          {CLASSES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      {!asset && (
        <div className="form">
          <input type="text" inputMode="decimal" className="num" placeholder="Valeur €" value={f.value} onChange={(e) => set({ value: e.target.value })} aria-label="Valeur actuelle" />
          <input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} aria-label="Date de la valeur" />
        </div>
      )}
      <div className="form">
        <input type="text" inputMode="decimal" className="num" placeholder="Quantité" value={f.qty} onChange={(e) => set({ qty: e.target.value })} />
        <input type="text" inputMode="decimal" className="num" placeholder="PRU €" value={f.pru} onChange={(e) => set({ pru: e.target.value })} />
        <input type="text" inputMode="decimal" className="num" placeholder="Investi €" value={f.invested} onChange={(e) => set({ invested: e.target.value })} aria-label="Montant investi" />
      </div>
      <p className="hint">Montant investi = ce que tu as mis au total. Vide, il est calculé avec quantité × PRU. Il sert à la +/- value.</p>
      <select value={f.account} onChange={(e) => set({ account: e.target.value })} aria-label="Compte lié">
        <option value="">Aucun compte bancaire lié</option>
        {persoAccounts.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.bank})</option>)}
      </select>
      <details>
        <summary>Cours automatiques (plus tard)</summary>
        <div className="form" style={{ marginTop: 8 }}>
          <input type="text" placeholder="ISIN" value={f.isin} onChange={(e) => set({ isin: e.target.value })} />
          <input type="text" placeholder="Ticker" value={f.ticker} onChange={(e) => set({ ticker: e.target.value })} />
        </div>
      </details>
      {err && <p className="err">{err}</p>}
      <div className="form">
        <button className="btn" disabled={busy}>{asset ? 'Enregistrer' : 'Ajouter l’actif'}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Annuler</button>
      </div>
    </form>
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

function ImportPositions({ assets, lat, holders, onDone, onCancel }) {
  const [holder, setHolder] = useState('PEA');
  const [kind, setKind] = useState('Investissement');
  const [date, setDate] = useState(today());
  const [closeMissing, setCloseMissing] = useState(true);
  const [pos, setPos] = useState(null);
  const [fileName, setFileName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function onFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setErr(''); setPos(null); setFileName(f.name);
    try { setPos(mergeByIsin(await readPositionsFile(f))); } catch (x) { setErr(x.message); }
  }

  const same = (h) => (h || '').trim().toLowerCase() === holder.trim().toLowerCase();
  const inHolder = assets.filter((a) => same(a.holder));
  const plan = useMemo(
    () => (pos ? pos.map((p) => ({ ...p, existing: inHolder.find((a) => a.isin === p.isin) || null })) : []),
    [pos, assets, holder] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const absent = pos ? inHolder.filter((a) => a.isin && !pos.some((p) => p.isin === a.isin) && lat[a.id] && lat[a.id].value > 0) : [];
  const total = r2(plan.reduce((s, p) => s + p.value, 0));

  async function run() {
    setBusy(true); setErr('');
    try {
      const sb = getSupabase();
      const holderName = holder.trim() || null;
      const toCreate = plan.filter((p) => !p.existing);
      let created = [];
      if (toCreate.length) {
        const rows = toCreate.map((p) => {
          const type = guessType(p.name);
          return { name: p.name, asset_type: type, asset_class: TYPE_CLASS[type], account_kind: kind, holder: holderName, isin: p.isin, quantity: p.quantity, invested: p.invested };
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
      onDone(`${plan.length} position(s) importée(s) dans « ${holderName || 'sans enveloppe'} » (${toCreate.length} nouvelle(s))${closeMissing && absent.length ? `, ${absent.length} soldée(s)` : ''}.`);
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div className="panel formgrid">
      <b>Importer un portefeuille (Bourse Direct)</b>
      <div className="form">
        <input type="text" list="holders2" placeholder="Enveloppe" value={holder} onChange={(e) => setHolder(e.target.value)} aria-label="Enveloppe" />
        <datalist id="holders2">{holders.map((h) => <option key={h} value={h} />)}</datalist>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type de compte">
          {KINDS.map((k) => <option key={k}>{k}</option>)}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date de valorisation" />
      </div>
      <input type="file" accept=".xlsx,.csv" onChange={onFile} />
      <p className="hint">Fichier .xlsx ou .csv exporté depuis Bourse Direct (colonnes Nom, ISIN, Quantité, PRU, Valorisation). Les lignes déjà présentes (même ISIN, même enveloppe) sont mises à jour.</p>
      {err && <p className="err">{err}</p>}
      {pos && (
        <>
          <p className="muted">{fileName} : {plan.length} position(s), valorisation {eur(total, 2)}.</p>
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
        <button className="btn" disabled={busy || !pos || !holder.trim()} onClick={run}>{busy ? 'Import…' : 'Importer'}</button>
        <button className="btn ghost" onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}

function ActifsTab({ d, g, lat, reload }) {
  const [editing, setEditing] = useState(null); // 'new' | 'import' | id | null
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState('');
  const sb = getSupabase();
  const tree = useMemo(() => buildAssetTree(d.assets, lat), [d.assets, lat]);
  const holders = useMemo(
    () => [...new Set([...d.assets.map((a) => a.holder).filter(Boolean), 'PEA', 'Assurance vie', 'CTO', 'PER', 'Livret A', 'LDDS', 'LEP'])],
    [d.assets]
  );

  async function del(a) {
    if (!window.confirm(`Supprimer « ${a.name} » et tout son historique ?`)) return;
    const { error } = await sb.from('assets').delete().eq('id', a.id);
    if (error) return setMsg(error.message);
    reload();
  }
  async function delValue(v) {
    const { error } = await sb.from('asset_values').delete().eq('id', v.id);
    if (error) return setMsg(error.message);
    reload();
  }
  const saved = () => { setEditing(null); reload(); };

  const row = (a) => {
    const v = lat[a.id] ? lat[a.id].value : null;
    const gain = gainOf(a, v);
    const hist = [...(g[a.id] || [])].reverse();
    return (
      <div className="lv3" key={a.id}>
        {editing === a.id
          ? <AssetForm asset={a} accounts={d.accounts} holders={holders} onSaved={saved} onCancel={() => setEditing(null)} />
          : (
            <>
              <div className="top">
                <span>{a.name}</span>
                <span className="amt">{v === null ? '–' : eur(v, 2)}</span>
              </div>
              <div className="meta">
                <span><i className="dot" style={{ background: colorOf(a.asset_class) }} /> {a.asset_class}</span>
                <span>{a.asset_type}</span>
                {a.quantity != null && <span>{Number(a.quantity)} titres</span>}
                {gain && <span className={gain.abs < 0 ? 'neg' : 'pos'}>{eur(gain.abs, 2)} ({fmtPct(gain.pct)})</span>}
              </div>
              <div className="form" style={{ marginTop: 6 }}>
                <button className="btn ghost sm" onClick={() => setOpen(open === a.id ? null : a.id)}>Historique</button>
                <button className="btn ghost sm" onClick={() => setEditing(a.id)}>Modifier</button>
                <button className="btn danger sm" onClick={() => del(a)}>Supprimer</button>
              </div>
              {open === a.id && (
                <div style={{ paddingTop: 6 }}>
                  {hist.length === 0 && <p className="muted">Aucune valeur saisie.</p>}
                  {hist.map((h, i) => {
                    const prev = hist[i + 1];
                    return (
                      <div className="item" key={h.id}>
                        <span>{dateFr(h.date)} <span className="muted">{prev && prev.value ? fmtPct(((h.value - prev.value) / prev.value) * 100) : ''}</span></span>
                        <span className="form"><span className="amt">{eur(h.value, 2)}</span><button className="btn danger sm" onClick={() => delValue(h)}>×</button></span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
      </div>
    );
  };

  return (
    <>
      {msg && <div className="warn">{msg}</div>}
      {editing === 'new' && <AssetForm accounts={d.accounts} holders={holders} onSaved={saved} onCancel={() => setEditing(null)} />}
      {editing === 'import' && (
        <ImportPositions assets={d.assets} lat={lat} holders={holders}
          onDone={(m) => { setMsg(m); setEditing(null); reload(); }} onCancel={() => setEditing(null)} />
      )}
      {editing !== 'new' && editing !== 'import' && (
        <div className="form">
          <button className="btn" onClick={() => setEditing('new')}>Ajouter un actif</button>
          <button className="btn ghost" onClick={() => setEditing('import')}>Importer un portefeuille</button>
        </div>
      )}

      <div className="tree" style={{ marginTop: 16 }}>
        {tree.map((k) => (
          <details key={k.kind} className="lv1" open>
            <summary>
              <span>{k.kind}</span>
              {k.gain && <span className={'amt ' + (k.gain.abs < 0 ? 'neg' : 'pos')}>{fmtPct(k.gain.pct)}</span>}
              <span className="amt">{eur(k.total)}</span>
            </summary>
            {k.envelopes.map((e) => (
              <details key={e.name} className="lv2" open>
                <summary>
                  <span>{e.name}</span>
                  {e.gain && <span className={'amt ' + (e.gain.abs < 0 ? 'neg' : 'pos')}>{fmtPct(e.gain.pct)}</span>}
                  <span className="amt">{eur(e.total)}</span>
                </summary>
                {e.items.map(row)}
              </details>
            ))}
          </details>
        ))}
      </div>
      {d.assets.length === 0 && <p className="muted">Aucun actif pour le moment.</p>}
    </>
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
      setVals({}); setInv({}); setMsg(`${rows.length} valeur(s) enregistrée(s) au ${dateFr(date)}.`);
      await reload();
    } catch (e) { setMsg(e.message); }
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
              {a.name}{a.holder && <span className="muted"> · {a.holder}</span>}
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
      <div className="form" style={{ margin: '14px 0' }}>
        <label className="muted">Durée (ans) {' '}<input type="text" inputMode="numeric" className="num" value={years} onChange={(e) => setYears(e.target.value)} /></label>
        <label className="muted">Inflation (%) {' '}<input type="text" inputMode="decimal" className="num" value={infl} onChange={(e) => setInfl(e.target.value)} /></label>
      </div>

      {mode === 'global' ? (
        <div className="form">
          <label className="muted">Capital {inp(glob, setGlob, 'start', 'Capital de départ')}</label>
          <label className="muted">Rendement %/an {inp(glob, setGlob, 'rate', 'Rendement annuel')}</label>
          <label className="muted">Versement €/mois {inp(glob, setGlob, 'monthly', 'Versement mensuel')}</label>
        </div>
      ) : (
        CLASSES.map((c) => (
          <div className="item" key={c}>
            <span><i className="dot" style={{ background: colorOf(c) }} /> {c}</span>
            <span className="form">
              {inp(cls[c], (v) => setCls({ ...cls, [c]: v }), 'start', `Capital ${c}`)}
              {inp(cls[c], (v) => setCls({ ...cls, [c]: v }), 'rate', `Rendement ${c}`)}
              {inp(cls[c], (v) => setCls({ ...cls, [c]: v }), 'monthly', `Versement ${c}`)}
            </span>
          </div>
        ))
      )}
      {mode === 'classe' && <p className="hint">Colonnes : capital €, rendement %/an, versement €/mois. Les capitaux de départ sont ceux de ton patrimoine actuel.</p>}

      <div className="strip" style={{ marginTop: 14 }}>
        <div><span>Valeur à {n} ans</span><b>{eur(res.final)}</b></div>
        <div><span>Capital versé</span><b>{eur(res.invested)}</b></div>
        <div><span>Intérêts</span><b className="pos">{eur(res.gain)}</b></div>
      </div>
      <p className="hint">En euros d’aujourd’hui (inflation {num(infl)} %) : {eur(res.real)}.</p>
      <div className="panel">
        <TrendLines data={res.data} series={series} xKey="year" xFormat={(y) => `${y} an${y > 1 ? 's' : ''}`} />
      </div>
      <p className="hint">Hypothèses : rendement annuel net constant, intérêts composés chaque mois, versements en fin de mois. Simulation indicative, pas une prévision.</p>
    </>
  );
}
