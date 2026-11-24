import { INCOME, TRANSFER_COMMUN, TRANSFER_INTERNE, UNCATEGORIZED } from './categories.js';

export const inScope = (account, scope) =>
  scope === 'consolide' || (scope === 'commun' ? account.shared : !account.shared);

// Règles comptables :
// - Transfert interne : ignoré partout.
// - Vir. compte commun : dépense en vue perso, revenu en vue commun, ignoré en consolidé (évite le double compte).
// - Salaire / Autre revenu : revenus. Tout autre catégorie : dépense (un crédit vient en déduction : remboursement).
// - Non catégorisé : sorties comptées en dépense ; entrées exclues tant qu'elles ne sont pas catégorisées.
export function classify(tx, scope, shared) {
  const cat = tx.category;
  if (cat === TRANSFER_INTERNE) return null;
  if (cat === TRANSFER_COMMUN) {
    if (scope === 'consolide') return null;
    return shared
      ? { kind: 'income', category: cat, value: tx.amount }
      : { kind: 'expense', category: cat, value: -tx.amount };
  }
  if (INCOME.includes(cat)) return { kind: 'income', category: cat, value: tx.amount };
  if (!cat) return tx.amount < 0 ? { kind: 'expense', category: UNCATEGORIZED, value: -tx.amount } : null;
  return { kind: 'expense', category: cat, value: -tx.amount };
}

export function summarize(txs, accountsById, scope, cats) {
  const rows = [];
  for (const t of txs) {
    const a = accountsById[t.account_id];
    if (!a || !inScope(a, scope)) continue;
    const c = classify(t, scope, a.shared);
    if (!c) continue;
    if (c.kind === 'expense' && cats && cats.size && !cats.has(c.category)) continue;
    rows.push({ ...c, month: t.date.slice(0, 7) });
  }
  return rows;
}

const sum = (list) => list.reduce((s, x) => s + x.value, 0);

export function totals(rows) {
  const income = sum(rows.filter((r) => r.kind === 'income'));
  const expense = sum(rows.filter((r) => r.kind === 'expense'));
  return { income, expense, net: income - expense };
}

export function agg(rows, kind) {
  const m = new Map();
  for (const r of rows) if (r.kind === kind) m.set(r.category, (m.get(r.category) || 0) + r.value);
  return [...m].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

export function fillMonths(keys) {
  if (!keys.length) return [];
  const s = [...new Set(keys)].sort();
  let [y, m] = s[0].split('-').map(Number);
  const [ey, em] = s[s.length - 1].split('-').map(Number);
  const out = [];
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

export function byMonth(rows) {
  return fillMonths(rows.map((r) => r.month)).map((month) => {
    const t = totals(rows.filter((r) => r.month === month));
    return { month, ...t };
  });
}

export function seriesByCategory(rows) {
  const ex = rows.filter((r) => r.kind === 'expense');
  const cats = [...new Set(ex.map((r) => r.category))];
  const data = fillMonths(ex.map((r) => r.month)).map((month) => {
    const o = { month };
    for (const c of cats) o[c] = ex.filter((r) => r.month === month && r.category === c).reduce((s, r) => s + r.value, 0);
    return o;
  });
  return { data, cats };
}

export function pivot(rows) {
  const months = fillMonths(rows.map((r) => r.month));
  const mk = (kind) => {
    const m = new Map();
    for (const r of rows) {
      if (r.kind !== kind) continue;
      const o = m.get(r.category) || { name: r.category, values: {}, total: 0 };
      o.values[r.month] = (o.values[r.month] || 0) + r.value;
      o.total += r.value;
      m.set(r.category, o);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  };
  const income = mk('income'), expense = mk('expense');
  const col = (list, mo) => list.reduce((s, o) => s + (o.values[mo] || 0), 0);
  const tot = { income: {}, expense: {}, net: {} };
  for (const mo of months) {
    tot.income[mo] = col(income, mo); tot.expense[mo] = col(expense, mo);
    tot.net[mo] = tot.income[mo] - tot.expense[mo];
  }
  const all = (k) => months.reduce((s, mo) => s + tot[k][mo], 0);
  return { months, income, expense, tot, grand: { income: all('income'), expense: all('expense'), net: all('net') } };
}

// Revenus (sources) -> hub "Revenus" -> catégories de dépenses + excédent (ou déficit en source).
export function sankey(rows) {
  const inc = agg(rows, 'income').filter((x) => x.value > 0);
  const exp = agg(rows, 'expense').filter((x) => x.value > 0);
  if (!inc.length && !exp.length) return null;
  const ti = inc.reduce((s, x) => s + x.value, 0), te = exp.reduce((s, x) => s + x.value, 0);
  const names = [];
  const idx = (n) => { let i = names.indexOf(n); if (i < 0) { names.push(n); i = names.length - 1; } return i; };
  const hub = idx('Revenus');
  const links = [];
  for (const x of inc) links.push({ source: idx(x.name), target: hub, value: x.value });
  if (te > ti) links.push({ source: idx('Déficit'), target: hub, value: te - ti });
  for (const x of exp) links.push({ source: hub, target: idx(x.name), value: x.value });
  if (ti > te) links.push({ source: hub, target: idx('Excédent'), value: ti - te });
  return { nodes: names.map((name) => ({ name })), links };
}
