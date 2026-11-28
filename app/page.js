'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { loadAccounts, loadTransactions, loadBalanceHistory } from '../lib/data.js';
import { summarize, totals, agg, byMonth, pivot, sankey, seriesByCategory, inScope } from '../lib/analytics.js';
import { UNCATEGORIZED, categoryList, colorOf, registerExtraColors, groupOf } from '../lib/categories.js';
import { eur, resolvePeriod, monthLabel } from '../lib/format.js';
import { PeriodPicker, Seg } from '../components/Filters.js';
import { useUser } from '../components/User.js';
import Term from '../components/Term.js';
import { Tag } from '../components/Tag.js';
import { CategoryPie, FlowSankey, TrendLines, PivotTable } from '../components/Charts.js';
import { loadPots, loadEntries, loadPotMonths, fundedByTx, allocBreakdown, lastMonths, buildTree, ownBalances } from '../lib/pots.js';
import { loadAssets, loadValues, groupValues, totalAt, accountValue, monthAgoDate, fmtPct, r2 } from '../lib/wealth.js';

const SCOPES = [['perso', 'Perso'], ['commun', 'Commun'], ['consolide', 'Consolidé']];
const HINTS = {
  perso: 'Tes comptes personnels. Les virements vers le compte commun comptent comme des dépenses.',
  commun: 'Compte commun. Les virements reçus comptent comme des revenus.',
  consolide: 'Perso + commun. Les virements vers le commun sont exclus pour éviter le double compte.',
};
const TABS = [['repartition', 'Répartition'], ['flux', 'Flux'], ['evolution', 'Évolution'], ['tableau', 'Tableau']];
const STATUS = { 'En cours': '#8DB4EA', 'À faire': '#F4B183', 'Fait': '#7FCBA5' };

// Variation affichée sous forme de tag (▲ / ▼).
function VarTag({ diff, base }) {
  if (diff === null || diff === undefined) return null;
  const pct = base ? (diff / base) * 100 : null;
  return <span className={'vtag' + (diff < 0 ? ' neg' : '')}>{diff < 0 ? '▼' : '▲'} {pct !== null ? fmtPct(Math.abs(pct)).replace('+', '') : eur(Math.abs(diff))}</span>;
}

export default function Dashboard() {
  const { name } = useUser();
  const [accounts, setAccounts] = useState([]);
  const [txs, setTxs] = useState([]);
  const [recent, setRecent] = useState([]);
  const [wealth, setWealth] = useState(null);
  const [period, setPeriod] = useState({ preset: '3m' });
  const [scope, setScope] = useState('perso');
  const [cats, setCats] = useState([]);
  const [tab, setTab] = useState('repartition');
  const [pd, setPd] = useState({ pots: [], entries: [], months: [] });
  const [excl, setExcl] = useState(false);
  const [accOpen, setAccOpen] = useState(true);
  useEffect(() => { try { if (localStorage.getItem('budj.accOpen') === '0') setAccOpen(false); } catch (e) { /* ouvert par défaut */ } }, []);
  const [state, setState] = useState({ loading: true, error: null });

  const filterCats = [...categoryList().filter((c) => c.kind === 'expense' || c.kind === 'transfer_commun').map((c) => c.name), UNCATEGORIZED];

  // Blocs de synthèse (indépendants de la période d'analyse)
  useEffect(() => {
    let off = false;
    const d0 = new Date();
    const from = new Date(Date.UTC(d0.getFullYear(), d0.getMonth() - 2, 1)).toISOString().slice(0, 10);
    Promise.all([
      loadTransactions({ from, select: 'date,category' }).catch(() => []),
      Promise.all([loadAssets(), loadValues(), loadBalanceHistory()]).catch(() => null),
    ]).then(([r, w]) => { if (!off) { setRecent(r); setWealth(w ? { assets: w[0], values: w[1], hist: w[2] } : null); } });
    return () => { off = true; };
  }, []);

  const range = resolvePeriod(period);
  useEffect(() => {
    let off = false;
    setState({ loading: true, error: null });
    Promise.all([
      loadAccounts(),
      loadTransactions({ ...range, select: 'id,account_id,date,amount,category' }),
      Promise.all([loadPots(), loadEntries(), loadPotMonths()]).catch(() => [[], [], []]),
    ])
      .then(([a, t, p]) => { if (!off) { registerExtraColors(Object.fromEntries(p[0].filter((x) => x.color).map((x) => [x.name, x.color]))); setAccounts(a); setTxs(t); setPd({ pots: p[0], entries: p[1], months: p[2] }); setState({ loading: false, error: null }); } })
      .catch((e) => { if (!off) setState({ loading: false, error: e.message }); });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  const byId = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);
  const funded = useMemo(() => (excl ? fundedByTx(pd.entries) : null), [excl, pd.entries]);
  const allRows = useMemo(() => summarize(txs, byId, scope, null, funded), [txs, byId, scope, funded]);
  const rows = useMemo(() => summarize(txs, byId, scope, new Set(cats), funded), [txs, byId, scope, cats, funded]);
  const alloc = useMemo(
    () => (scope === 'perso' && excl ? allocBreakdown([...new Set(allRows.map((r) => r.month))], pd.months, pd.entries, pd.pots) : null),
    [scope, excl, allRows, pd]
  );
  const kpi = totals(allRows);
  const todo = txs.filter((t) => !t.category && byId[t.account_id] && inScope(byId[t.account_id], scope)).length;
  const toggle = (c) => setCats((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));

  const trend = useMemo(() => {
    if (cats.length) {
      const s = seriesByCategory(rows);
      return { data: s.data, series: s.cats.map((c) => ({ key: c, label: c, color: colorOf(c) })) };
    }
    return {
      data: byMonth(allRows),
      series: [
        { key: 'income', label: 'Revenus', color: '#6FC59A' },
        { key: 'expense', label: 'Dépenses', color: '#EE8C85' },
        { key: 'net', label: 'Solde', color: '#9AB3C9', dash: '5 4' },
      ],
    };
  }, [rows, allRows, cats]);

  // ----- blocs -----
  const today = new Date().toISOString().slice(0, 10);
  const ago = monthAgoDate();
  const g = useMemo(() => (wealth ? groupValues(wealth.values) : {}), [wealth]);
  const wTotal = wealth ? totalAt(wealth.assets, g, today) : 0;
  const wBefore = wealth ? totalAt(wealth.assets, g, ago) : 0;
  const wDiff = wealth && wBefore > 0 ? r2(wTotal - wBefore) : null;

  const monthRows = lastMonths(3).map((m, i) => {
    const list = recent.filter((t) => t.date.startsWith(m));
    const nTodo = list.filter((t) => !t.category).length;
    let status = 'Fait', note = `${list.length} opération${list.length > 1 ? 's' : ''}`;
    if (i === 0) status = 'En cours';
    else if (list.length === 0) { status = 'À faire'; note = 'rien d’importé'; }
    else if (nTodo > 0) { status = 'À faire'; note = `${nTodo} à catégoriser`; }
    return { m, status, note };
  });

  const potTree = useMemo(() => buildTree(pd.pots, ownBalances(pd.entries)), [pd]);
  const nextGoal = useMemo(() => {
    const c = [];
    for (const m of potTree) {
      if (m.target_date && m.target_date >= today) c.push({ pot: m, bal: m.total, parent: null });
      for (const k of m.kids) if (k.target_date && k.target_date >= today) c.push({ pot: k, bal: k.balance, parent: m });
    }
    c.sort((a, b) => a.pot.target_date.localeCompare(b.pot.target_date));
    return c[0] || null;
  }, [potTree, today]);

  return (
    <>
      <h1>Tableau de bord{name ? ` ${name}` : ''}</h1>

      <details className="tcard" open={accOpen} onToggle={(e) => { setAccOpen(e.currentTarget.open); try { localStorage.setItem('budj.accOpen', e.currentTarget.open ? '1' : '0'); } catch (err) { /* stockage indisponible */ } }}>
        <summary>Mes comptes · variation M-1</summary>
        {accounts.length === 0 && !state.loading && <p className="muted" style={{ margin: '0 0 8px' }}>Aucun compte. <Link href="/reglages">Crée un compte</Link>, puis importe tes opérations depuis <Link href="/transactions">Opérations</Link>.</p>}
        {accounts.map((a) => {
          const v = wealth ? accountValue(a, wealth.assets, g, wealth.hist, today) : null;
          const b = wealth ? accountValue(a, wealth.assets, g, wealth.hist, ago) : null;
          return (
            <Link href="/patrimoine" key={a.id} className="accrow" style={{ color: 'inherit', textDecoration: 'none' }}>
              <span>{a.name}<span className="meta" style={{ display: 'block' }}>{a.bank}{a.envelope ? ` · ${a.envelope}` : ''}{a.shared ? ' · commun' : ''}</span></span>
              <span className="right">
                {v === null ? <span className="muted">–</span> : eur(v)}{' '}
                {v !== null && b !== null && b !== 0 && <VarTag diff={r2(v - b)} base={b} />}
              </span>
            </Link>
          );
        })}
        {accounts.length > 0 && <p className="hint" style={{ margin: '8px 0 0' }}>Soldes : actifs liés au compte ou dernier solde importé. <Term k="variation">Variation M-1</Term> = écart avec il y a un mois.</p>}
      </details>

      <div className="dashgrid">
        <Link href="/transactions" className="dcard sec-ops">
          <h2>Opérations</h2>
          {monthRows.map((r) => (
            <div className="mrow" key={r.m}>
              <span>{monthLabel(r.m)}<small>{r.note}</small></span>
              <Tag color={STATUS[r.status]}>{r.status}</Tag>
            </div>
          ))}
        </Link>

        <Link href="/pots" className="dcard sec-pots">
          <h2>Mes pots</h2>
          {potTree.length === 0 ? <p className="muted" style={{ margin: 0 }}>Aucun pot pour le moment.</p> : (
            <>
              <div className="big">{eur(potTree.reduce((sum, m) => sum + m.total, 0))}</div>
              {potTree.slice(0, 6).map((m) => (
                <div className="mrow" key={m.id}>
                  <span><i className="dot" style={{ background: m.color }} /> {m.name}</span>
                  <b className="stat" style={{ fontWeight: 500 }}>{eur(m.total)}</b>
                </div>
              ))}
              {potTree.length > 6 && <small className="muted">+ {potTree.length - 6} autre{potTree.length - 6 > 1 ? 's' : ''}</small>}
            </>
          )}
          {nextGoal && (
            <>
              <hr />
              <div className="muted" style={{ fontSize: 12 }}>Prochain objectif</div>
              <div style={{ fontWeight: 600 }}>{nextGoal.pot.emoji ? `${nextGoal.pot.emoji} ` : ''}{nextGoal.pot.name}{nextGoal.parent ? <span className="muted" style={{ fontWeight: 400 }}> · {nextGoal.parent.name}</span> : null}</div>
              <div className="track2" style={{ marginTop: 6 }}><span style={{ width: `${nextGoal.pot.target ? Math.max(0, Math.min(100, (nextGoal.bal / nextGoal.pot.target) * 100)) : 0}%`, background: nextGoal.pot.color }} /></div>
              <small className="muted">
                {eur(nextGoal.bal)}{nextGoal.pot.target ? ` sur ${eur(nextGoal.pot.target)}` : ''} · avant {monthLabel(nextGoal.pot.target_date.slice(0, 7))}
              </small>
            </>
          )}
        </Link>

        <Link href="/patrimoine" className="dcard sec-pat">
          <h2>Patrimoine</h2>
          {wealth ? (
            <>
              <div className="big">{eur(wTotal)}</div>
              <div className="vline">
                {wDiff === null ? <span className="muted">Pas encore de relevé il y a un mois</span> : (
                  <>
                    <span className={wDiff < 0 ? 'neg' : 'pos'}>{wDiff >= 0 ? '+' : ''}{eur(wDiff)}</span>
                    <VarTag diff={wDiff} base={wBefore} />
                    <span className="muted">M-1</span>
                  </>
                )}
              </div>
            </>
          ) : <p className="muted" style={{ margin: 0 }}>Patrimoine indisponible : base à mettre à jour (supabase/008_update.sql).</p>}
        </Link>
      </div>

      <div className="sec-ops">
      <h2 style={{ marginTop: 34 }}>Analyse des dépenses</h2>
      <div className="bar">
        <Seg value={scope} onChange={setScope} options={SCOPES} />
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      <p className="hint">{scope === 'consolide' ? <><Term k="consolide">Consolidé</Term> : perso + commun, virements vers le commun exclus.</> : HINTS[scope]}</p>

      {state.error && <p className="err">{state.error}</p>}
      <div className="strip">
        <div><span>Revenus</span><b>{eur(kpi.income)}</b></div>
        <div><span>Dépenses</span><b>{eur(kpi.expense)}</b></div>
        <div><span><Term k="solde">Solde</Term></span><b className={kpi.net < 0 ? 'neg' : 'pos'}>{eur(kpi.net)}</b></div>
      </div>
      {todo > 0 && (
        <div className="warn">{todo} opération{todo > 1 ? 's' : ''} à catégoriser. <Link href="/transactions?todo=1">Catégoriser</Link></div>
      )}

      <div className="chips" aria-label="Filtrer les dépenses par catégorie">
        {filterCats.map((c) => (
          <button key={c} className={'chip' + (cats.includes(c) ? ' on' : '')} style={{ '--c': colorOf(c) }} onClick={() => toggle(c)}>{c}</button>
        ))}
        {cats.length > 0 && <button className="chip" onClick={() => setCats([])}>Tout afficher</button>}
      </div>
      {pd.pots.length > 0 && (
        <label className="check" style={{ margin: '8px 0' }}>
          <input type="checkbox" checked={excl} onChange={(e) => setExcl(e.target.checked)} /> Exclure les dépenses payées par un pot
        </label>
      )}

      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div className="panel">
        {state.loading ? <p className="muted">Chargement…</p> : (
          <>
            {tab === 'repartition' && <CategoryPie data={agg(rows, 'expense').filter((d) => d.value > 0)} />}
            {tab === 'flux' && <p className="hint" style={{ marginTop: 0 }}><Term k="flux">Flux</Term> : revenus → groupes de catégories → catégories. Les groupes se règlent dans Réglages.</p>}
            {tab === 'flux' && <FlowSankey data={sankey(rows, alloc, groupOf)} />}
            {tab === 'flux' && kpi.net < 0 && <p className="hint">Le déficit ({eur(kpi.net)}) est ajouté aux revenus pour équilibrer les flux.</p>}
            {tab === 'flux' && scope === 'perso' && pd.pots.length > 0 && !alloc && (
              <p className="hint">Pour voir l’excédent réparti par pots : coche « Exclure les dépenses payées par un pot » et clôture les mois concernés.</p>
            )}
            {tab === 'evolution' && <TrendLines data={trend.data} series={trend.series} />}
            {tab === 'tableau' && <PivotTable data={pivot(rows)} />}
          </>
        )}
      </div>

      </div>

      <p className="settings-link"><Link href="/reglages" className="btn ghost sm">Réglages</Link></p>
    </>
  );
}
