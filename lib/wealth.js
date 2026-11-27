import { getSupabase } from './supabase.js';
import { fetchAll } from './data.js';

export const TYPES = ['Compte courant', 'Livret', 'Fonds euros', 'Assurance-vie', 'PER', 'ETF', 'Action', 'Obligation', 'Crypto', 'Immobilier', 'Autre'];
export const KINDS = ['Courant', 'Épargne', 'Investissement'];
export const TYPE_KIND = { 'Compte courant': 'Courant', 'Livret': 'Épargne', 'Fonds euros': 'Épargne' };
export const kindForType = (t) => TYPE_KIND[t] || 'Investissement';
export const guessType = (name) => (/etf|ucits|lyxor|amundi|ishares|xtrackers|msci|s&p ?500|nasdaq|vanguard|spdr|\bworld\b/i.test(name) ? 'ETF' : 'Action');
export const CLASSES = ['Liquidité', 'Actions', 'Obligations', 'Immobilier', 'Alternatif'];
export const TYPE_CLASS = {
  'Compte courant': 'Liquidité', 'Livret': 'Liquidité', 'Fonds euros': 'Liquidité', 'Assurance-vie': 'Actions', 'PER': 'Actions',
  'ETF': 'Actions', 'Action': 'Actions', 'Obligation': 'Obligations', 'Crypto': 'Alternatif', 'Immobilier': 'Immobilier', 'Autre': 'Alternatif',
};
export const RANGES = [['1S', '1 sem.'], ['1M', '1 mois'], ['3M', '3 mois'], ['6M', '6 mois'], ['YTD', 'YTD'], ['1A', '1 an'], ['ALL', 'Tout']];

export const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const fmtPct = (p) => (p == null ? '' : `${p >= 0 ? '+' : ''}${p.toFixed(1).replace('.', ',')} %`);
const isoToday = () => new Date().toISOString().slice(0, 10);

export async function loadAssets() {
  const { data, error } = await getSupabase().from('assets').select('*').order('created_at');
  if (error) throw error;
  return data;
}
export const loadValues = () =>
  fetchAll((a, b) => getSupabase().from('asset_values').select('*').order('date').order('id').range(a, b));

// { asset_id: [{id, date, value}] } trié par date croissante (l'entrée doit être triée par date).
export function groupValues(values) {
  const g = {};
  for (const v of values) {
    if (!g[v.asset_id]) g[v.asset_id] = [];
    g[v.asset_id].push({ id: v.id, date: v.date, value: Number(v.value) });
  }
  return g;
}

// Dernière valeur connue <= date (report en avant), sinon null.
export function valueAt(list, date) {
  let out = null;
  for (const p of list || []) { if (p.date <= date) out = p; else break; }
  return out ? out.value : null;
}
export function latest(g) {
  const o = {};
  for (const [id, list] of Object.entries(g)) if (list.length) o[id] = list[list.length - 1];
  return o;
}
export const totalAt = (assets, g, date) => r2(assets.reduce((s, a) => s + (valueAt(g[a.id], date) || 0), 0));

export function rangeStart(range, firstDate, today = isoToday()) {
  if (range === 'ALL') return firstDate;
  const [y, m, d] = today.split('-').map(Number);
  const U = Date.UTC;
  const t = { '1S': U(y, m - 1, d - 7), '1M': U(y, m - 2, d), '3M': U(y, m - 4, d), '6M': U(y, m - 7, d), 'YTD': U(y, 0, 1), '1A': U(y - 1, m - 1, d) }[range];
  return new Date(t).toISOString().slice(0, 10);
}

// Points = début de période, aujourd'hui et chaque date de relevé entre les deux (valeurs reportées en avant).
export function wealthSeries(assets, g, range, today = isoToday()) {
  const dates = new Set();
  for (const a of assets) for (const p of g[a.id] || []) dates.add(p.date);
  if (!dates.size) return [];
  const sorted = [...dates].sort();
  let start = rangeStart(range, sorted[0], today);
  if (start < sorted[0]) start = sorted[0];
  const pts = new Set([start, today > start ? today : start]);
  for (const d of sorted) if (d > start && d < today) pts.add(d);
  return [...pts].sort().map((date) => ({ date, total: totalAt(assets, g, date) }));
}

export function breakdown(assets, lat, by) {
  const m = new Map();
  for (const a of assets) {
    const v = lat[a.id] ? lat[a.id].value : 0;
    if (v <= 0) continue;
    const k = { asset: a.name, type: a.asset_type, class: a.asset_class, kind: a.kind || a.account_kind || 'Investissement', holder: a.envelope || a.holder || 'Sans enveloppe', bank: a.bank || 'Sans banque', account: a.accountName || 'Sans compte' }[by];
    m.set(k, (m.get(k) || 0) + v);
  }
  return [...m].map(([name, value]) => ({ name, value: r2(value) })).sort((a, b) => b.value - a.value);
}

export function gainOf(asset, value) {
  if (!asset.invested || Number(asset.invested) <= 0 || value == null) return null;
  const inv = Number(asset.invested);
  return { abs: r2(value - inv), pct: ((value - inv) / inv) * 100 };
}
export function portfolioGain(assets, lat) {
  let base = 0, val = 0;
  for (const a of assets) {
    const v = lat[a.id] ? lat[a.id].value : null;
    if (gainOf(a, v)) { base += Number(a.invested); val += v; }
  }
  return base > 0 ? { abs: r2(val - base), pct: ((val - base) / base) * 100 } : null;
}

// rows = [{label, start, rate (% annuel), monthly}] ; versements en fin de mois, taux mensuel équivalent.
export function project(rows, years, inflation = 0) {
  const st = rows.map((r) => ({ v: r.start, c: r.start, g: Math.pow(1 + r.rate / 100, 1 / 12) - 1 }));
  const data = [];
  const push = (year) => {
    const o = { year, total: r2(st.reduce((s, x) => s + x.v, 0)), invested: r2(st.reduce((s, x) => s + x.c, 0)) };
    rows.forEach((r, i) => { o[`r${i}`] = r2(st[i].v); });
    data.push(o);
  };
  push(0);
  for (let m = 1; m <= years * 12; m++) {
    rows.forEach((r, i) => { st[i].v = st[i].v * (1 + st[i].g) + r.monthly; st[i].c += r.monthly; });
    if (m % 12 === 0) push(m / 12);
  }
  const last = data[data.length - 1];
  return {
    data, final: last.total, invested: last.invested, gain: r2(last.total - last.invested),
    real: r2(last.total / Math.pow(1 + inflation / 100, years)),
  };
}

// Ajoute à chaque actif les propriétés héritées de son compte (type de compte, enveloppe, banque).
export function enrichAssets(assets, accounts) {
  const by = Object.fromEntries(accounts.map((a) => [a.id, a]));
  return assets.map((a) => {
    const acc = a.account_id ? by[a.account_id] : null;
    return {
      ...a, account: acc || null,
      kind: (acc && acc.account_kind) || a.account_kind || 'Investissement',
      envelope: (acc && acc.envelope) || a.holder || 'Sans enveloppe',
      bank: (acc && acc.bank) || '',
      accountName: acc ? acc.name : (a.holder || 'Sans compte'),
    };
  });
}

export function monthAgoDate(today = isoToday()) {
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, d)).toISOString().slice(0, 10);
}

// Valeur d'un compte à une date : somme de ses actifs, sinon dernier solde importé connu.
export function accountValue(acc, assets, g, hist, date) {
  const linked = assets.filter((a) => a.account_id === acc.id);
  if (linked.length) {
    const vals = linked.map((a) => valueAt(g[a.id], date));
    if (!vals.every((v) => v === null)) return r2(vals.reduce((s, v) => s + (v || 0), 0));
  }
  return valueAt(hist[acc.id], date);
}
