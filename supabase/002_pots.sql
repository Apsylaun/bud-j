-- Zip 2 : pots. À exécuter dans Supabase > SQL Editor (après schema.sql).
-- Modèle : un grand livre (pot_entries). Solde d'un pot = somme de ses lignes.
--   opening  = solde initial       alloc    = allocation mensuelle (clôture)
--   spend    = dépense payée par le pot (négatif, liée à une opération)
--   transfer = mouvement entre pots (paire +/-, dont pot -> sous-pot)

create table public.pots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parent_id uuid references public.pots(id) on delete cascade,   -- non null = sous-pot / projet
  name text not null,
  role text check (role in ('rest', 'deficit')),                  -- Reste (absorbe l'écart) / Imprévu (absorbe le déficit)
  target numeric(12,2),                                           -- objectif optionnel
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create unique index pots_one_role on public.pots (owner_id, role) where role is not null;

create table public.pot_months (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  pcts jsonb not null default '{}',        -- { pot_id: pourcentage }
  surplus numeric(12,2),                   -- excédent au moment de la clôture
  closed boolean not null default false,
  closed_at timestamptz,
  unique (owner_id, month)
);

create table public.pot_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pot_id uuid not null references public.pots(id) on delete cascade,
  date date not null,
  kind text not null check (kind in ('opening', 'alloc', 'spend', 'transfer')),
  amount numeric(12,2) not null,
  month text,
  transaction_id uuid references public.transactions(id) on delete cascade,
  group_id uuid,
  note text,
  created_at timestamptz not null default now()
);
create index pot_entries_pot on public.pot_entries (owner_id, pot_id);
create index pot_entries_tx on public.pot_entries (transaction_id);
create index pot_entries_month on public.pot_entries (owner_id, month);

alter table public.pots enable row level security;
alter table public.pot_months enable row level security;
alter table public.pot_entries enable row level security;
revoke all on public.pots, public.pot_months, public.pot_entries from anon;

create policy pots_all on public.pots for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy pot_months_all on public.pot_months for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy pot_entries_all on public.pot_entries for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid()
    and exists (select 1 from public.pots p where p.id = pot_id and p.owner_id = auth.uid()));

-- Clôture (ou recalcul) d'un mois : excédent > 0 réparti selon les %, Reste absorbe l'écart ;
-- excédent < 0 débité du pot Imprévu. Atomique.
create or replace function public.close_pot_month(p_month text, p_surplus numeric, p_pcts jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare
  me uuid := auth.uid();
  rest_id uuid; deficit_id uuid;
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
        insert into pot_entries (pot_id, date, kind, amount, month) values (r.id, d, 'alloc', amt, p_month);
        allocated := allocated + amt;
      end if;
    end loop;
    amt := round(p_surplus - allocated, 2);
    if amt <> 0 then
      insert into pot_entries (pot_id, date, kind, amount, month, note) values (rest_id, d, 'alloc', amt, p_month, 'Reste');
    end if;
  end if;

  insert into pot_months (owner_id, month, pcts, surplus, closed, closed_at)
  values (me, p_month, p_pcts, round(p_surplus, 2), true, now())
  on conflict (owner_id, month)
  do update set pcts = excluded.pcts, surplus = excluded.surplus, closed = true, closed_at = now();
end $$;

create or replace function public.reopen_pot_month(p_month text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  delete from pot_entries where owner_id = auth.uid() and kind = 'alloc' and month = p_month;
  update pot_months set closed = false where owner_id = auth.uid() and month = p_month;
end $$;

-- Paye (tout ou partie d') une dépense perso avec un ou plusieurs pots. p_lines = [{pot_id, amount}] (montants > 0).
-- Liste vide = retire l'imputation. Un pot peut devenir négatif (alerte côté interface).
create or replace function public.save_pot_spend(p_tx uuid, p_lines jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare t record; total numeric; l jsonb;
begin
  select tr.id, tr.date, tr.amount, tr.label, a.shared into t
    from transactions tr join accounts a on a.id = tr.account_id where tr.id = p_tx;
  if not found then raise exception 'Opération introuvable'; end if;
  if t.amount >= 0 then raise exception 'Seules les dépenses peuvent être payées par un pot'; end if;
  if t.shared then raise exception 'Une dépense du compte commun ne peut pas être payée par un pot perso'; end if;
  select coalesce(sum((x.value ->> 'amount')::numeric), 0) into total from jsonb_array_elements(p_lines) x;
  if total > abs(t.amount) + 0.005 then raise exception 'Total supérieur au montant de la dépense'; end if;

  delete from pot_entries where owner_id = auth.uid() and kind = 'spend' and transaction_id = p_tx;
  for l in select x.value from jsonb_array_elements(p_lines) x loop
    if (l ->> 'amount')::numeric > 0 then
      insert into pot_entries (pot_id, date, kind, amount, transaction_id, note)
      values ((l ->> 'pot_id')::uuid, t.date, 'spend', -((l ->> 'amount')::numeric), p_tx, t.label);
    end if;
  end loop;
end $$;

create or replace function public.move_between_pots(p_from uuid, p_to uuid, p_amount numeric, p_note text default null)
returns void language plpgsql security invoker set search_path = public as $$
declare g uuid := gen_random_uuid();
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Montant invalide'; end if;
  if p_from = p_to then raise exception 'Choisis deux pots différents'; end if;
  insert into pot_entries (pot_id, date, kind, amount, group_id, note) values
    (p_from, current_date, 'transfer', -p_amount, g, p_note),
    (p_to, current_date, 'transfer', p_amount, g, p_note);
end $$;

-- p_balances = [{pot_id, amount}] : remplace le solde initial de chaque pot listé (0 = supprime).
create or replace function public.set_pot_opening(p_date date, p_balances jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare l jsonb; amt numeric;
begin
  for l in select x.value from jsonb_array_elements(p_balances) x loop
    delete from pot_entries where owner_id = auth.uid() and kind = 'opening' and pot_id = (l ->> 'pot_id')::uuid;
    amt := coalesce((l ->> 'amount')::numeric, 0);
    if amt <> 0 then
      insert into pot_entries (pot_id, date, kind, amount, note)
      values ((l ->> 'pot_id')::uuid, p_date, 'opening', amt, 'Solde initial');
    end if;
  end loop;
end $$;

revoke execute on function public.close_pot_month(text, numeric, jsonb) from public, anon;
revoke execute on function public.reopen_pot_month(text) from public, anon;
revoke execute on function public.save_pot_spend(uuid, jsonb) from public, anon;
revoke execute on function public.move_between_pots(uuid, uuid, numeric, text) from public, anon;
revoke execute on function public.set_pot_opening(date, jsonb) from public, anon;
grant execute on function public.close_pot_month(text, numeric, jsonb) to authenticated;
grant execute on function public.reopen_pot_month(text) to authenticated;
grant execute on function public.save_pot_spend(uuid, jsonb) to authenticated;
grant execute on function public.move_between_pots(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.set_pot_opening(date, jsonb) to authenticated;
