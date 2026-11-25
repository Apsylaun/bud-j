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
