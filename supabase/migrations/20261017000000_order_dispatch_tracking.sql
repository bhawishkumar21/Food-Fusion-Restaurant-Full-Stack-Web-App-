-- Human-readable tracking IDs and completion timestamps for dispatch.
create sequence if not exists public.order_tracking_sequence start 1000;
alter table public.orders add column if not exists tracking_code text;
alter table public.orders add column if not exists tracking_id text;
alter table public.orders add column if not exists completed_at timestamptz;
update public.orders
set tracking_code = 'ORD-' || lpad(nextval('public.order_tracking_sequence')::text, 6, '0')
where tracking_code is null;
update public.orders set tracking_id = tracking_code where tracking_id is null;
alter table public.orders alter column tracking_code set not null;
alter table public.orders alter column tracking_id set not null;
create unique index if not exists orders_tracking_code_key on public.orders (tracking_code);
create unique index if not exists orders_tracking_id_key on public.orders (tracking_id);
alter table public.orders alter column tracking_code set default ('ORD-' || lpad(nextval('public.order_tracking_sequence')::text, 6, '0'));

create or replace function public.sync_order_tracking_id() returns trigger language plpgsql as $$
begin
  if new.tracking_code is null then
    new.tracking_code := 'ORD-' || lpad(nextval('public.order_tracking_sequence')::text, 6, '0');
  end if;
  new.tracking_id := new.tracking_code;
  return new;
end $$;
drop trigger if exists orders_sync_tracking_id on public.orders;
create trigger orders_sync_tracking_id before insert or update of tracking_code on public.orders
for each row execute function public.sync_order_tracking_id();

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('new', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled'));

-- The super-admin API completes orders with an RLS-authorized atomic update.
-- Completion remains immutable to customers because orders_update is staff-only.
create or replace function public.set_completed_at() returns trigger
language plpgsql as $$
begin
  if new.status = 'completed' and old.status <> 'completed' and new.completed_at is null then
    new.completed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists orders_set_completed_at on public.orders;
create trigger orders_set_completed_at before update on public.orders
for each row execute function public.set_completed_at();

-- Browser clients subscribe through RLS-filtered Postgres Changes channels.
do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
end $$;
