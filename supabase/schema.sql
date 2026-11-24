-- Zip 1 : comptes, opérations, règles, soldes. À exécuter dans Supabase > SQL Editor.

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  bank text not null,
  shared boolean not null default false,   -- true = compte commun, visible par les 2 utilisateurs
  created_at timestamptz not null default now()
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  date date not null,
  label text not null,
  amount numeric(12,2) not null,            -- signé : négatif = sortie
  category text,                            -- null = à catégoriser
  cat_source text check (cat_source in ('rule','manual')),
  hash text not null,                       -- empreinte anti-doublon
  created_at timestamptz not null default now(),
  unique (account_id, hash)
);
create index transactions_account_date on public.transactions (account_id, date);

create table public.rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pattern text not null,
  category text not null,
  created_at timestamptz not null default now()
);

create table public.account_balances (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  date date not null,
  balance numeric(14,2) not null,
  unique (account_id, date)
);

-- Accès : propriétaire du compte, ou tout utilisateur connecté si le compte est commun.
create function public.can_access_account(a uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.accounts where id = a and (shared or owner_id = auth.uid()))
$$;
revoke execute on function public.can_access_account(uuid) from public, anon;
grant execute on function public.can_access_account(uuid) to authenticated;

alter table public.accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.rules enable row level security;
alter table public.account_balances enable row level security;
revoke all on public.accounts, public.transactions, public.rules, public.account_balances from anon;

create policy accounts_select on public.accounts for select to authenticated using (shared or owner_id = auth.uid());
create policy accounts_insert on public.accounts for insert to authenticated with check (owner_id = auth.uid());
create policy accounts_update on public.accounts for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy accounts_delete on public.accounts for delete to authenticated using (owner_id = auth.uid());

create policy tx_all on public.transactions for all to authenticated
  using (public.can_access_account(account_id)) with check (public.can_access_account(account_id));
create policy bal_all on public.account_balances for all to authenticated
  using (public.can_access_account(account_id)) with check (public.can_access_account(account_id));
create policy rules_all on public.rules for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
