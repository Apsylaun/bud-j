-- Zip 3 : placements / patrimoine. À exécuter dans Supabase > SQL Editor (après 002_pots.sql).
-- Patrimoine strictement personnel (propriétaire seul). Valeurs saisies à la main (ou, plus tard, par API de cours).

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  asset_type text not null,                 -- Livret, ETF, Action, Assurance-vie, Crypto, Immobilier…
  asset_class text not null check (asset_class in ('Liquidité', 'Actions', 'Obligations', 'Immobilier', 'Alternatif')),
  holder text,                              -- enveloppe / établissement (ex : PEA Bourse Direct)
  isin text,                                -- réservés aux cours automatiques (plus tard)
  ticker text,
  quantity numeric(20,8),
  invested numeric(14,2),                   -- montant investi (PRU × quantité) pour la +/- value
  account_id uuid references public.accounts(id) on delete set null,   -- compte bancaire lié (pré-remplit le solde importé)
  created_at timestamptz not null default now()
);

create table public.asset_values (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  date date not null,
  value numeric(14,2) not null,             -- valeur totale de la ligne à cette date
  price numeric(14,4),                      -- cours unitaire (API, plus tard)
  source text not null default 'manual' check (source in ('manual', 'api')),
  created_at timestamptz not null default now(),
  unique (asset_id, date)
);
create index asset_values_asset_date on public.asset_values (asset_id, date);

alter table public.assets enable row level security;
alter table public.asset_values enable row level security;
revoke all on public.assets, public.asset_values from anon;

create policy assets_all on public.assets for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and (account_id is null or public.can_access_account(account_id)));
create policy asset_values_all on public.asset_values for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid()
    and exists (select 1 from public.assets a where a.id = asset_id and a.owner_id = auth.uid()));
