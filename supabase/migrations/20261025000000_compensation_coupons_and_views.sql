-- Compensation coupons view and enhanced promo code validation support.
-- Ensures dynamic compatibility for n8n workflows inserting into either
-- promo_codes or coupons, with case-insensitive and whitespace-tolerant validation.

-- 1. Index for fast case-insensitive code search
create index if not exists idx_promo_codes_code_upper
  on public.promo_codes (upper(trim(code)));

-- 2. Coupons view for backwards/n8n compatibility (mapping discount_percent / discount_amount)
create or replace view public.coupons as
select
  id,
  tenant_id,
  code,
  discount_percentage as discount_percent,
  discount_percentage as discount_amount,
  is_used,
  used_by,
  used_at,
  used_order_id,
  created_at,
  expires_at,
  source,
  feedback_id,
  issued_to_email
from public.promo_codes;

-- 3. Instead-of-insert trigger on coupons view so direct writes from workflows persist to promo_codes
create or replace function public.insert_into_coupons() returns trigger
language plpgsql as $$
declare
  v_tenant_id uuid;
  v_code text;
  v_pct int;
begin
  v_tenant_id := coalesce(new.tenant_id, 'f00df051-0000-4000-8000-000000000001'::uuid);
  v_code := upper(regexp_replace(trim(new.code), '\s*-\s*', '-', 'g'));
  v_pct := coalesce(new.discount_percent, new.discount_amount, 20);

  insert into public.promo_codes (
    tenant_id,
    code,
    discount_percentage,
    is_used,
    source,
    feedback_id,
    issued_to_email,
    expires_at
  ) values (
    v_tenant_id,
    v_code,
    v_pct,
    coalesce(new.is_used, false),
    coalesce(new.source, 'compensation'),
    new.feedback_id,
    new.issued_to_email,
    coalesce(new.expires_at, now() + interval '30 days')
  )
  on conflict (tenant_id, code) do update set
    discount_percentage = excluded.discount_percentage,
    expires_at = excluded.expires_at,
    feedback_id = coalesce(public.promo_codes.feedback_id, excluded.feedback_id),
    issued_to_email = coalesce(public.promo_codes.issued_to_email, excluded.issued_to_email);
  return new;
end $$;

drop trigger if exists coupons_insert_trigger on public.coupons;
create trigger coupons_insert_trigger
instead of insert on public.coupons
for each row execute function public.insert_into_coupons();

-- 4. Grants on coupons view
grant select, insert, update on public.coupons to anon, authenticated, service_role;

-- 5. Updated check_promo_code: whitespace, hyphen, and case-tolerant
create or replace function public.check_promo_code(p_tenant_id uuid, p_code text)
returns int
language plpgsql stable security definer set search_path = '' as $$
declare
  v_pct int;
  v_clean text;
begin
  v_clean := upper(regexp_replace(trim(p_code), '\s*-\s*', '-', 'g'));
  select discount_percentage into v_pct
  from public.promo_codes
  where tenant_id = p_tenant_id and upper(trim(code)) = v_clean and not is_used
    and (expires_at is null or expires_at > now());
  if v_pct is null then
    raise exception 'promo code is invalid or has already been used';
  end if;
  return v_pct;
end $$;

-- 6. Updated redeem_promo_code: whitespace, hyphen, and case-tolerant
create or replace function public.redeem_promo_code(p_order_id uuid, p_code text)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_pct   int;
  v_off   int;
  v_clean text;
begin
  v_clean := upper(regexp_replace(trim(p_code), '\s*-\s*', '-', 'g'));
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
  where tenant_id = v_order.tenant_id and upper(trim(code)) = v_clean and not is_used
    and (expires_at is null or expires_at > now())
  returning discount_percentage into v_pct;
  if v_pct is null then
    raise exception 'promo code is invalid or has already been used';
  end if;

  v_off := round(v_order.total_cents * v_pct / 100.0);
  update public.orders
  set promo_code = v_clean, discount_cents = v_off, total_cents = total_cents - v_off
  where id = p_order_id;
  return v_off;
end $$;
