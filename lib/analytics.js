import { INCOME, TRANSFER_COMMUN, TRANSFER_INTERNE, UNCATEGORIZED, kindOf } from './categories.js';

function kindFor(cat) {
  const k = kindOf(cat);
  if (k) return k;
  if (INCOME.includes(cat)) return 'income';
  if (cat === TRANSFER_COMMUN) return 'transfer_commun';
  if (cat === TRANSFER_INTERNE) return 'transfer_interne';
  return 'expense';
}

export const inScope = (account, scope) =>
  scope === 'consolide' || (scope === 'commun' ? account.shared : !account.shared);

// Règles comptables :
// - Transfert interne : ignoré partout.
// - Vir. compte commun : dépense en vue perso, revenu en vue commun, ignoré en consolidé (évite le double compte).
// - Salaire / Autre revenu : revenus. Tout autre catégorie : dépense (un crédit vient en déduction : remboursement).
// - Non catégorisé : sorties comptées en dépense ; entrées exclues tant qu'elles ne sont pas catégorisées.
export function classify(tx, scope, shared) {
  const cat = tx.category;
  const kind = cat ? kindFor(cat) : null;
  if (kind === 'transfer_interne') return null;
  if (kind === 'transfer_commun') {
    if (scope === 'consolide') return null;
    return shared
      ? { kind: 'income', category: cat, value: tx.amount }
      : { kind: 'expense', category: cat, value: -tx.amount };
  }
  if (kind === 'income') return { kind: 'income', category: cat, value: tx.amount };
  if (!cat) return tx.amount < 0 ? { kind: 'expense', category: UNCATEGORIZED, value: -tx.amount } : null;
  return { kind: 'expense', category: cat, value: -tx.amount };
}

// funded : { id_opération: montant payé par des pots } — retiré des dépenses si fourni.
export function summarize(txs, accountsById, scope, cats, funded) {
  const rows = [];
  for (const t of txs) {
    const a = accountsById[t.account_id];
    if (!a || !inScope(a, scope)) continue;
    const c = classify(t, scope, a.shared);
    if (!c) continue;
    if (funded && c.kind === 'expense' && t.amount < 0 && funded[t.id]) c.value = Math.max(0, c.value - funded[t.id]);
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

// Revenus (sources) -> « Revenus » -> groupes de catégories -> catégories ; l'excédent va aux pots (ou « Excédent »).
// groupOf(nom) donne le groupe d'une catégorie (null = pas de groupe). Un déficit est ajouté côté revenus.
export function sankey(rows, alloc, groupOf) {
  const inc = agg(rows, 'income').filter((x) => x.value > 0);
  const exp = agg(rows, 'expense').filter((x) => x.value > 0);
  if (!inc.length && !exp.length) return null;
  const ti = inc.reduce((s, x) => s + x.value, 0), te = exp.reduce((s, x) => s + x.value, 0);
  const names = [];
  const idx = (n) => { let i = names.indexOf(n); if (i < 0) { names.push(n); i = names.length - 1; } return i; };
  const links = [];
  const add = (s, t, v) => {
    if (v <= 0.004) return;
    const si = idx(s), ti2 = idx(t);
    const ex = links.find((l) => l.source === si && l.target === ti2);
    if (ex) ex.value += v; else links.push({ source: si, target: ti2, value: v });
  };
  idx('Revenus');

  for (const x of inc) add(x.name, 'Revenus', x.value);
  if (te > ti) add('Déficit', 'Revenus', te - ti);

  const gOf = (n) => { const g = groupOf ? groupOf(n) : null; return g && g !== 'Revenus' ? g : null; };
  const groups = new Map(), direct = [];
  for (const x of exp) {
    const g = gOf(x.name);
    if (g) { if (!groups.has(g)) groups.set(g, []); groups.get(g).push(x); } else direct.push(x);
  }
  for (const [g, items] of groups) {
    add('Revenus', g, items.reduce((s, x) => s + x.value, 0));
    if (items.length === 1 && items[0].name === g) continue;
    for (const it of items) add(g, it.name, it.value);
  }
  for (const x of direct) add('Revenus', x.name, x.value);

  if (ti > te) {
    const s = ti - te;
    const rem = alloc && alloc.length ? s - alloc.reduce((a, x) => a + x.value, 0) : null;
    if (rem !== null && rem > -0.5) {
      add('Revenus', 'Pots', s - Math.max(rem, 0));
      for (const a of alloc) add('Pots', a.name, a.value);
      if (rem > 0.5) add('Revenus', 'Non réparti', rem);
    } else add('Revenus', 'Excédent', s);
  }
  return { nodes: names.map((name) => ({ name })), links };
}
