export function friendly(e) {
  const m = (e && e.message) || String(e);
  if (/schema cache|does not exist|could not find the/i.test(m)) return `${m} — la base n’est pas à jour : exécute supabase/008_update.sql dans Supabase (SQL Editor).`;
  if (/permission denied/i.test(m)) return `${m} — exécute supabase/004_grants.sql dans Supabase.`;
  return m;
}
