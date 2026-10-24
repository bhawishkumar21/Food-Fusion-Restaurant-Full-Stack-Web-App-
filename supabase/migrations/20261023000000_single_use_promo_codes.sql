-- Single-use promo codes.
--
-- A code knocks discount_percentage off the order subtotal (before tax /
-- delivery) and can be redeemed exactly once. Clients never touch the table:
-- they can only ask whether a code is valid (check_promo_code) and redeem it
-- as part of placing an order (place_order / redeem_promo_code). Redemption is
-- a single conditional UPDATE, so two simultaneous checkouts can't both win.

create table if not exists public.promo_codes (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  code                text not null check (code ~ '^[A-Z0-9_-]{3,32}$'),
  discount_percentage int  not null check (discount_percentage between 1 and 90),
  is_used             boolean not null default false,
  used_by             uuid references auth.users(id) on delete set null,
  used_at             timestamptz,
  used_order_id       uuid references public.orders(id) on delete set null,
  created_at          timestamptz not null default now(),
  unique (tenant_id, code)
);

alter table public.promo_codes enable row level security;

-- Managers see and issue their restaurant's codes; the super admin sees all.
drop policy if exists promo_codes_manage on public.promo_codes;
create policy promo_codes_manage on public.promo_codes for all
  using (public.is_manager_of(tenant_id)) with check (public.is_manager_of(tenant_id));

alter table public.orders add column if not exists promo_code     text;
alter table public.orders add column if not exists discount_cents int not null default 0
  check (discount_cents >= 0);

-- Like the menu guard: only police direct writes from client roles, so
-- trusted SECURITY DEFINER code (redeem_promo_code) can set the discount.
create or replace function public.guard_order_update() returns trigger
language plpgsql as $$
begin
  if auth.role() = 'service_role' or current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if (to_jsonb(new) - 'status' - 'updated_at')
     is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
    raise exception 'only order status may be changed' using errcode = '42501';
  end if;
  return new;
end $$;

-- ───────────────────────────────────────────── validate (no side effects) ──

create or replace function public.check_promo_code(p_tenant_id uuid, p_code text)
returns int
language plpgsql stable security definer set search_path = '' as $$
declare
  v_pct int;
begin
  select discount_percentage into v_pct
  from public.promo_codes
  where tenant_id = p_tenant_id and code = upper(trim(p_code)) and not is_used;
  if v_pct is null then
    raise exception 'promo code is invalid or has already been used';
  end if;
  return v_pct;
end $$;
revoke all on function public.check_promo_code from public;
grant execute on function public.check_promo_code to anon, authenticated;

-- ─────────────────────────────── redeem against an order the caller owns ──

create or replace function public.redeem_promo_code(p_order_id uuid, p_code text)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_pct   int;
  v_off   int;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or v_order.customer_id is distinct from auth.uid() then
    raise exception 'order not found';
  end if;
  if v_order.promo_code is not null then
    raise exception 'order already has a promo code';
  end if;
  if v_order.status <> 'new' then
    raise exception 'order can no longer be discounted';
  end if;

  -- The atomic single-use gate: only one caller can flip is_used.
  update public.promo_codes
  set is_used = true, used_by = auth.uid(), used_at = now(), used_order_id = p_order_id
  where tenant_id = v_order.tenant_id and code = upper(trim(p_code)) and not is_used
  returning discount_percentage into v_pct;
  if v_pct is null then
    raise exception 'promo code is invalid or has already been used';
  end if;

  v_off := round(v_order.total_cents * v_pct / 100.0);
  update public.orders
  set promo_code = upper(trim(p_code)), discount_cents = v_off, total_cents = total_cents - v_off
  where id = p_order_id;
  return v_off;
end $$;
revoke all on function public.redeem_promo_code from public, anon;
grant execute on function public.redeem_promo_code to authenticated;

-- ─────────────────────────────── place_order: optional code, same transaction ──

drop function if exists public.place_order(uuid, jsonb, text, text, text);

create or replace function public.place_order(
  p_tenant_id  uuid,
  p_items      jsonb,
  p_fulfilment text,
  p_notes      text default null,
  p_channel    text default 'web',
  p_promo_code text default null
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

  -- A bad or spent code rolls back the whole order rather than charging full price.
  if nullif(trim(p_promo_code), '') is not null then
    perform public.redeem_promo_code(v_order_id, p_promo_code);
  end if;

  insert into public.funnel_events (tenant_id, session_id, stage)
  values (p_tenant_id, auth.uid()::text, 'order_placed');

  return v_order_id;
end $$;
revoke all on function public.place_order from public, anon;
grant execute on function public.place_order to authenticated;

-- A starter code so the flow can be tried end-to-end.
insert into public.promo_codes (tenant_id, code, discount_percentage)
select id, 'WELCOME10', 10 from public.tenants where id = 'f00df051-0000-4000-8000-000000000001'
on conflict (tenant_id, code) do nothing;
