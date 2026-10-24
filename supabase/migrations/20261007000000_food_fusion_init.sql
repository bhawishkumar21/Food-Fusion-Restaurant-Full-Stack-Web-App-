-- Food Fusion — multi-tenant schema with Row Level Security.
--
-- Identity model
--   auth.users.raw_app_meta_data = { "role": "...", "tenant_id": "<uuid>" }
--   app_metadata is only writable with the service-role key, so users cannot
--   self-promote. A missing role means "customer" (incl. anonymous sign-ins).
--
-- Role inheritance (mirrors src/auth/roles.ts):
--   super_admin ⊇ owner ⊇ manager ⊇ kitchen ; customer is separate.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────── helpers ──

create or replace function public.jwt_role() returns text
language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'customer')
$$;

create or replace function public.jwt_tenant() returns uuid
language sql stable as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::uuid
$$;

create or replace function public.has_role(required text) returns boolean
language sql stable as $$
  select case public.jwt_role()
    when 'super_admin' then true
    when 'owner'       then required in ('owner', 'manager', 'kitchen')
    when 'manager'     then required in ('manager', 'kitchen')
    when 'kitchen'     then required = 'kitchen'
    else                    required = 'customer'
  end
$$;

-- Staff of tenant t (kitchen and up) or a super admin.
create or replace function public.is_staff_of(t uuid) returns boolean
language sql stable as $$
  select public.jwt_role() = 'super_admin'
      or (public.jwt_tenant() = t and public.has_role('kitchen'))
$$;

-- Manager/owner of tenant t or a super admin.
create or replace function public.is_manager_of(t uuid) returns boolean
language sql stable as $$
  select public.jwt_role() = 'super_admin'
      or (public.jwt_tenant() = t and public.has_role('manager'))
$$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ──────────────────────────────────────────────────────────────── tables ──

create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  plan        text not null default 'starter' check (plan in ('starter', 'growth', 'enterprise')),
  status      text not null default 'active'  check (status in ('active', 'suspended')),
  created_at  timestamptz not null default now()
);

create table public.menu_items (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants on delete cascade,
  name         text not null,
  description  text not null default '',
  price_cents  integer not null check (price_cents >= 0),
  image_url    text,
  tags         text[] not null default '{}'
               check (tags <@ array['vegan', 'high_protein', 'chef_special', 'quick_bite']),
  is_available boolean not null default true,
  voice_notes  text,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.menu_items (tenant_id, sort_order);
create trigger menu_items_touch before update on public.menu_items
  for each row execute function public.touch_updated_at();

create table public.orders (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants on delete cascade,
  customer_id uuid not null references auth.users on delete cascade,
  status      text not null default 'new'
              check (status in ('new', 'preparing', 'ready', 'completed', 'cancelled')),
  fulfilment  text not null check (fulfilment in ('pickup', 'delivery', 'dine_in')),
  channel     text not null default 'web' check (channel in ('web', 'voice')),
  notes       text,
  total_cents integer not null check (total_cents >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.orders (tenant_id, status, created_at);
create index on public.orders (customer_id, created_at desc);
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

create table public.order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders on delete cascade,
  tenant_id        uuid not null references public.tenants on delete cascade,
  menu_item_id     uuid references public.menu_items on delete set null,
  name             text not null,           -- snapshot at time of order
  quantity         integer not null check (quantity between 1 and 20),
  unit_price_cents integer not null check (unit_price_cents >= 0)
);
create index on public.order_items (order_id);

create table public.feedback (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants on delete cascade,
  order_id          uuid not null references public.orders on delete cascade,
  customer_id       uuid not null references auth.users on delete cascade,
  rating            smallint not null check (rating between 1 and 5),
  text              text not null,
  source            text not null check (source in ('text', 'voice')),
  sentiment         text not null default 'pending'
                    check (sentiment in ('pending', 'positive', 'neutral', 'negative')),
  sentiment_score   numeric(4, 3),
  ai_summary        text,
  escalation_status text check (escalation_status in ('open', 'escalated', 'resolved')),
  discount_code     text,
  created_at        timestamptz not null default now(),
  unique (order_id)                        -- one review per order
);
create index on public.feedback (tenant_id, sentiment, created_at desc);

create table public.discount_codes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants on delete cascade,
  code        text not null unique,
  percent_off smallint not null check (percent_off between 5 and 100),
  customer_id uuid references auth.users on delete cascade,
  feedback_id uuid references public.feedback on delete set null,
  issued_by   uuid references auth.users on delete set null,
  redeemed_at timestamptz,
  created_at  timestamptz not null default now()
);

create table public.funnel_events (
  id         bigint generated always as identity primary key,
  tenant_id  uuid not null references public.tenants on delete cascade,
  session_id text not null,
  stage      text not null check (stage in ('menu_view', 'cart_add', 'checkout_open', 'order_placed')),
  created_at timestamptz not null default now()
);
create index on public.funnel_events (tenant_id, created_at);

create table public.api_logs (
  id          bigint generated always as identity primary key,
  tenant_id   uuid,
  user_id     uuid,
  method      text not null,
  route       text not null,
  status      smallint not null,
  duration_ms integer not null,
  level       text not null check (level in ('info', 'warn', 'error')),
  created_at  timestamptz not null default now()
);
create index on public.api_logs (created_at desc);
create index on public.api_logs (level, created_at desc);

-- ─────────────────────────────────────────────────── column-level guards ──
-- RLS is row-level only. These triggers stop a role that may UPDATE a row
-- from touching columns it shouldn't (e.g. kitchen editing prices).

create or replace function public.guard_menu_item_update() returns trigger
language plpgsql as $$
begin
  if auth.role() = 'service_role' or public.has_role('manager') then
    return new;
  end if;
  -- Kitchen staff: availability toggle only.
  if (to_jsonb(new) - 'is_available' - 'updated_at')
     is distinct from (to_jsonb(old) - 'is_available' - 'updated_at') then
    raise exception 'kitchen staff may only change availability'
      using errcode = '42501';
  end if;
  return new;
end $$;
create trigger menu_items_guard before update on public.menu_items
  for each row execute function public.guard_menu_item_update();

create or replace function public.guard_order_update() returns trigger
language plpgsql as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if (to_jsonb(new) - 'status' - 'updated_at')
     is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
    raise exception 'only order status may be changed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger orders_guard before update on public.orders
  for each row execute function public.guard_order_update();

-- ────────────────────────────────────────────────────── row level security ──

alter table public.tenants        enable row level security;
alter table public.menu_items     enable row level security;
alter table public.orders         enable row level security;
alter table public.order_items    enable row level security;
alter table public.feedback       enable row level security;
alter table public.discount_codes enable row level security;
alter table public.funnel_events  enable row level security;
alter table public.api_logs       enable row level security;

-- tenants: public storefront info for active restaurants; super admin manages.
create policy tenants_public_read on public.tenants
  for select to anon, authenticated
  using (status = 'active' or public.is_staff_of(id));
create policy tenants_super_admin on public.tenants
  for all to authenticated
  using (public.jwt_role() = 'super_admin')
  with check (public.jwt_role() = 'super_admin');

-- menu_items: anyone can browse; kitchen toggles stock; managers edit.
create policy menu_public_read on public.menu_items
  for select to anon, authenticated
  using (exists (select 1 from public.tenants t
                 where t.id = tenant_id and t.status = 'active')
         or public.is_staff_of(tenant_id));
create policy menu_staff_update on public.menu_items
  for update to authenticated
  using (public.is_staff_of(tenant_id))
  with check (public.is_staff_of(tenant_id));
create policy menu_manager_insert on public.menu_items
  for insert to authenticated
  with check (public.is_manager_of(tenant_id));
create policy menu_manager_delete on public.menu_items
  for delete to authenticated
  using (public.is_manager_of(tenant_id));

-- orders: customers see their own; staff see their tenant's.
-- No INSERT policy: orders are created only through place_order().
create policy orders_read on public.orders
  for select to authenticated
  using (customer_id = auth.uid() or public.is_staff_of(tenant_id));
create policy orders_staff_update on public.orders
  for update to authenticated
  using (public.is_staff_of(tenant_id))
  with check (public.is_staff_of(tenant_id));

create policy order_items_read on public.order_items
  for select to authenticated
  using (exists (select 1 from public.orders o
                 where o.id = order_id
                   and (o.customer_id = auth.uid() or public.is_staff_of(o.tenant_id))));

-- feedback: customers review their own orders; managers triage.
create policy feedback_customer_insert on public.feedback
  for insert to authenticated
  with check (
    customer_id = auth.uid()
    and sentiment = 'pending'
    and escalation_status is null
    and discount_code is null
    and exists (select 1 from public.orders o
                where o.id = order_id
                  and o.customer_id = auth.uid()
                  and o.tenant_id = feedback.tenant_id)
  );
create policy feedback_read on public.feedback
  for select to authenticated
  using (customer_id = auth.uid() or public.is_manager_of(tenant_id));
create policy feedback_manager_update on public.feedback
  for update to authenticated
  using (public.is_manager_of(tenant_id))
  with check (public.is_manager_of(tenant_id));

-- discount codes
create policy discounts_read on public.discount_codes
  for select to authenticated
  using (customer_id = auth.uid() or public.is_manager_of(tenant_id));
create policy discounts_manager_insert on public.discount_codes
  for insert to authenticated
  with check (public.is_manager_of(tenant_id) and issued_by = auth.uid());

-- funnel events: write-only beacons; managers read.
create policy funnel_insert on public.funnel_events
  for insert to anon, authenticated
  with check (true);
create policy funnel_manager_read on public.funnel_events
  for select to authenticated
  using (public.is_manager_of(tenant_id));

-- api logs: written by the API with the service role; super admin reads.
create policy api_logs_super_admin_read on public.api_logs
  for select to authenticated
  using (public.jwt_role() = 'super_admin');

-- ────────────────────────────────────────────────────────────── functions ──

-- Atomically validates stock, snapshots prices and creates the order.
-- SECURITY DEFINER because customers have no INSERT grant on orders.
create or replace function public.place_order(
  p_tenant_id  uuid,
  p_items      jsonb,           -- [{ "menu_item_id": uuid, "quantity": int }]
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

  select string_agg(coalesce(m.name, l.menu_item_id::text), ', ') into v_missing
  from jsonb_to_recordset(p_items) as l(menu_item_id uuid, quantity int)
  left join public.menu_items m
    on m.id = l.menu_item_id and m.tenant_id = p_tenant_id
  where m.id is null or not m.is_available;
  if v_missing is not null then
    raise exception 'unavailable: %', v_missing;
  end if;

  insert into public.orders (tenant_id, customer_id, fulfilment, notes, channel, total_cents)
  select p_tenant_id, auth.uid(), p_fulfilment, p_notes, p_channel,
         sum(m.price_cents * l.quantity)
  from jsonb_to_recordset(p_items) as l(menu_item_id uuid, quantity int) join public.menu_items m on m.id = l.menu_item_id
  returning id into v_order_id;

  insert into public.order_items (order_id, tenant_id, menu_item_id, name, quantity, unit_price_cents)
  select v_order_id, p_tenant_id, m.id, m.name, l.quantity, m.price_cents
  from jsonb_to_recordset(p_items) as l(menu_item_id uuid, quantity int) join public.menu_items m on m.id = l.menu_item_id;

  insert into public.funnel_events (tenant_id, session_id, stage)
  values (p_tenant_id, auth.uid()::text, 'order_placed');

  return v_order_id;
end $$;
revoke all on function public.place_order from public, anon;
grant execute on function public.place_order to authenticated;

-- Manager dashboard aggregate. SECURITY INVOKER: RLS still applies.
create or replace function public.tenant_analytics(p_tenant_id uuid, p_days int default 30)
returns jsonb
language plpgsql stable as $$
declare
  since timestamptz := now() - make_interval(days => p_days);
  result jsonb;
begin
  if not public.is_manager_of(p_tenant_id) then
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

-- Super admin: per-tenant API usage and latency.
create or replace function public.api_usage_summary(p_days int default 14)
returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d, 'requests', n, 'errors', e) order by d)
      from (select date_trunc('day', created_at)::date d, count(*) n,
                   count(*) filter (where level = 'error') e
            from public.api_logs
            where created_at >= now() - make_interval(days => p_days)
            group by 1) x), '[]'::jsonb),
    'by_tenant', coalesce((
      select jsonb_agg(jsonb_build_object(
               'tenant_id', tenant_id, 'requests', n, 'p95_ms', p95,
               'error_rate', round(e::numeric / greatest(n, 1), 4)) order by n desc)
      from (select tenant_id, count(*) n,
                   count(*) filter (where level = 'error') e,
                   percentile_cont(0.95) within group (order by duration_ms) p95
            from public.api_logs
            where created_at >= now() - make_interval(days => p_days)
            group by tenant_id) t), '[]'::jsonb)
  )
$$;

create view public.tenant_overview with (security_invoker = true) as
select t.*,
       (select count(*) from public.menu_items m where m.tenant_id = t.id) as menu_items,
       (select count(*) from public.orders o
         where o.tenant_id = t.id and o.created_at >= now() - interval '30 days') as orders_30d,
       (select coalesce(sum(o.total_cents), 0) from public.orders o
         where o.tenant_id = t.id and o.status <> 'cancelled'
           and o.created_at >= now() - interval '30 days') as revenue_30d_cents
from public.tenants t;
