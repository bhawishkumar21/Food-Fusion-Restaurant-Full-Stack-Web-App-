-- Production naming compatibility: preserve the existing daily_stock contract
-- while exposing the requested stock_quantity column to new consumers.
alter table public.menu_items
  add column if not exists stock_quantity integer check (stock_quantity is null or stock_quantity >= 0);

update public.menu_items
set stock_quantity = daily_stock
where stock_quantity is null and daily_stock is not null;

create or replace function public.sync_menu_stock_quantity() returns trigger
language plpgsql as $$
begin
  if new.stock_quantity is distinct from old.stock_quantity then
    new.daily_stock := new.stock_quantity;
  elsif new.daily_stock is distinct from old.daily_stock then
    new.stock_quantity := new.daily_stock;
  end if;
  if new.stock_quantity = 0 then new.is_available := false; end if;
  return new;
end $$;

drop trigger if exists menu_items_sync_stock_quantity on public.menu_items;
create trigger menu_items_sync_stock_quantity
  before update on public.menu_items
  for each row execute function public.sync_menu_stock_quantity();

-- One row per browser event. Distinct session_id is the real visit count.
create table if not exists public.site_analytics (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants on delete cascade,
  session_id text not null,
  stage text not null check (stage in ('menu_view', 'cart_add', 'checkout_open', 'order_placed')),
  created_at timestamptz not null default now()
);
create index if not exists site_analytics_tenant_created on public.site_analytics (tenant_id, created_at);
alter table public.site_analytics enable row level security;
drop policy if exists site_analytics_insert on public.site_analytics;
create policy site_analytics_insert on public.site_analytics for insert to anon, authenticated with check (true);
drop policy if exists site_analytics_owner_read on public.site_analytics;
create policy site_analytics_owner_read on public.site_analytics for select to authenticated using (public.is_owner());

create or replace function public.tenant_analytics(p_tenant_id uuid, p_days int default 30)
returns jsonb language plpgsql stable as $$
declare since timestamptz := now() - make_interval(days => p_days); result jsonb;
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'revenue_cents', coalesce(sum(total_cents) filter (where status = 'completed'), 0),
    'orders', count(*) filter (where status = 'completed'),
    'cancelled', count(*) filter (where status = 'cancelled'),
    'voice_orders', count(*) filter (where status = 'completed' and channel = 'voice'),
    'avg_ticket_cents', coalesce(round(avg(total_cents) filter (where status = 'completed')), 0)
  ) into result from public.orders where tenant_id = p_tenant_id and created_at >= since;
  result := result || jsonb_build_object(
    'site_visits', (select count(distinct session_id) from public.site_analytics where tenant_id = p_tenant_id and created_at >= since),
    'revenue_by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'revenue_cents', r, 'orders', n) order by d) from (select date_trunc('day', created_at)::date d, sum(total_cents) r, count(*) n from public.orders where tenant_id = p_tenant_id and created_at >= since and status = 'completed' group by 1) x), '[]'::jsonb),
    'funnel', coalesce((select jsonb_object_agg(stage, sessions) from (select stage, count(distinct session_id) sessions from public.site_analytics where tenant_id = p_tenant_id and created_at >= since group by stage) f), '{}'::jsonb),
    'sentiment', coalesce((select jsonb_object_agg(sentiment, n) from (select sentiment, count(*) n from public.feedback where tenant_id = p_tenant_id and created_at >= since and sentiment <> 'pending' group by sentiment) s), '{}'::jsonb)
  );
  return result;
end $$;
