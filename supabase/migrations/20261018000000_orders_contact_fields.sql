-- Add phone and delivery_address contact fields to orders table.
-- These are stored at order time so dispatch can see them without joining profiles.
alter table public.orders add column if not exists phone           text;
alter table public.orders add column if not exists delivery_address text;

-- RLS policies: customers may insert their own orders; super-admin / manager may read all.
-- Existing policies already cover these new columns transitively through row access.

-- Make sure Realtime is enabled (idempotent).
do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
end $$;
