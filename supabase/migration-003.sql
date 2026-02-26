-- Migration 003: Fix RLS infinite recursion with security definer helpers
-- Run in: Supabase Dashboard → SQL Editor → New Query

-- Security definer functions bypass RLS inside the subquery,
-- breaking the circular dependency between service_accounts ↔ service_visits

create or replace function customer_owns_account(account_id uuid)
returns boolean language sql security definer set search_path = public
as $$
  select exists (
    select 1 from service_accounts
    where id = account_id and customer_id = auth.uid()
  )
$$;

create or replace function tech_services_account(account_id uuid)
returns boolean language sql security definer set search_path = public
as $$
  select exists (
    select 1 from service_visits sv
    join technicians t on t.id = sv.tech_id
    where sv.service_account_id = account_id
      and t.user_id = auth.uid()
  )
$$;

-- ─── service_accounts ───────────────────────────────────────────────────────
drop policy if exists "Techs view accounts they service" on service_accounts;

create policy "Techs view accounts they service"
  on service_accounts for select using (tech_services_account(id));

-- ─── service_visits ─────────────────────────────────────────────────────────
drop policy if exists "Customers view own visits" on service_visits;

create policy "Customers view own visits"
  on service_visits for select using (customer_owns_account(service_account_id));

-- ─── messages ───────────────────────────────────────────────────────────────
drop policy if exists "Customers view and send own messages" on messages;
drop policy if exists "Techs view and send messages for their accounts" on messages;

create policy "Customers view and send own messages"
  on messages for all using (customer_owns_account(service_account_id));

create policy "Techs view and send messages for their accounts"
  on messages for all using (tech_services_account(service_account_id));

-- ─── basket_items ────────────────────────────────────────────────────────────
drop policy if exists "Customers manage own basket" on basket_items;
drop policy if exists "Techs manage basket for their visits" on basket_items;

create policy "Customers manage own basket"
  on basket_items for all using (customer_owns_account(service_account_id));

create policy "Techs manage basket for their visits"
  on basket_items for all using (tech_services_account(service_account_id));
