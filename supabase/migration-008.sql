-- Migration 008: Helper to check if an auth user has confirmed their account
-- Used by admin to determine whether to show Send/Resend Invite button

create or replace function public.is_user_confirmed(uid uuid)
returns boolean language sql security definer set search_path = auth
as $$
  select email_confirmed_at is not null
  from auth.users
  where id = uid
$$;
