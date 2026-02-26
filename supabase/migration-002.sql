-- Migration 002: Add email to profiles for post-invite access
-- Run in: Supabase Dashboard → SQL Editor → New Query

alter table profiles
  add column if not exists email text;

-- Update handle_new_user trigger to also capture email
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into profiles (id, role, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'customer'),
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email
  );
  return new;
end;
$$;
