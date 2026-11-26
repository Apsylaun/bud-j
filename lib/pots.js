import { getSupabase } from './supabase.js';
import { fetchAll } from './data.js';
import { summarize, totals, fillMonths } from './analytics.js';
import { staticColor, paletteColor } from './categories.js';

export const DEFAULT_POTS = [
  { name: 'Voyage' }, { name: 'Investissement' }, { name: 'Plaisir' }, { name: 'Don/valeur' },
  { name: 'Impots' }, { name: 'Imprévu', role: 'deficit' }, { name: 'Reste', role: 'rest' },
];
export const KIND_LABEL = { opening: 'Solde initial', alloc: 'Allocation', spend: 'Dépense', transfer: 'Entre pots' };
export const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const sb = () => getSupabase();

export async function loadPots() {
  const { data, error } = await sb().from('pots').select('*').order('sort').order('created_at');
  if (error) throw error;
  return data;
}
export const loadEntries = () =>
  fetchAll((a, b) => sb().from('pot_entries').select('*').order('date').order('id').range(a, b));
export async function loadPotMonths() {
  const { data, error } = await sb().from('pot_months').select('*').order('month', { ascending: false });
  if (error) throw error;
  return data;
}
export async function ensureDefaultPots() {
  const { error } = await sb().from('pots').insert(DEFAULT_POTS.map((p, i) => ({ ...p, sort: i })));
  if (error) throw error;
}
export async function rpc(fn, args) {
  const { error } = await sb().rpc(fn, args);
  if (error) throw error;
}

export function ownBalances(entries) {
  const b = {};
  for (const e of entries) b[e.pot_id] = (b[e.pot_id] || 0) + Number(e.amount);
  return b;
}

// Pots principaux avec sous-pots ; total = solde propre + sous-pots.
export const potColor = (p, i = 0) => p.color || staticColor(p.name) || paletteColor(i);

export function buildTree(pots, own) {
  const idx = new Map(pots.map((p, i) => [p.id, i]));
  return pots.filter((p) => !p.parent_id).map((p) => {
    const kids = pots.filter((k) => k.parent_id === p.id).map((k) => ({ ...k, color: potColor(k, idx.get(k.id)), balance: r2(own[k.id] || 0) }));
    const mine = r2(own[p.id] || 0);
    return { ...p, color: potColor(p, idx.get(p.id)), own: mine, kids, total: r2(mine + kids.reduce((s, k) => s + k.balance, 0)) };
  });
}

export function flatNodes(tree) {
  return tree.flatMap((m) => [
    { id: m.id, label: m.name, balance: m.own },
    ...m.kids.map((k) => ({ id: k.id, label: `${m.name} › ${k.name}`, balance: k.balance })),
  ]);
}

// Montant payé par des pots, par opération (positif).
export function fundedByTx(entries) {
  const f = {};
  for (const e of entries) if (e.kind === 'spend' && e.transaction_id) f[e.transaction_id] = r2((f[e.transaction_id] || 0) - Number(e.amount));
  return f;
}

export function monthBounds(m) {
  const [y, mo] = m.split('-').map(Number);
  return { from: `${m}-01`, to: new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10) };
}

export function lastMonths(n) {
  const d = new Date();
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(d.getFullYear(), d.getMonth() - i, 1)).toISOString().slice(0, 7));
}

// Excédent perso du mois = revenus - dépenses, hors part payée par les pots.
export function monthSurplus(txs, accountsById, funded) {
  const rows = summarize(txs, accountsById, 'perso', null, funded);
  const t = totals(rows);
  const todo = txs.filter((x) => !x.category && accountsById[x.account_id] && !accountsById[x.account_id].shared).length;
  return { income: r2(t.income), expense: r2(t.expense), net: r2(t.net), todo };
}

// Solde de fin de mois de chaque pot principal (sous-pots inclus) + total.
export function balanceSeries(tree, entries) {
  const parentOf = {};
  for (const m of tree) { parentOf[m.id] = m.id; for (const k of m.kids) parentOf[k.id] = m.id; }
  const delta = {}, months = [new Date().toISOString().slice(0, 7)];
  for (const e of entries) {
    const mo = e.date.slice(0, 7), main = parentOf[e.pot_id];
    months.push(mo);
    if (!main) continue;
    if (!delta[mo]) delta[mo] = {};
    delta[mo][main] = (delta[mo][main] || 0) + Number(e.amount);
  }
  const run = {};
  return fillMonths(months).map((month) => {
    const o = { month, Total: 0 };
    for (const m of tree) {
      run[m.id] = (run[m.id] || 0) + ((delta[month] && delta[month][m.id]) || 0);
      o[m.name] = r2(run[m.id]);
      o.Total += run[m.id];
    }
    o.Total = r2(o.Total);
    return o;
  });
}

// Répartition par pots de l'excédent d'une période, si tous ses mois sont clôturés.
export function allocBreakdown(months, potMonths, entries, pots) {
  if (!months.length) return null;
  const closed = new Set(potMonths.filter((m) => m.closed).map((m) => m.month));
  if (!months.every((m) => closed.has(m))) return null;
  const names = Object.fromEntries(pots.map((p) => [p.id, p.name]));
  const by = {};
  for (const e of entries) if (e.kind === 'alloc' && months.includes(e.month)) by[e.pot_id] = (by[e.pot_id] || 0) + Number(e.amount);
  const out = Object.entries(by).map(([id, v]) => ({ name: names[id] || 'Pot', value: r2(v) }));
  if (out.some((x) => x.value < 0)) return null;
  return out.filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
}

// Sous-objectif qui reçoit par défaut les versements d'un pot : échéance la plus proche (>= date), objectif non atteint.
// Même règle que pick_subgoal() côté base ; month exclut les allocations de ce mois (recalcul).
export function pickSubgoal(kids, entries, date, month) {
  const bal = (id) => entries
    .filter((e) => e.pot_id === id && e.date <= date && !(e.kind === 'alloc' && month && e.month === month))
    .reduce((s, e) => s + Number(e.amount), 0);
  return kids
    .filter((k) => k.target_date && k.target_date >= date && (k.target == null || bal(k.id) < Number(k.target)))
    .sort((a, b) => a.target_date.localeCompare(b.target_date) || String(a.created_at).localeCompare(String(b.created_at)))[0] || null;
}

// Évolution d'un pot : total, part non affectée et chaque sous-objectif (solde cumulé de fin de mois).
export function potSeries(pot, entries) {
  const nodes = [{ id: pot.id, name: 'Non affecté' }, ...pot.kids.map((k) => ({ id: k.id, name: k.name }))];
  const ids = new Set(nodes.map((n) => n.id));
  const delta = {}, months = [new Date().toISOString().slice(0, 7)];
  for (const e of entries) {
    if (!ids.has(e.pot_id)) continue;
    const mo = e.date.slice(0, 7);
    months.push(mo);
    if (!delta[mo]) delta[mo] = {};
    delta[mo][e.pot_id] = (delta[mo][e.pot_id] || 0) + Number(e.amount);
  }
  const run = {};
  return fillMonths(months).map((month) => {
    const o = { month, Total: 0 };
    for (const n of nodes) {
      run[n.id] = (run[n.id] || 0) + ((delta[month] && delta[month][n.id]) || 0);
      o[n.name] = r2(run[n.id]);
      o.Total += run[n.id];
    }
    o.Total = r2(o.Total);
    return o;
  });
}
