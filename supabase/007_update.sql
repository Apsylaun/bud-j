-- Bud-J v5 : mise à jour complète de la base. Contient les migrations 005 et 006 (idempotentes) puis les nouveautés.
-- À exécuter une fois dans Supabase > SQL Editor, même si 005 ou 006 ont déjà été exécutées (sans danger).
-- Corrige notamment « Could not find the 'account_kind' column of 'assets' in the schema cache ».

-- Bud-J : catégories modifiables, horizon des objectifs, hiérarchie du patrimoine. Sans danger si relancé.

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null check (kind in ('expense', 'income', 'transfer_commun', 'transfer_interne')),
  color text not null default '#9AA0A6',
  sort int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.categories enable row level security;
revoke all on public.categories from anon;
grant select, insert, update, delete on public.categories to authenticated;
drop policy if exists categories_all on public.categories;
-- Catégories communes aux deux utilisateurs.
create policy categories_all on public.categories for all to authenticated using (true) with check (true);

alter table public.pots add column if not exists target_date date;

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'assets' and column_name = 'account_kind') then
    alter table public.assets add column account_kind text not null default 'Investissement'
      check (account_kind in ('Courant', 'Épargne', 'Investissement'));
    update public.assets set account_kind = case asset_type
      when 'Compte courant' then 'Courant' when 'Livret' then 'Épargne' when 'Fonds euros' then 'Épargne'
      else 'Investissement' end;
  end if;
end $$;

-- Renommer / supprimer une catégorie met à jour les opérations des deux utilisateurs (catégories communes).
create or replace function public.rename_category(p_old text, p_new text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  if p_new is null or btrim(p_new) = '' then raise exception 'Nom vide'; end if;
  if exists (select 1 from categories where name = p_old and kind in ('transfer_commun', 'transfer_interne')) then
    raise exception 'Catégorie protégée';
  end if;
  if exists (select 1 from categories where name = p_new) then raise exception 'Ce nom existe déjà'; end if;
  update categories set name = p_new where name = p_old;
  update transactions set category = p_new where category = p_old;
  update rules set category = p_new where category = p_old;
end $$;

create or replace function public.delete_category(p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  if exists (select 1 from categories where name = p_name and kind in ('transfer_commun', 'transfer_interne')) then
    raise exception 'Catégorie protégée';
  end if;
  update transactions set category = null, cat_source = null where category = p_name;
  delete from rules where category = p_name;
  delete from categories where name = p_name;
end $$;

revoke execute on function public.rename_category(text, text) from public, anon;
revoke execute on function public.delete_category(text) from public, anon;
grant execute on function public.rename_category(text, text) to authenticated;
grant execute on function public.delete_category(text) to authenticated;

-- ===== 006 : couleur des pots, sous-objectifs =====
-- Bud-J : couleur des pots, versements vers le sous-objectif à l'échéance la plus proche. Sans danger si relancé.

alter table public.pots add column if not exists color text;

-- Sous-objectif d'un pot qui reçoit par défaut les versements : échéance la plus proche (>= p_date)
-- et objectif non atteint à cette date.
create or replace function public.pick_subgoal(p_pot uuid, p_date date)
returns uuid language sql stable security invoker set search_path = public as $$
  select k.id from pots k
  where k.parent_id = p_pot and k.target_date is not null and k.target_date >= p_date
    and (k.target is null
         or coalesce((select sum(e.amount) from pot_entries e where e.pot_id = k.id and e.date <= p_date), 0) < k.target)
  order by k.target_date, k.created_at
  limit 1
$$;

-- Clôture d'un mois : comme avant, mais la part d'un pot va au sous-objectif choisi par pick_subgoal (sinon au pot).
create or replace function public.close_pot_month(p_month text, p_surplus numeric, p_pcts jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare
  me uuid := auth.uid();
  rest_id uuid; deficit_id uuid; dest uuid;
  d date; allocated numeric := 0; amt numeric; r record; pct_sum numeric;
begin
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'Mois invalide'; end if;
  select id into rest_id from pots where owner_id = me and role = 'rest';
  select id into deficit_id from pots where owner_id = me and role = 'deficit';
  if rest_id is null or deficit_id is null then raise exception 'Les pots Reste et Imprévu sont requis'; end if;
  select coalesce(sum(v.value::numeric), 0) into pct_sum from jsonb_each_text(p_pcts) v;
  if pct_sum > 100.0001 then raise exception 'Les pourcentages dépassent 100 pour cent'; end if;

  d := ((p_month || '-01')::date + interval '1 month' - interval '1 day')::date;
  delete from pot_entries where owner_id = me and kind = 'alloc' and month = p_month;

  if p_surplus < 0 then
    insert into pot_entries (pot_id, date, kind, amount, month, note)
    values (deficit_id, d, 'alloc', round(p_surplus, 2), p_month, 'Déficit du mois');
  elsif p_surplus > 0 then
    for r in select id from pots where owner_id = me and parent_id is null and role is distinct from 'rest' loop
      amt := round(p_surplus * coalesce((p_pcts ->> (r.id::text))::numeric, 0) / 100, 2);
      if amt <> 0 then
        dest := coalesce(public.pick_subgoal(r.id, d), r.id);
        insert into pot_entries (pot_id, date, kind, amount, month) values (dest, d, 'alloc', amt, p_month);
        allocated := allocated + amt;
      end if;
    end loop;
    amt := round(p_surplus - allocated, 2);
    if amt <> 0 then
      dest := coalesce(public.pick_subgoal(rest_id, d), rest_id);
      insert into pot_entries (pot_id, date, kind, amount, month, note) values (dest, d, 'alloc', amt, p_month, 'Reste');
    end if;
  end if;

  insert into pot_months (owner_id, month, pcts, surplus, closed, closed_at)
  values (me, p_month, p_pcts, round(p_surplus, 2), true, now())
  on conflict (owner_id, month)
  do update set pcts = excluded.pcts, surplus = excluded.surplus, closed = true, closed_at = now();
end $$;

revoke execute on function public.pick_subgoal(uuid, date) from public, anon;
revoke execute on function public.close_pot_month(text, numeric, jsonb) from public, anon;
grant execute on function public.pick_subgoal(uuid, date) to authenticated;
grant execute on function public.close_pot_month(text, numeric, jsonb) to authenticated;

-- ===== Nouveautés v5 : commentaire d'opération, emoji des sous-objectifs =====
alter table public.transactions add column if not exists comment text;
alter table public.pots add column if not exists emoji text;

-- Recharge le cache du schéma de l'API (évite l'erreur « schema cache »).
notify pgrst, 'reload schema';
