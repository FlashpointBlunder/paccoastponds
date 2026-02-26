-- Migration 005: Product categories with sub-categories
-- Run in: Supabase Dashboard → SQL Editor → New Query

create table product_categories (
  id          uuid default uuid_generate_v4() primary key,
  name        text not null,
  parent_id   uuid references product_categories(id) on delete set null,  -- null = top-level
  sort_order  integer default 0,
  created_at  timestamptz default now(),
  unique (name, parent_id)
);

alter table product_categories enable row level security;

create policy "Authenticated users view categories"
  on product_categories for select using (auth.role() = 'authenticated');

create policy "Admins manage categories"
  on product_categories for all using (is_admin());

-- Add category to products
alter table products
  add column if not exists category_id uuid references product_categories(id) on delete set null;
