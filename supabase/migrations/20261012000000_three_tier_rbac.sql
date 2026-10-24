-- Food Fusion — strict 3-tier RBAC.
--
--   super_admin  restaurant owner: full CRUD everywhere, finance, staff
--   manager      operations/HR (one restaurant): orders, kitchen queue,
--                daily inventory, reservations
--   user         customer: menu, own orders, own profile, own reservations
--
-- Replaces the 5-role model (customer/kitchen/manager/owner/super_admin).
-- Old role names in not-yet-refreshed JWTs are mapped by jwt_role().

-- ───────────────────────────────────────────── 1. migrate stored roles ──

update auth.users
set raw_app_meta_data = jsonb_set(
  coalesce(raw_app_meta_data, '{}'::jsonb), '{role}',
  to_jsonb(case raw_app_meta_data ->> 'role'
    when 'owner'    then 'super_admin'
    when 'kitchen'  then 'manager'
    when 'customer' then 'user'
  end))
where raw_app_meta_data ->> 'role' in ('owner', 'kitchen', 'customer');

-- ──────────────────────────────────────────────────── 2. role helpers ──

create or replace function public.jwt_role() returns text
language sql stable as $$
  select case coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'user')
    when 'super_admin' then 'super_admin'
    when 'owner'       then 'super_admin'   -- legacy
    when 'manager'     then 'manager'
    when 'kitchen'     then 'manager'       -- legacy
    else 'user'
  end
$$;

create or replace function public.has_role(required text) returns boolean
language sql stable as $$
  select case public.jwt_role()
    when 'super_admin' then required in ('super_admin', 'manager', 'user')
    when 'manager'     then required = 'manager'
    else                    required = 'user'
  end
$$;

-- Manager of restaurant t, or an owner (owners are never tenant-confined).
create or replace function public.is_staff_of(t uuid) returns boolean
language sql stable as $$
  select public.jwt_role() = 'super_admin'
      or (public.jwt_role() = 'manager' and public.jwt_tenant() = t)
$$;

create or replace function public.is_owner() returns boolean
language sql stable as $$
  select public.jwt_role() = 'super_admin'
$$;

-- ─────────────────────────────────────────── 3. owner-only policies ──
-- Menu creation/deletion, feedback & discounts (customer recovery), funnel
-- analytics and revenue are financial/owner concerns in the 3-tier model.

drop policy if exists menu_manager_insert on public.menu_items;
drop policy if exists menu_manager_delete on public.menu_items;
create policy menu_owner_insert on public.menu_items
  for insert to authenticated with check (public.is_owner());
create policy menu_owner_delete on public.menu_items
  for delete to authenticated using (public.is_owner());

drop policy if exists feedback_read on public.feedback;
drop policy if exists feedback_manager_update on public.feedback;
create policy feedback_read on public.feedback
  for select to authenticated
  using (customer_id = auth.uid() or public.is_owner());
create policy feedback_owner_update on public.feedback
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists discounts_read on public.discount_codes;
drop policy if exists discounts_manager_insert on public.discount_codes;
create policy discounts_read on public.discount_codes
  for select to authenticated
  using (customer_id = auth.uid() or public.is_owner());
create policy discounts_owner_insert on public.discount_codes
  for insert to authenticated
  with check (public.is_owner() and issued_by = auth.uid());

drop policy if exists funnel_manager_read on public.funnel_events;
create policy funnel_owner_read on public.funnel_events
  for select to authenticated using (public.is_owner());

drop function if exists public.is_manager_of(uuid);

-- ───────────────────────────────────── 4. daily inventory (managers) ──

alter table public.menu_items
  add column if not exists daily_stock integer check (daily_stock is null or daily_stock >= 0);

comment on column public.menu_items.daily_stock is
  'Portions left today. Decremented by place_order(); the dish auto-86s at 0. NULL = not tracked.';

-- Managers may only touch availability and the daily count; owners anything.
create or replace function public.guard_menu_item_update() returns trigger
language plpgsql as $$
begin
  if auth.role() = 'service_role' or public.is_owner() then
    return new;
  end if;
  if (to_jsonb(new) - 'is_available' - 'daily_stock' - 'updated_at')
     is distinct from (to_jsonb(old) - 'is_available' - 'daily_stock' - 'updated_at') then
    raise exception 'managers may only change availability and daily stock'
      using errcode = '42501';
  end if;
  return new;
end $$;

-- place_order(): now also enforces and decrements daily stock atomically.
create or replace function public.place_order(
  p_tenant_id  uuid,
  p_items      jsonb,
  p_fulfilment text,
  p_notes      text default null,
  p_channel    text default 'web'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_order_id uuid;
  v_missing  text;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant_id and status = 'active') then
    raise exception 'restaurant is not accepting orders';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'order has no items';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as l(menu_item_id uuid, quantity int)
             where l.quantity is null or l.quantity not between 1 and 20) then
    raise exception 'invalid quantity';
  end if;

  -- Lock the rows so two simultaneous orders can't oversell the last portion.
  perform 1 from public.menu_items m
  where m.id in (select (l ->> 'menu_item_id')::uuid from jsonb_array_elements(p_items) l)
  for update;

  select string_agg(coalesce(m.name, q.menu_item_id::text), ', ') into v_missing
  from (select l.menu_item_id, sum(l.quantity) qty
        from jsonb_to_recordset(p_items) as l(menu_item_id uuid, quantity int)
        group by l.menu_item_id) q
  left join public.menu_items m
    on m.id = q.menu_item_id and m.tenant_id = p_tenant_id
  where m.id is null or not m.is_available
     or (m.daily_stock is not null and m.daily_stock < q.qty);
  if v_missing is not null then
    raise exception 'unavailable: %', v_missing;
  end if;

  insert into public.orders (tenant_id, customer_id, fulfilment, notes, channel, total_cents)
  select p_tenant_id, auth.uid(), p_fulfilment, p_notes, p_channel,
         sum(m.price_cents * l.quantity)
  from jsonb_to_recordset(p_items) as l(menu_item_id uuid, quantity int)
  join public.menu_items m on m.id = l.menu_item_id
  returning id into v_order_id;

  insert into public.order_items (order_id, tenant_id, menu_item_id, name, quantity, unit_price_cents)
  select v_order_id, p_tenant_id, m.id, m.name, l.quantity, m.price_cents
  from jsonb_to_recordset(p_items) as l(menu_item_id uuid, quantity int)
  join public.menu_items m on m.id = l.menu_item_id;

  update public.menu_items m
  set daily_stock = m.daily_stock - q.qty,
      is_available = (m.daily_stock - q.qty) > 0
  from (select l.menu_item_id, sum(l.quantity) qty
        from jsonb_to_recordset(p_items) as l(menu_item_id uuid, quantity int)
        group by l.menu_item_id) q
  where m.id = q.menu_item_id and m.daily_stock is not null;

  insert into public.funnel_events (tenant_id, session_id, stage)
  values (p_tenant_id, auth.uid()::text, 'order_placed');

  return v_order_id;
end $$;
revoke all on function public.place_order from public, anon;
grant execute on function public.place_order to authenticated;

-- Revenue / funnel / sentiment: owner only.
create or replace function public.tenant_analytics(p_tenant_id uuid, p_days int default 30)
returns jsonb
language plpgsql stable as $$
declare
  since timestamptz := now() - make_interval(days => p_days);
  result jsonb;
begin
  if not public.is_owner() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'revenue_cents', coalesce(sum(total_cents) filter (where status <> 'cancelled'), 0),
    'orders',        count(*) filter (where status <> 'cancelled'),
    'cancelled',     count(*) filter (where status = 'cancelled'),
    'voice_orders',  count(*) filter (where channel = 'voice'),
    'avg_ticket_cents', coalesce(round(avg(total_cents) filter (where status <> 'cancelled')), 0)
  ) into result
  from public.orders where tenant_id = p_tenant_id and created_at >= since;

  result := result || jsonb_build_object(
    'revenue_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d, 'revenue_cents', r, 'orders', n) order by d)
      from (select date_trunc('day', created_at)::date d, sum(total_cents) r, count(*) n
            from public.orders
            where tenant_id = p_tenant_id and created_at >= since and status <> 'cancelled'
            group by 1) x), '[]'::jsonb),
    'funnel', (
      select jsonb_object_agg(stage, sessions)
      from (select stage, count(distinct session_id) sessions
            from public.funnel_events
            where tenant_id = p_tenant_id and created_at >= since
            group by stage) f),
    'sentiment', (
      select jsonb_object_agg(sentiment, n)
      from (select sentiment, count(*) n from public.feedback
            where tenant_id = p_tenant_id and created_at >= since and sentiment <> 'pending'
            group by sentiment) s)
  );
  return result;
end $$;

-- ─────────────────────────────────────────────── 5. reservations ──

create table if not exists public.reservations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants on delete cascade,
  customer_id  uuid references auth.users on delete set null,
  reserved_for timestamptz not null,
  party_size   smallint not null check (party_size between 1 and 30),
  guest_name   text not null check (length(guest_name) between 1 and 80),
  phone        text,
  notes        text,
  status       text not null default 'requested'
               check (status in ('requested', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show')),
  table_label  text,
  created_at   timestamptz not null default now()
);
create index if not exists reservations_tenant_time on public.reservations (tenant_id, reserved_for);
alter table public.reservations enable row level security;

-- Customers book for themselves; they cannot pre-confirm or pick a table.
create policy reservations_user_insert on public.reservations
  for insert to authenticated
  with check (customer_id = auth.uid() and status = 'requested' and table_label is null
              and reserved_for > now());
create policy reservations_read on public.reservations
  for select to authenticated
  using (customer_id = auth.uid() or public.is_staff_of(tenant_id));
create policy reservations_staff_update on public.reservations
  for update to authenticated
  using (public.is_staff_of(tenant_id)) with check (public.is_staff_of(tenant_id));
create policy reservations_owner_delete on public.reservations
  for delete to authenticated using (public.is_owner());

-- ─────────────────────────────────────────────────── 6. profiles ──

create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text check (length(display_name) <= 80),
  phone        text check (length(phone) <= 30),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
alter table public.profiles enable row level security;

create policy profiles_own on public.profiles
  for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_owner_read on public.profiles
  for select to authenticated using (public.is_owner());
