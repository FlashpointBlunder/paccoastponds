-- Migration 009: customer_visible flag on products
-- Controls which products appear in the customer-facing shop.
-- Default false (tech-only). Admin explicitly enables per product.

-- 1. Add column
alter table products
  add column if not exists customer_visible boolean default false;

-- 2. Helper: is the current user a technician?
create or replace function is_tech()
returns boolean language sql security definer set search_path = public
as $$
  select exists (select 1 from technicians where user_id = auth.uid())
$$;

-- 3. Replace the broad authenticated-user policy with role-specific ones.
--    Admins already see everything via "Admins manage products" (for all).
drop policy if exists "Authenticated users view active products" on products;

-- Customers: only active products marked customer_visible
create policy "Customers view customer_visible products"
  on products for select
  using (
    active = true
    and customer_visible = true
    and exists (select 1 from profiles where id = auth.uid() and role = 'customer')
  );

-- Techs: all active products
create policy "Techs view all active products"
  on products for select
  using (active = true and is_tech());
