'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { loadAccounts, loadTransactions } from '../lib/data.js';
import { summarize, totals, agg, byMonth, pivot, sankey, seriesByCategory, inScope } from '../lib/analytics.js';
import { CATEGORIES, INCOME, TRANSFER_INTERNE, UNCATEGORIZED, colorOf } from '../lib/categories.js';
import { eur, resolvePeriod } from '../lib/format.js';
import { PeriodPicker, Seg } from '../components/Filters.js';
import { useUser } from '../components/User.js';
import { CategoryPie, FlowSankey, TrendLines, PivotTable } from '../components/Charts.js';
import { loadPots, loadEntries, loadPotMonths, fundedByTx, allocBreakdown } from '../lib/pots.js';

const SCOPES = [['perso', 'Perso'], ['commun', 'Commun'], ['consolide', 'Consolidé']];
const HINTS = {
  perso: 'Tes comptes personnels. Les virements vers le compte commun comptent comme des dépenses.',
  commun: 'Compte commun. Les virements reçus comptent comme des revenus.',
  consolide: 'Perso + commun. Les virements vers le commun sont exclus pour éviter le double compte.',
};
const TABS = [['repartition', 'Répartition'], ['flux', 'Flux'], ['evolution', 'Évolution'], ['tableau', 'Tableau']];
const FILTER_CATS = [...CATEGORIES.filter((c) => !INCOME.includes(c) && c !== TRANSFER_INTERNE), UNCATEGORIZED];

export default function Dashboard() {
  const { name } = useUser();
  const [accounts, setAccounts] = useState([]);
  const [txs, setTxs] = useState([]);
  const [period, setPeriod] = useState({ preset: '3m' });
  const [scope, setScope] = useState('perso');
  const [cats, setCats] = useState([]);
  const [tab, setTab] = useState('repartition');
  const [pd, setPd] = useState({ pots: [], entries: [], months: [] });
  const [excl, setExcl] = useState(false);
  const [state, setState] = useState({ loading: true, error: null });

  const range = resolvePeriod(period);
  useEffect(() => {
    let off = false;
    setState({ loading: true, error: null });
    Promise.all([
      loadAccounts(),
      loadTransactions({ ...range, select: 'id,account_id,date,amount,category' }),
      Promise.all([loadPots(), loadEntries(), loadPotMonths()]).catch(() => [[], [], []]),
    ])
      .then(([a, t, p]) => { if (!off) { setAccounts(a); setTxs(t); setPd({ pots: p[0], entries: p[1], months: p[2] }); setState({ loading: false, error: null }); } })
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
        { key: 'income', label: 'Revenus', color: '#2E7D5B' },
        { key: 'expense', label: 'Dépenses', color: '#D4574E' },
        { key: 'net', label: 'Solde', color: '#7A8FA6', dash: '5 4' },
      ],
    };
  }, [rows, allRows, cats]);

  return (
    <>
      <h1>Tableau de bord{name ? ` ${name}` : ''}</h1>
      <div className="bar">
        <Seg value={scope} onChange={setScope} options={SCOPES} />
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      <p className="hint">{HINTS[scope]}</p>

      {state.error && <p className="err">{state.error}</p>}
      {!state.loading && !state.error && accounts.length === 0 && (
        <div className="warn">Aucun compte. <Link href="/reglages">Crée un compte</Link>, puis <Link href="/import">importe un CSV</Link>.</div>
      )}

      <div className="strip">
        <div><span>Revenus</span><b>{eur(kpi.income)}</b></div>
        <div><span>Dépenses</span><b>{eur(kpi.expense)}</b></div>
        <div><span>Solde</span><b className={kpi.net >= 0 ? 'pos' : ''}>{eur(kpi.net)}</b></div>
      </div>
      {todo > 0 && (
        <div className="warn">{todo} opération{todo > 1 ? 's' : ''} à catégoriser. <Link href="/transactions?todo=1">Catégoriser</Link></div>
      )}

      <div className="chips" aria-label="Filtrer les dépenses par catégorie">
        {FILTER_CATS.map((c) => (
          <button key={c} className={'chip' + (cats.includes(c) ? ' on' : '')} onClick={() => toggle(c)}>{c}</button>
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
            {tab === 'flux' && <FlowSankey data={sankey(rows, alloc)} />}
            {tab === 'flux' && scope === 'perso' && pd.pots.length > 0 && !alloc && (
              <p className="hint">Pour voir l’excédent réparti par pots : coche « Exclure les dépenses payées par un pot » et clôture les mois concernés.</p>
            )}
            {tab === 'evolution' && <TrendLines data={trend.data} series={trend.series} />}
            {tab === 'tableau' && <PivotTable data={pivot(rows)} />}
          </>
        )}
      </div>
    </>
  );
}
