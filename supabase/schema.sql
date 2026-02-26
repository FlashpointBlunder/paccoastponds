-- ============================================================
-- Pacific Coast Ponds — Database Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ─── EXTENSIONS ─────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ═══════════════════════════════════════════════════════════
-- STEP 1: CREATE ALL TABLES (no policies yet)
-- ═══════════════════════════════════════════════════════════

create table profiles (
  id          uuid references auth.users(id) on delete cascade primary key,
  role        text not null check (role in ('customer', 'tech', 'admin')),
  full_name   text,
  phone       text,
  created_at  timestamptz default now()
);

create table technicians (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references profiles(id) on delete cascade unique not null,
  created_at  timestamptz default now()
);

create table service_accounts (
  id                  uuid default uuid_generate_v4() primary key,
  customer_id         uuid references profiles(id) on delete set null,
  address             text,
  monthly_service_fee numeric(10,2) default 0,
  pond_notes          text,
  stripe_customer_id  text,
  active              boolean default true,
  created_at          timestamptz default now()
);

create table service_visits (
  id                  uuid default uuid_generate_v4() primary key,
  service_account_id  uuid references service_accounts(id) on delete cascade not null,
  tech_id             uuid references technicians(id) on delete set null,
  scheduled_date      timestamptz not null,
  status              text default 'scheduled'
                        check (status in ('scheduled','in_progress','completed','cancelled')),
  notes               text,
  tech_notes          text,
  created_at          timestamptz default now()
);

create table messages (
  id                  uuid default uuid_generate_v4() primary key,
  service_account_id  uuid references service_accounts(id) on delete cascade not null,
  sender_id           uuid references profiles(id) on delete set null,
  content             text not null,
  read_by_admin       boolean default false,
  read_by_customer    boolean default false,
  created_at          timestamptz default now()
);

create table products (
  id          uuid default uuid_generate_v4() primary key,
  name        text not null,
  description text,
  price       numeric(10,2) not null,
  sku         text unique,
  active      boolean default true,
  created_at  timestamptz default now()
);

create table basket_items (
  id                  uuid default uuid_generate_v4() primary key,
  service_account_id  uuid references service_accounts(id) on delete cascade not null,
  product_id          uuid references products(id) on delete cascade not null,
  quantity            integer default 1 check (quantity > 0),
  visit_id            uuid references service_visits(id) on delete set null,
  requested_by        text check (requested_by in ('customer', 'tech')),
  billed              boolean default false,
  created_at          timestamptz default now()
);

create table monthly_invoices (
  id                        uuid default uuid_generate_v4() primary key,
  service_account_id        uuid references service_accounts(id) on delete cascade not null,
  period_start              date not null,
  period_end                date not null,
  status                    text default 'open'
                              check (status in ('open','pending_charge','paid','failed','void')),
  total_amount              numeric(10,2) default 0,
  stripe_invoice_id         text,
  stripe_payment_intent_id  text,
  sent_at                   timestamptz,
  paid_at                   timestamptz,
  created_at                timestamptz default now()
);

create table invoice_line_items (
  id          uuid default uuid_generate_v4() primary key,
  invoice_id  uuid references monthly_invoices(id) on delete cascade not null,
  description text not null,
  amount      numeric(10,2) not null,
  type        text check (type in ('service', 'product')),
  product_id  uuid references products(id) on delete set null,
  quantity    integer default 1,
  created_at  timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════
-- STEP 2: FUNCTIONS & TRIGGERS
-- (profiles table exists now so is_admin() can reference it)
-- ═══════════════════════════════════════════════════════════

create or replace function is_admin()
returns boolean language sql security definer set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  )
$$;

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into profiles (id, role, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'customer'),
    coalesce(new.raw_user_meta_data->>'full_name', new.email)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ═══════════════════════════════════════════════════════════
-- STEP 3: ENABLE RLS ON ALL TABLES
-- ═══════════════════════════════════════════════════════════

alter table profiles           enable row level security;
alter table technicians        enable row level security;
alter table service_accounts   enable row level security;
alter table service_visits     enable row level security;
alter table messages           enable row level security;
alter table products           enable row level security;
alter table basket_items       enable row level security;
alter table monthly_invoices   enable row level security;
alter table invoice_line_items enable row level security;

-- ═══════════════════════════════════════════════════════════
-- STEP 4: ALL RLS POLICIES
-- (all tables exist now so cross-table references are safe)
-- ═══════════════════════════════════════════════════════════

-- profiles
create policy "Users view own profile"
  on profiles for select using (auth.uid() = id);
create policy "Admins view all profiles"
  on profiles for select using (is_admin());
create policy "Admins update all profiles"
  on profiles for update using (is_admin());

-- technicians
create policy "Admins manage technicians"
  on technicians for all using (is_admin());
create policy "Techs view own record"
  on technicians for select using (user_id = auth.uid());

-- service_accounts
create policy "Customers view own account"
  on service_accounts for select using (customer_id = auth.uid());
create policy "Admins manage all accounts"
  on service_accounts for all using (is_admin());
create policy "Techs view accounts they service"
  on service_accounts for select using (
    exists (
      select 1 from service_visits sv
      join technicians t on t.id = sv.tech_id
      where sv.service_account_id = service_accounts.id
        and t.user_id = auth.uid()
    )
  );

-- service_visits
create policy "Customers view own visits"
  on service_visits for select using (
    exists (
      select 1 from service_accounts
      where id = service_account_id and customer_id = auth.uid()
    )
  );
create policy "Techs view assigned visits"
  on service_visits for select using (
    exists (select 1 from technicians where id = tech_id and user_id = auth.uid())
  );
create policy "Techs update assigned visits"
  on service_visits for update using (
    exists (select 1 from technicians where id = tech_id and user_id = auth.uid())
  );
create policy "Admins manage all visits"
  on service_visits for all using (is_admin());

-- messages
create policy "Customers view and send own messages"
  on messages for all using (
    exists (
      select 1 from service_accounts
      where id = service_account_id and customer_id = auth.uid()
    )
  );
create policy "Techs view and send messages for their accounts"
  on messages for all using (
    exists (
      select 1 from service_visits sv
      join technicians t on t.id = sv.tech_id
      where sv.service_account_id = messages.service_account_id
        and t.user_id = auth.uid()
    )
  );
create policy "Admins manage all messages"
  on messages for all using (is_admin());

-- products
create policy "Authenticated users view active products"
  on products for select using (auth.role() = 'authenticated' and active = true);
create policy "Admins manage products"
  on products for all using (is_admin());

-- basket_items
create policy "Customers manage own basket"
  on basket_items for all using (
    exists (
      select 1 from service_accounts
      where id = service_account_id and customer_id = auth.uid()
    )
  );
create policy "Techs manage basket for their visits"
  on basket_items for all using (
    exists (
      select 1 from service_visits sv
      join technicians t on t.id = sv.tech_id
      where sv.service_account_id = basket_items.service_account_id
        and t.user_id = auth.uid()
    )
  );
create policy "Admins manage all basket items"
  on basket_items for all using (is_admin());

-- monthly_invoices
create policy "Customers view own invoices"
  on monthly_invoices for select using (
    exists (
      select 1 from service_accounts
      where id = service_account_id and customer_id = auth.uid()
    )
  );
create policy "Admins manage all invoices"
  on monthly_invoices for all using (is_admin());

-- invoice_line_items
create policy "Customers view own line items"
  on invoice_line_items for select using (
    exists (
      select 1 from monthly_invoices mi
      join service_accounts sa on sa.id = mi.service_account_id
      where mi.id = invoice_id and sa.customer_id = auth.uid()
    )
  );
create policy "Admins manage all line items"
  on invoice_line_items for all using (is_admin());

-- ═══════════════════════════════════════════════════════════
-- STEP 5: REALTIME
-- ═══════════════════════════════════════════════════════════

alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table service_visits;
alter publication supabase_realtime add table basket_items;
