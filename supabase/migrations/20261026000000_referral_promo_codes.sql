-- Support for referral & thank-you promo codes generated for positive feedback.
-- Updates source check constraints and coupons insert trigger.

-- 1. Update source check constraint to allow 'referral' and 'thankyou'
alter table public.promo_codes drop constraint if exists promo_codes_source_check;
alter table public.promo_codes add constraint promo_codes_source_check
  check (source in ('manual', 'compensation', 'referral', 'thankyou', 'promotion'));

-- 2. Enhanced insert_into_coupons trigger: auto-assigns 10% for THANKYOU/referrals
create or replace function public.insert_into_coupons() returns trigger
language plpgsql as $$
declare
  v_tenant_id uuid;
  v_code text;
  v_pct int;
  v_source text;
begin
  v_tenant_id := coalesce(new.tenant_id, 'f00df051-0000-4000-8000-000000000001'::uuid);
  v_code := upper(regexp_replace(trim(new.code), '\s*-\s*', '-', 'g'));

  if new.discount_percent is not null then
    v_pct := new.discount_percent;
  elsif new.discount_amount is not null then
    v_pct := new.discount_amount;
  elsif v_code ~ '^THANKYOU' or v_code ~ '^REF' then
    v_pct := 10;
  else
    v_pct := 20;
  end if;

  if new.source is not null then
    v_source := new.source;
  elsif v_code ~ '^THANKYOU' or v_code ~ '^REF' then
    v_source := 'referral';
  else
    v_source := 'compensation';
  end if;

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
    v_source,
    new.feedback_id,
    new.issued_to_email,
    coalesce(new.expires_at, now() + interval '30 days')
  )
  on conflict (tenant_id, code) do update set
    discount_percentage = excluded.discount_percentage,
    expires_at = excluded.expires_at,
    source = excluded.source,
    feedback_id = coalesce(public.promo_codes.feedback_id, excluded.feedback_id),
    issued_to_email = coalesce(public.promo_codes.issued_to_email, excluded.issued_to_email);
  return new;
end $$;

drop trigger if exists coupons_insert_trigger on public.coupons;
create trigger coupons_insert_trigger
instead of insert on public.coupons
for each row execute function public.insert_into_coupons();

-- 3. check_promo_code supports default tenant fallback
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
  where (p_tenant_id is null or tenant_id = p_tenant_id or tenant_id = 'f00df051-0000-4000-8000-000000000001'::uuid)
    and upper(trim(code)) = v_clean
    and not is_used
    and (expires_at is null or expires_at > now())
  order by (tenant_id = p_tenant_id) desc
  limit 1;
  if v_pct is null then
    raise exception 'promo code is invalid or has already been used';
  end if;
  return v_pct;
end $$;
