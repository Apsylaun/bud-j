'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '../../lib/supabase.js';
import { loadAccounts, loadTransactions } from '../../lib/data.js';
import {
  loadPots, loadEntries, loadPotMonths, ensureDefaultPots, rpc, ownBalances, buildTree, flatNodes,
  fundedByTx, monthBounds, lastMonths, monthSurplus, balanceSeries, KIND_LABEL, r2,
} from '../../lib/pots.js';
import { eur, dateFr, monthLabel } from '../../lib/format.js';
import { colorOf } from '../../lib/categories.js';
import { Seg } from '../../components/Filters.js';
import { TrendLines } from '../../components/Charts.js';
import { loadAssets, loadValues, groupValues, latest } from '../../lib/wealth.js';

const TABS = [['vue', 'Vue'], ['mois', 'Mois'], ['mouvements', 'Mouvements'], ['gerer', 'Gérer']];
const num = (s) => Number(String(s).replace(',', '.')) || 0;

export default function Pots() {
  const [tab, setTab] = useState('vue');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  const reload = useCallback(async () => {
    try {
      const [pots, entries, months, accounts, w] = await Promise.all([
        loadPots(), loadEntries(), loadPotMonths(), loadAccounts(),
        Promise.all([loadAssets(), loadValues()]).catch(() => null),
      ]);
      let liquid = null;
      if (w && w[0].length) {
        const lat = latest(groupValues(w[1]));
        liquid = r2(w[0].filter((a) => a.asset_class === 'Liquidité').reduce((s, a) => s + (lat[a.id] ? lat[a.id].value : 0), 0));
      }
      setD({ pots, entries, months, accounts, liquid }); setErr('');
    } catch (e) {
      setErr(/schema cache|does not exist/i.test(e.message || '') ? 'Tables absentes : exécute supabase/002_pots.sql dans Supabase.' : e.message);
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const own = useMemo(() => (d ? ownBalances(d.entries) : {}), [d]);
  const tree = useMemo(() => (d ? buildTree(d.pots, own) : []), [d, own]);

  if (err) return <><h1>Pots</h1><p className="err">{err}</p></>;
  if (!d) return <><h1>Pots</h1><p className="muted">Chargement…</p></>;
  if (d.pots.length === 0) {
    return (
      <>
        <h1>Pots</h1>
        <p>Aucun pot. Crée les pots par défaut (Voyage, Investissement, Plaisir, Don/valeur, Impots, Imprévu, Reste), tu pourras en ajouter ou renommer ensuite.</p>
        <button className="btn" onClick={async () => { try { await ensureDefaultPots(); reload(); } catch (e) { setErr(e.message); } }}>Créer les pots par défaut</button>
      </>
    );
  }
  return (
    <>
      <h1>Pots</h1>
      <Seg value={tab} onChange={setTab} options={TABS} />
      <div style={{ marginTop: 16 }}>
        {tab === 'vue' && <ViewTab d={d} tree={tree} />}
        {tab === 'mois' && <MonthTab d={d} tree={tree} reload={reload} />}
        {tab === 'mouvements' && <MovesTab d={d} tree={tree} reload={reload} />}
        {tab === 'gerer' && <ManageTab d={d} tree={tree} reload={reload} />}
      </div>
    </>
  );
}

function Detail({ pot, entries }) {
  const list = entries.filter((e) => e.pot_id === pot.id).sort((a, b) => b.date.localeCompare(a.date));
  const sum = (f) => r2(list.filter(f).reduce((s, e) => s + Number(e.amount), 0));
  if (!list.length) return <p className="muted">Aucun mouvement.</p>;
  return (
    <div className="detail">
      <p className="hint">
        Alimenté : allocations {eur(sum((e) => e.kind === 'alloc' && e.amount > 0))}, reçu {eur(sum((e) => e.kind === 'transfer' && e.amount > 0))}, solde initial {eur(sum((e) => e.kind === 'opening'))}.
        {' '}Sorti : dépenses {eur(-sum((e) => e.kind === 'spend'))}, envoyé {eur(-sum((e) => e.kind === 'transfer' && e.amount < 0))}.
      </p>
      {list.slice(0, 15).map((e) => (
        <div className="item" key={e.id}>
          <span>
            {dateFr(e.date)} {KIND_LABEL[e.kind]}
            <span className="muted"> {e.kind === 'alloc' ? monthLabel(e.month) : e.note || ''}</span>
          </span>
          <span className={'amt' + (e.amount > 0 ? ' pos' : '')}>{eur(e.amount, 2)}</span>
        </div>
      ))}
      {list.length > 15 && <p className="muted">… {list.length - 15} mouvements plus anciens.</p>}
    </div>
  );
}

function PotLine({ pot, balance, open, onToggle, entries, indent }) {
  const pct = pot.target ? Math.max(0, Math.min(100, (balance / pot.target) * 100)) : null;
  return (
    <>
      <button className={'potline' + (indent ? ' kid' : '')} onClick={onToggle} aria-expanded={open}>
        <span className="dot" style={{ background: colorOf(pot.name) }} />
        <span className="pname">{pot.name}</span>
        <b className={balance < 0 ? 'neg' : ''}>{eur(balance, 2)}</b>
        {pct !== null && (
          <span className="track" title={`Objectif ${eur(pot.target)}`}><span style={{ width: `${pct}%`, background: colorOf(pot.name) }} /></span>
        )}
      </button>
      {balance < 0 && <p className="warn">Pot en découvert : réajuste une allocation passée (onglet Mois) ou déplace des fonds.</p>}
      {open && <Detail pot={pot} entries={entries} />}
    </>
  );
}

function ViewTab({ d, tree }) {
  const [open, setOpen] = useState({});
  const total = r2(tree.reduce((s, m) => s + m.total, 0));
  const nodes = flatNodes(tree);
  const negatives = nodes.filter((n) => n.balance < 0).length;
  const last = d.months.find((m) => m.closed);
  const series = useMemo(() => balanceSeries(tree, d.entries), [tree, d.entries]);
  const lines = [...tree.map((m) => ({ key: m.name, label: m.name, color: colorOf(m.name) })), { key: 'Total', label: 'Total', color: '#14231F', dash: '5 4' }];
  const tog = (id) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  return (
    <>
      <div className="strip">
        <div><span>Total des pots</span><b>{eur(total)}</b></div>
        <div><span>{last ? `Clôturé ${monthLabel(last.month)}` : 'Dernier mois clôturé'}</span><b>{last ? eur(last.surplus) : '–'}</b></div>
        <div><span>Pots en négatif</span><b className={negatives ? 'neg' : ''}>{negatives}</b></div>
      </div>
      {d.liquid !== null && (
        <p className={'hint' + (d.liquid - total < 0 ? ' neg' : '')}>
          Liquidités du patrimoine : {eur(d.liquid)} · Liquidités − pots : {eur(d.liquid - total)}.
          {d.liquid - total < 0 ? ' Les pots dépassent tes liquidités : vérifie les soldes saisis.' : ' Les pots sont virtuels : cet écart est l’argent non affecté.'}
        </p>
      )}
      <h2>Évolution</h2>
      <div className="panel"><TrendLines data={series} series={lines} /></div>
      <h2>Pots</h2>
      <div className="list">
        {tree.map((m) => (
          <div className="potgroup" key={m.id}>
            <PotLine pot={m} balance={m.total} open={!!open[m.id]} onToggle={() => tog(m.id)} entries={d.entries} />
            {m.kids.length > 0 && m.own !== m.total && <p className="muted kidhint">dont {eur(m.own, 2)} non affectés à un sous-pot</p>}
            {m.kids.map((k) => (
              <PotLine key={k.id} indent pot={k} balance={k.balance} open={!!open[k.id]} onToggle={() => tog(k.id)} entries={d.entries} />
            ))}
          </div>
        ))}
      </div>
      <p className="hint">Touche un pot pour voir ses sources d’alimentation et ses sorties. Un sous-pot s’alimente depuis l’onglet Mouvements.</p>
    </>
  );
}

function MonthTab({ d, tree, reload }) {
  const months = useMemo(() => lastMonths(24), []);
  const [month, setMonth] = useState(months[1]);
  const [txs, setTxs] = useState([]);
  const [pcts, setPcts] = useState({});
  const [base, setBase] = useState('now');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const row = d.months.find((m) => m.month === month);
  const byId = useMemo(() => Object.fromEntries(d.accounts.map((a) => [a.id, a])), [d.accounts]);
  const funded = useMemo(() => fundedByTx(d.entries), [d.entries]);

  useEffect(() => {
    let off = false;
    const { from, to } = monthBounds(month);
    loadTransactions({ from, to, select: 'id,account_id,date,amount,category' })
      .then((t) => { if (!off) setTxs(t); }).catch((e) => { if (!off) setMsg(e.message); });
    return () => { off = true; };
  }, [month]);

  useEffect(() => {
    const prev = d.months.filter((m) => m.month < month).sort((a, b) => b.month.localeCompare(a.month))[0];
    setPcts((row && row.pcts) || (prev && prev.pcts) || {});
    setBase('now'); setMsg('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, d.months]);

  const cur = monthSurplus(txs, byId, funded);
  const snapDiffers = row && row.surplus !== null && Math.abs(Number(row.surplus) - cur.net) > 0.005;
  const surplus = snapDiffers && base === 'snap' ? Number(row.surplus) : cur.net;
  const mains = tree.filter((m) => m.role !== 'rest');
  const rest = tree.find((m) => m.role === 'rest');
  const sumPct = mains.reduce((s, m) => s + num(pcts[m.id] ?? 0), 0);
  const restPct = r2(100 - sumPct);
  const clean = Object.fromEntries(mains.map((m) => [m.id, num(pcts[m.id] ?? 0)]).filter(([, v]) => v > 0));

  async function run(fn, args, ok) {
    setBusy(true); setMsg('');
    try { await rpc(fn, args); setMsg(ok); await reload(); } catch (e) { setMsg(e.message); }
    setBusy(false);
  }

  return (
    <>
      <div className="form">
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mois">
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}{d.months.find((x) => x.month === m && x.closed) ? ' ✓' : ''}</option>)}
        </select>
        <span className="muted">{row && row.closed ? 'Clôturé' : 'Non clôturé'}</span>
      </div>
      <p className="hint">Excédent = revenus − dépenses de tes comptes perso (virements vers le commun inclus), hors dépenses payées par un pot. ✓ = mois clôturé.</p>

      <div className="strip">
        <div><span>Revenus</span><b>{eur(cur.income)}</b></div>
        <div><span>Dépenses</span><b>{eur(cur.expense)}</b></div>
        <div><span>Excédent</span><b className={cur.net >= 0 ? 'pos' : 'neg'}>{eur(cur.net)}</b></div>
      </div>
      {cur.todo > 0 && <div className="warn">{cur.todo} opération{cur.todo > 1 ? 's' : ''} non catégorisée{cur.todo > 1 ? 's' : ''} ce mois : l’excédent est approximatif. <Link href="/transactions?todo=1">Catégoriser</Link></div>}
      {snapDiffers && (
        <div className="form" style={{ margin: '12px 0' }}>
          <span className="muted">Excédent clôturé : {eur(row.surplus, 2)} · actuel : {eur(cur.net, 2)}. Base du recalcul :</span>
          <select value={base} onChange={(e) => setBase(e.target.value)}>
            <option value="now">actuel ({eur(cur.net)})</option>
            <option value="snap">clôturé ({eur(row.surplus)})</option>
          </select>
        </div>
      )}

      <h2>Répartition</h2>
      {surplus < 0 ? (
        <p className="warn">Déficit de {eur(-surplus, 2)} : il sera débité du pot Imprévu. Les pourcentages ne s’appliquent pas.</p>
      ) : null}
      {mains.map((m) => (
        <div className="item" key={m.id}>
          <span><i className="dot" style={{ background: colorOf(m.name) }} /> {m.name}</span>
          <span className="form">
            <span className="muted">{surplus > 0 ? eur((surplus * num(pcts[m.id] ?? 0)) / 100, 2) : ''}</span>
            <input type="text" inputMode="decimal" className="num" value={pcts[m.id] ?? ''} placeholder="0"
              onChange={(e) => setPcts({ ...pcts, [m.id]: e.target.value })} aria-label={`Pourcentage ${m.name}`} /> %
          </span>
        </div>
      ))}
      {rest && (
        <div className="item">
          <span><i className="dot" style={{ background: colorOf(rest.name) }} /> {rest.name} <span className="muted">(le solde)</span></span>
          <span className={restPct < 0 ? 'neg' : ''}>{surplus > 0 ? eur((surplus * Math.max(restPct, 0)) / 100, 2) + ' · ' : ''}{restPct} %</span>
        </div>
      )}
      {restPct < 0 && <p className="err">Le total dépasse 100 %.</p>}
      {msg && <div className="warn">{msg}</div>}
      <div className="form" style={{ marginTop: 12 }}>
        <button className="btn" disabled={busy || restPct < 0} onClick={() => run('close_pot_month', { p_month: month, p_surplus: r2(surplus), p_pcts: clean }, row && row.closed ? 'Mois recalculé.' : 'Mois clôturé.')}>
          {row && row.closed ? 'Recalculer et enregistrer' : 'Clôturer le mois'}
        </button>
        {row && row.closed && <button className="btn ghost" disabled={busy} onClick={() => run('reopen_pot_month', { p_month: month }, 'Mois rouvert, allocations retirées.')}>Rouvrir</button>}
      </div>
      <p className="hint">Pour réajuster une allocation passée : choisis le mois, modifie les %, puis « Recalculer et enregistrer ». Les soldes de tous les pots sont mis à jour.</p>
    </>
  );
}

function MovesTab({ d, tree, reload }) {
  const nodes = useMemo(() => flatNodes(tree), [tree]);
  const [mv, setMv] = useState({ from: '', to: '', amount: '', note: '' });
  const [open, setOpen] = useState({});
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const o = {};
    for (const e of d.entries) if (e.kind === 'opening') o[e.pot_id] = String(e.amount);
    setOpen(o);
  }, [d.entries]);

  const from = nodes.find((n) => n.id === mv.from);
  const after = from ? r2(from.balance - num(mv.amount)) : null;

  async function move(e) {
    e.preventDefault(); setBusy(true); setMsg('');
    try {
      await rpc('move_between_pots', { p_from: mv.from, p_to: mv.to, p_amount: num(mv.amount), p_note: mv.note || null });
      setMv({ from: '', to: '', amount: '', note: '' }); setMsg('Mouvement enregistré.'); await reload();
    } catch (err) { setMsg(err.message); }
    setBusy(false);
  }
  async function saveOpening() {
    setBusy(true); setMsg('');
    try {
      await rpc('set_pot_opening', { p_date: date, p_balances: nodes.map((n) => ({ pot_id: n.id, amount: num(open[n.id] ?? 0) })) });
      setMsg('Soldes initiaux enregistrés.'); await reload();
    } catch (err) { setMsg(err.message); }
    setBusy(false);
  }

  return (
    <>
      {msg && <div className="warn">{msg}</div>}
      <h2>Déplacer des fonds</h2>
      <form className="form" onSubmit={move}>
        <select value={mv.from} onChange={(e) => setMv({ ...mv, from: e.target.value })} required aria-label="Depuis">
          <option value="">Depuis…</option>
          {nodes.map((n) => <option key={n.id} value={n.id}>{n.label} ({eur(n.balance)})</option>)}
        </select>
        <select value={mv.to} onChange={(e) => setMv({ ...mv, to: e.target.value })} required aria-label="Vers">
          <option value="">Vers…</option>
          {nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
        <input type="text" inputMode="decimal" className="num" placeholder="Montant" value={mv.amount} onChange={(e) => setMv({ ...mv, amount: e.target.value })} required />
        <input type="text" placeholder="Note (optionnel)" value={mv.note} onChange={(e) => setMv({ ...mv, note: e.target.value })} />
        <button className="btn" disabled={busy}>Déplacer</button>
      </form>
      {after !== null && after < 0 && <p className="warn">« {from.label} » passera à {eur(after, 2)}.</p>}
      <p className="hint">Pot → sous-pot : réserve une part d’un pot pour un projet (un voyage précis, un placement). Le total du pot ne change pas.</p>

      <h2>Soldes initiaux</h2>
      <div className="form">
        <label className="muted" htmlFor="od">Date d’ouverture</label>
        <input id="od" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      {nodes.map((n) => (
        <div className="item" key={n.id}>
          <span>{n.label}</span>
          <input type="text" inputMode="decimal" className="num" placeholder="0" value={open[n.id] ?? ''} onChange={(e) => setOpen({ ...open, [n.id]: e.target.value })} aria-label={`Solde initial ${n.label}`} />
        </div>
      ))}
      <p><button className="btn" disabled={busy} onClick={saveOpening}>Enregistrer les soldes initiaux</button></p>
    </>
  );
}

function ManageTab({ d, tree, reload }) {
  const [f, setF] = useState({ name: '', parent: '', target: '' });
  const [msg, setMsg] = useState('');
  const sb = getSupabase();
  const hasEntries = (id) => d.entries.some((e) => e.pot_id === id);

  async function attempt(fn) {
    setMsg('');
    try { const { error } = await fn(); if (error) throw error; await reload(); } catch (e) { setMsg(e.message); }
  }
  const add = (e) => {
    e.preventDefault();
    attempt(async () => {
      const r = await sb.from('pots').insert({ name: f.name.trim(), parent_id: f.parent || null, target: f.target ? num(f.target) : null, sort: d.pots.length });
      if (!r.error) setF({ name: '', parent: '', target: '' });
      return r;
    });
  };
  const rename = (p) => { const n = window.prompt('Nouveau nom :', p.name); if (n && n.trim()) attempt(() => sb.from('pots').update({ name: n.trim() }).eq('id', p.id)); };
  const goal = (p) => {
    const v = window.prompt('Objectif en € (vide = aucun) :', p.target ?? '');
    if (v !== null) attempt(() => sb.from('pots').update({ target: v.trim() ? num(v) : null }).eq('id', p.id));
  };
  const del = (p, kids) => {
    const warn = hasEntries(p.id) || kids ? ' Son historique (et celui de ses sous-pots) sera perdu.' : '';
    if (window.confirm(`Supprimer « ${p.name} » ?${warn}`)) attempt(() => sb.from('pots').delete().eq('id', p.id));
  };
  const row = (p, kids, indent) => (
    <div className={'item' + (indent ? ' kid' : '')} key={p.id}>
      <span>{p.name}{p.role === 'rest' && <span className="badge">absorbe l’écart</span>}{p.role === 'deficit' && <span className="badge">absorbe les déficits</span>}{p.target ? <span className="badge">objectif {eur(p.target)}</span> : null}</span>
      <span className="form">
        <button className="btn ghost" onClick={() => rename(p)}>Renommer</button>
        <button className="btn ghost" onClick={() => goal(p)}>Objectif</button>
        {!p.role && <button className="btn danger" onClick={() => del(p, kids)}>Supprimer</button>}
      </span>
    </div>
  );

  return (
    <>
      {msg && <div className="warn">{msg}</div>}
      <h2>Pots et sous-pots</h2>
      {tree.map((m) => (
        <div key={m.id}>{row(m, m.kids.length > 0, false)}{m.kids.map((k) => row(k, false, true))}</div>
      ))}
      <h2>Ajouter</h2>
      <form className="form" onSubmit={add}>
        <input type="text" placeholder="Nom" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        <select value={f.parent} onChange={(e) => setF({ ...f, parent: e.target.value })} aria-label="Rattaché à">
          <option value="">Pot principal</option>
          {tree.map((m) => <option key={m.id} value={m.id}>Sous-pot de {m.name}</option>)}
        </select>
        <input type="text" inputMode="decimal" className="num" placeholder="Objectif €" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} />
        <button className="btn">Ajouter</button>
      </form>
      <p className="hint">Seuls les pots principaux reçoivent une part de l’excédent mensuel. « Reste » et « Imprévu » sont obligatoires.</p>
    </>
  );
}
