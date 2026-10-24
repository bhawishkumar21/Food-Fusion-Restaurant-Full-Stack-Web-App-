-- Compensation (apology) codes from the feedback workflow live in promo_codes
-- too, so checkout can redeem them. They expire; manual codes may not.

alter table public.promo_codes add column if not exists expires_at      timestamptz;
alter table public.promo_codes add column if not exists source          text not null default 'manual'
  check (source in ('manual', 'compensation'));
alter table public.promo_codes add column if not exists feedback_id     uuid references public.feedback(id) on delete set null;
alter table public.promo_codes add column if not exists issued_to_email text;

-- One compensation code per review, however often the workflow retries.
create unique index if not exists promo_codes_one_per_feedback
  on public.promo_codes (feedback_id) where feedback_id is not null;

-- Store codes in one canonical form ("sorry20-dqna8 " → "SORRY20-DQNA8"),
-- before the format check runs, whoever inserts them.
create or replace function public.normalize_promo_code() returns trigger
language plpgsql as $$
begin
  new.code := upper(trim(new.code));
  return new;
end $$;
drop trigger if exists promo_codes_normalize on public.promo_codes;
create trigger promo_codes_normalize before insert or update of code on public.promo_codes
  for each row execute function public.normalize_promo_code();

-- ───────────────────────────── check / redeem now honour expires_at ──

create or replace function public.check_promo_code(p_tenant_id uuid, p_code text)
returns int
language plpgsql stable security definer set search_path = '' as $$
declare
  v_pct int;
begin
  select discount_percentage into v_pct
  from public.promo_codes
  where tenant_id = p_tenant_id and code = upper(trim(p_code)) and not is_used
    and (expires_at is null or expires_at > now());
  if v_pct is null then
    raise exception 'promo code is invalid or has already been used';
  end if;
  return v_pct;
end $$;

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
    and (expires_at is null or expires_at > now())
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
