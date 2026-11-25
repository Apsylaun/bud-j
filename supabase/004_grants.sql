-- Corrige « permission denied for table … » : donne aux utilisateurs connectés le droit d'accéder aux tables.
-- (La sécurité par ligne reste assurée par les politiques RLS.) Sans danger si relancé.
grant usage on schema public to authenticated;

do $$
declare t text;
begin
  foreach t in array array['accounts','transactions','rules','account_balances','pots','pot_months','pot_entries','assets','asset_values'] loop
    if to_regclass('public.' || t) is not null then
      execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    end if;
  end loop;
end $$;

alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
