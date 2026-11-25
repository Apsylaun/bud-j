import { getSupabase } from './supabase.js';
import { makeCategorizer } from './rules.js';
import { DEFAULT_CATEGORIES, registerCategories } from './categories.js';

// PostgREST plafonne à 1000 lignes par requête : on pagine.
export async function fetchAll(build) {
  const size = 1000;
  let all = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await build(from, from + size - 1);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < size) break;
  }
  return all;
}

export async function loadAccounts() {
  const { data, error } = await getSupabase().from('accounts').select('*').order('created_at');
  if (error) throw error;
  return data;
}

export async function loadRules() {
  const { data, error } = await getSupabase().from('rules').select('*').order('created_at');
  if (error) throw error;
  return data;
}

export async function loadBalances() {
  const { data, error } = await getSupabase().from('account_balances').select('account_id,date,balance').order('date', { ascending: false });
  if (error) throw error;
  const last = {};
  for (const b of data) if (!last[b.account_id]) last[b.account_id] = b;
  return last;
}

export function loadTransactions({ from, to, select = '*' }) {
  return fetchAll((a, b) => {
    let q = getSupabase().from('transactions').select(select).order('date', { ascending: false }).order('id');
    if (from) q = q.gte('date', from);
    if (to) q = q.lte('date', to);
    return q.range(a, b);
  });
}

// Recalcule la catégorie de toutes les opérations non catégorisées à la main. Retourne le nombre de lignes modifiées.
export async function reapplyRules(rules) {
  const cat = makeCategorizer(rules);
  const rows = await fetchAll((a, b) =>
    getSupabase().from('transactions').select('id,label,category,cat_source')
      .or('cat_source.is.null,cat_source.eq.rule').order('id').range(a, b));
  const groups = new Map();
  for (const r of rows) {
    const c = cat(r.label);
    if (c === r.category) continue;
    const k = c ?? '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r.id);
  }
  let n = 0;
  for (const [k, ids] of groups) {
    const patch = k ? { category: k, cat_source: 'rule' } : { category: null, cat_source: null };
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { error } = await getSupabase().from('transactions').update(patch).in('id', chunk);
      if (error) throw error;
      n += chunk.length;
    }
  }
  return n;
}

// Charge les catégories (graine au premier lancement) et alimente le registre. null = table absente (secours).
export async function loadCategories() {
  try {
    const sb = getSupabase();
    const read = () => sb.from('categories').select('*').order('sort').order('name');
    let { data, error } = await read();
    if (error) throw error;
    if (!data.length) {
      const seed = DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sort: i }));
      const r = await sb.from('categories').upsert(seed, { onConflict: 'name', ignoreDuplicates: true });
      if (r.error) throw r.error;
      ({ data, error } = await read());
      if (error) throw error;
    }
    registerCategories(data);
    return data;
  } catch (e) {
    registerCategories(DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sort: i })));
    return null;
  }
}
