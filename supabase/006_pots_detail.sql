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
