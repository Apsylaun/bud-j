'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '../../lib/supabase.js';
import { loadAccounts, loadTransactions } from '../../lib/data.js';
import {
  loadPots, loadEntries, loadPotMonths, ensureDefaultPots, rpc, ownBalances, buildTree, flatNodes,
  fundedByTx, monthBounds, lastMonths, monthSurplus, balanceSeries, KIND_LABEL, r2, pickSubgoal, potSeries,
} from '../../lib/pots.js';
import { eur, dateFr, monthLabel } from '../../lib/format.js';
import { registerExtraColors } from '../../lib/categories.js';
import Colors from '../../components/Colors.js';
import PotModal from '../../components/PotModal.js';
import Term from '../../components/Term.js';
import { pushUndo, snapshotOf, onDataChange } from '../../lib/undo.js';
import { updateRow } from '../../lib/data.js';
import { Seg } from '../../components/Filters.js';
import PigBank from '../../components/PigBank.js';
import { TrendLines } from '../../components/Charts.js';
import { loadAssets, loadValues, groupValues, latest } from '../../lib/wealth.js';

const TABS = [['vue', 'Vue'], ['mois', 'Mois'], ['mouvements', 'Mouvements']];
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
      registerExtraColors(Object.fromEntries(pots.filter((x) => x.color).map((x) => [x.name, x.color])));
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
  useEffect(() => onDataChange(reload), [reload]);

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
        {tab === 'vue' && <ViewTab d={d} tree={tree} reload={reload} />}
        {tab === 'mois' && <MonthTab d={d} tree={tree} reload={reload} />}
        {tab === 'mouvements' && <MovesTab d={d} tree={tree} reload={reload} />}
      </div>
    </>
  );
}

const monthsLeft = (iso) => Math.max(1, Math.ceil((new Date(iso + 'T00:00:00Z') - new Date()) / (30.44 * 86400000)));

function goalInfo(pot, bal) {
  if (!pot.target) return pot.target_date ? `avant ${monthLabel(pot.target_date.slice(0, 7))}` : 'Sans objectif';
  const parts = [`${Math.max(0, Math.round((bal / pot.target) * 100))} % de ${eur(pot.target)}`];
  if (pot.target_date) {
    const late = new Date(pot.target_date + 'T00:00:00Z') < new Date();
    const missing = pot.target - bal;
    parts.push(late ? 'échéance dépassée' : `avant ${monthLabel(pot.target_date.slice(0, 7))}`);
    if (!late && missing > 0) parts.push(`≈ ${eur(missing / monthsLeft(pot.target_date))}/mois`);
  }
  return parts.join(' · ');
}

// Niveau de remplissage : part de l'objectif, ou taille relative au plus gros pot sans objectif.
const fillOf = (pot, maxBal) => (pot.total > 0 ? (pot.target ? pot.total / pot.target : maxBal > 0 ? pot.total / maxBal : 0) : 0);

function PigCard({ pot, maxBal, onOpen }) {
  const bal = pot.total;
  const pct = fillOf(pot, maxBal);
  return (
    <button className="pig" onClick={onOpen} aria-label={`Ouvrir le pot ${pot.name}`}>
      <PigBank fill={pct} color={pot.color} negative={bal < 0} label={`Pot ${pot.name}`} />
      <span className="pname">{pot.name}</span>
      <b className={bal < 0 ? 'neg' : ''}>{eur(bal)}</b>
      <small>{goalInfo(pot, bal)}</small>
      {pot.kids.length > 0 && <small>{pot.kids.length} sous-objectif{pot.kids.length > 1 ? 's' : ''}</small>}
    </button>
  );
}

function PotDetail({ pot, d, reload, onBack, maxBal }) {
  const [editKid, setEditKid] = useState(null);
  const [limit, setLimit] = useState(30);
  const [f, setF] = useState({ name: '', target: '', date: '' });
  const [msg, setMsg] = useState('');
  const kids = pot.kids;
  const names = useMemo(() => Object.fromEntries([[pot.id, 'Non affecté'], ...kids.map((k) => [k.id, k.name])]), [pot, kids]);
  const entries = useMemo(
    () => d.entries.filter((e) => names[e.pot_id]).sort((a, b) => b.date.localeCompare(a.date)),
    [d.entries, names]
  );
  const series = useMemo(() => potSeries(pot, d.entries), [pot, d.entries]);
  const next = pickSubgoal(kids, d.entries, new Date().toISOString().slice(0, 10), null);
  const kidsTotal = r2(kids.reduce((s, k) => s + k.balance, 0));
  const lines = [
    { key: 'Total', label: 'Total', color: pot.color },
    ...(kids.length ? [{ key: 'Non affecté', label: 'Non affecté', color: '#9AA0A6', dash: '5 4' }] : []),
    ...kids.map((k) => ({ key: k.name, label: k.name, color: k.color })),
  ];

  async function addKid(e) {
    e.preventDefault(); setMsg('');
    const { data, error } = await getSupabase().from('pots').insert({
      name: f.name.trim(), parent_id: pot.id, target: f.target ? num(f.target) : null,
      target_date: f.date || null, sort: d.pots.length,
    }).select('id').single();
    if (error) return setMsg(error.message);
    pushUndo('Ajout de sous-objectif', async () => { const r = await getSupabase().from('pots').delete().eq('id', data.id); if (r.error) throw r.error; });
    setF({ name: '', target: '', date: '' }); reload();
  }

  return (
    <>
      <button className="btn ghost sm" onClick={onBack}>← Tous les pots</button>
      <div className="potdetail-head">
        <PigBank fill={fillOf(pot, maxBal)} color={pot.color} negative={pot.total < 0} label={`Pot ${pot.name}`} />
        <div>
          <h2><i className="dot" style={{ background: pot.color }} /> {pot.name}</h2>
          <b className={'big' + (pot.total < 0 ? ' neg' : '')}>{eur(pot.total, 2)}</b>
          <span className="hint">{goalInfo(pot, pot.total)}</span>
        </div>
      </div>

      <h2>Contenu</h2>
      <div className="strip">
        <div><span>Total</span><b>{eur(pot.total)}</b></div>
        <div><span><Term k="nonaffecte">Non affecté</Term></span><b className={pot.own < 0 ? 'neg' : ''}>{eur(pot.own)}</b></div>
        <div><span><Term k="sousobjectif">Sous-objectifs</Term></span><b>{eur(kidsTotal)}</b></div>
      </div>

      <h2><Term k="sousobjectif">Sous-objectifs</Term></h2>
      {kids.length === 0 && <p className="muted">Aucun sous-objectif. Ajoutes-en un ci-dessous : il recevra les versements de ce pot jusqu’à son échéance.</p>}
      {[...kids].sort((a, b) => (a.target_date || '9').localeCompare(b.target_date || '9')).map((k) => (
        <div className="goalrow" key={k.id}>
          <div className="item" style={{ borderBottom: 0, paddingBottom: 2 }}>
            <span>
              {k.emoji ? <span style={{ fontSize: 16 }}>{k.emoji}</span> : <i className="dot" style={{ background: k.color }} />} {k.name}
              {next && next.id === k.id && <span className="badge">reçoit les prochains versements</span>}
            </span>
            <span className="form">
              <b className={k.balance < 0 ? 'neg' : ''}>{eur(k.balance, 2)}</b>
              <button className="btn ghost sm" onClick={() => setEditKid(k)}>Modifier</button>
            </span>
          </div>
          {k.target ? <div className="track2"><span style={{ width: `${Math.max(0, Math.min(100, (k.balance / k.target) * 100))}%`, background: k.color }} /></div> : null}
          <p className="hint" style={{ margin: '2px 0 4px' }}>{goalInfo(k, k.balance)}</p>
        </div>
      ))}
      <form className="form" onSubmit={addKid} style={{ marginTop: 10 }}>
        <input type="text" placeholder="Nouveau sous-objectif" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        <input type="text" inputMode="decimal" className="num" placeholder="Objectif €" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} />
        <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="Échéance" />
        <button className="btn">Ajouter</button>
      </form>
      {msg && <p className="err">{msg}</p>}
      <p className="hint">Chaque versement mensuel va au sous-objectif non atteint dont l’échéance est la plus proche ; sans sous-objectif éligible, il reste dans « Non affecté ».</p>

      {editKid && <PotModal pot={editKid} orig={d.pots.find((x) => x.id === editKid.id) || editKid} hasEntries={d.entries.some((e) => e.pot_id === editKid.id)} onClose={() => setEditKid(null)} onSaved={() => { setEditKid(null); reload(); }} />}

      <h2>Évolution</h2>
      <div className="panel"><TrendLines data={series} series={lines} /></div>

      <h2>Détails</h2>
      {entries.length === 0 && <p className="muted">Aucun mouvement.</p>}
      {entries.slice(0, limit).map((e) => (
        <div className="item" key={e.id}>
          <span>
            {dateFr(e.date)} {KIND_LABEL[e.kind]}
            <span className="muted"> {e.kind === 'alloc' ? monthLabel(e.month) : e.note || ''}</span>
            {kids.length > 0 && <span className="badge">{names[e.pot_id]}</span>}
          </span>
          <span className={'amt' + (e.amount > 0 ? ' pos' : '')}>{eur(e.amount, 2)}</span>
        </div>
      ))}
      {entries.length > limit && <button className="btn ghost more" onClick={() => setLimit((l) => l + 30)}>Afficher plus</button>}
    </>
  );
}

function ViewTab({ d, tree, reload }) {
  const [selId, setSelId] = useState(null);
  const [adding, setAdding] = useState(false);
  const sel = tree.find((m) => m.id === selId);
  const total = r2(tree.reduce((s, m) => s + m.total, 0));
  const nodes = flatNodes(tree);
  const negatives = nodes.filter((n) => n.balance < 0).length;
  const last = d.months.find((m) => m.closed);
  const series = useMemo(() => balanceSeries(tree, d.entries), [tree, d.entries]);
  const lines = [...tree.map((m) => ({ key: m.name, label: m.name, color: m.color })), { key: 'Total', label: 'Total', color: '#7A8FA6', dash: '5 4' }];
  const maxBal = Math.max(0, ...tree.map((m) => m.total));
  if (sel) return <PotDetail pot={sel} d={d} reload={reload} maxBal={maxBal} onBack={() => setSelId(null)} />;
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
      <div className="cardhead" style={{ marginTop: 28 }}>
        <h2 style={{ margin: 0 }}>Pots</h2>
        <button className="btn" onClick={() => setAdding(true)}>+ Ajouter un pot</button>
      </div>
      <div className="pigs">{tree.map((m) => <PigCard key={m.id} pot={m} maxBal={maxBal} onOpen={() => setSelId(m.id)} />)}</div>
      <p className="hint">Touche un pot pour voir son contenu, ses sous-objectifs, son évolution et ses mouvements. Remplissage : part de l’objectif, ou taille relative au plus gros pot sans objectif.</p>
      <h2>Évolution</h2>
      <div className="panel"><TrendLines data={series} series={lines} /></div>
      {adding && <PotModal pot={null} mains={tree} sortBase={d.pots.length} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
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

  const monthEnd = monthBounds(month).to;
  const subDest = (m) => pickSubgoal(m.kids, d.entries, monthEnd, month);
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
    try {
      const prev = row ? { closed: row.closed, surplus: row.surplus, pcts: row.pcts } : null;
      await rpc(fn, args);
      pushUndo(fn === 'close_pot_month' ? `Clôture de ${monthLabel(month)}` : `Réouverture de ${monthLabel(month)}`, async () => {
        if (prev && prev.closed) await rpc('close_pot_month', { p_month: month, p_surplus: Number(prev.surplus), p_pcts: prev.pcts });
        else await rpc('reopen_pot_month', { p_month: month });
      });
      setMsg(ok); await reload();
    } catch (e) { setMsg(e.message); }
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
        <div><span><Term k="excedent">Excédent</Term></span><b className={cur.net >= 0 ? 'pos' : 'neg'}>{eur(cur.net)}</b></div>
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
      <p className="hint">Déplace les curseurs : « Reste » prend le solde. Chaque part alimente d’abord le sous-objectif non atteint dont l’échéance est la plus proche (→).</p>
      {surplus < 0 ? (
        <p className="warn">Déficit de {eur(-surplus, 2)} : il sera débité du pot Imprévu. Les pourcentages ne s’appliquent pas.</p>
      ) : null}
      {mains.map((m) => {
        const val = num(pcts[m.id] ?? 0);
        const dest = subDest(m);
        return (
          <div className="sliderrow" key={m.id}>
            <span><i className="dot" style={{ background: m.color }} /> {m.name}{dest && <span className="muted"> → {dest.emoji ? `${dest.emoji} ` : ''}{dest.name}</span>}</span>
            <span className="muted">{surplus > 0 ? eur((surplus * val) / 100, 2) : ''}</span>
            <b>{val} %</b>
            <input type="range" min="0" max="100" step="0.5" value={val} aria-label={`Part ${m.name}`}
              onChange={(e) => setPcts({ ...pcts, [m.id]: Math.min(Number(e.target.value), val + Math.max(0, restPct)) })} />
          </div>
        );
      })}
      {rest && (
        <div className="item">
          <span><i className="dot" style={{ background: rest.color }} /> {rest.name} <span className="muted">(le solde)</span>{subDest(rest) && <span className="muted"> → {subDest(rest).emoji ? `${subDest(rest).emoji} ` : ''}{subDest(rest).name}</span>}</span>
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
      const mvd = { from: mv.from, to: mv.to, amount: num(mv.amount) };
      await rpc('move_between_pots', { p_from: mv.from, p_to: mv.to, p_amount: num(mv.amount), p_note: mv.note || null });
      pushUndo('Déplacement entre pots', () => rpc('move_between_pots', { p_from: mvd.to, p_to: mvd.from, p_amount: mvd.amount, p_note: 'Annulation' }));
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
      <p className="hint">Pot → sous-objectif : réserve une part d’un pot pour un sous-objectif (un voyage précis, un placement). Le total du pot ne change pas.</p>

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
