-- Food Fusion — single login, hardcoded super admin, and a `staff` tier.
--
--   super_admin  ONLY the account with email bhawishk15@gmail.com
--   manager      operations/HR (one restaurant): orders, kitchen, inventory,
--                daily stock, reservations
--   staff        kitchen (one restaurant): live order queue + 86 toggle
--   user         default for every sign-up
--
-- Roles are stored in auth.users.raw_app_meta_data.role and set by the super
-- admin from /admin/users. A trigger re-validates every write, so even a
-- service-role mistake cannot mint a second super admin.

create or replace function public.super_admin_email() returns text
language sql immutable as $$ select 'bhawishk15@gmail.com'::text $$;

-- ─────────────────────────────────── 1. role assignment on sign-up/update ──

create or replace function public.assign_app_role() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  stored text := coalesce(new.raw_app_meta_data ->> 'role', 'user');
  effective text;
begin
  if lower(trim(coalesce(new.email, ''))) = public.super_admin_email() then
    effective := 'super_admin';
  elsif stored in ('manager', 'staff', 'user') then
    effective := stored;
  elsif stored = 'kitchen' then
    effective := 'manager';                  -- legacy name
  else
    effective := 'user';                     -- incl. a forged/legacy super_admin
  end if;
  new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', effective);
  return new;
end $$;

drop trigger if exists assign_app_role on auth.users;
create trigger assign_app_role
  before insert or update of raw_app_meta_data, email on auth.users
  for each row execute function public.assign_app_role();

-- Re-validate every existing account (fires the trigger).
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb);

-- ─────────────────────────────────────────────────── 2. role helpers ──

-- The token's email is verified by Supabase (Google OAuth / email OTP).
create or replace function public.jwt_role() returns text
language sql stable as $$
  select case
    when lower(coalesce(auth.jwt() ->> 'email', '')) = public.super_admin_email() then 'super_admin'
    else case coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'user')
      when 'manager' then 'manager'
      when 'kitchen' then 'manager'          -- legacy
      when 'staff'   then 'staff'
      else 'user'                            -- a stored super_admin is ignored
    end
  end
$$;

create or replace function public.has_role(required text) returns boolean
language sql stable as $$
  select case public.jwt_role()
    when 'super_admin' then true
    when 'manager'     then required in ('manager', 'staff')
    when 'staff'       then required = 'staff'
    else                    required = 'user'
  end
$$;

-- Kitchen access to restaurant t: its managers and staff, or the super admin.
create or replace function public.is_staff_of(t uuid) returns boolean
language sql stable as $$
  select public.jwt_role() = 'super_admin'
      or (public.jwt_role() in ('manager', 'staff') and public.jwt_tenant() = t)
$$;

-- Management of restaurant t: its managers, or the super admin.
create or replace function public.is_manager_of(t uuid) returns boolean
language sql stable as $$
  select public.jwt_role() = 'super_admin'
      or (public.jwt_role() = 'manager' and public.jwt_tenant() = t)
$$;

-- is_owner() (super admin) keeps its definition: jwt_role() = 'super_admin'.

-- ───────────────────────────────── 3. column guard for menu updates ──

create or replace function public.guard_menu_item_update() returns trigger
language plpgsql as $$
declare
  allowed text[];
begin
  -- Only police direct writes from client roles. Trusted server-side code
  -- (SECURITY DEFINER functions such as place_order() decrementing daily
  -- stock, the service role, migrations) runs as another database user.
  if current_user not in ('authenticated', 'anon') or public.is_owner() then
    return new;
  end if;
  -- Managers: availability + daily stock. Staff: the 86 toggle only.
  allowed := case when public.jwt_role() = 'manager'
                  then array['is_available', 'daily_stock', 'updated_at']
                  else array['is_available', 'updated_at'] end;
  if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception '% may only change %', public.jwt_role(), array_to_string(allowed[1:array_length(allowed, 1) - 1], ' and ')
      using errcode = '42501';
  end if;
  return new;
end $$;

-- ─────────────────────────────── 4. reservations are management-only ──

drop policy if exists reservations_read on public.reservations;
drop policy if exists reservations_staff_update on public.reservations;
create policy reservations_read on public.reservations
  for select to authenticated
  using (customer_id = auth.uid() or public.is_manager_of(tenant_id));
create policy reservations_manager_update on public.reservations
  for update to authenticated
  using (public.is_manager_of(tenant_id)) with check (public.is_manager_of(tenant_id));
