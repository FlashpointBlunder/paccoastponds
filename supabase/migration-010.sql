-- ============================================================
-- MIGRATION 010: Jobs, Proposals, Job Types
-- ============================================================

-- job_types
create table if not exists job_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#1E5E37',
  active boolean not null default true,
  created_at timestamptz default now()
);

insert into job_types (name, color) values
  ('Routine Service', '#1E5E37'),
  ('Clean Out',       '#2CA7DF'),
  ('Filter Cleaning', '#6366f1'),
  ('Install',         '#f59e0b'),
  ('Build',           '#ef4444');

-- proposals (before jobs so jobs can FK to it)
create table if not exists proposals (
  id uuid primary key default gen_random_uuid(),
  service_account_id uuid references service_accounts(id) on delete cascade,
  title text not null,
  notes text,
  status text not null default 'draft'
    check (status in ('draft','sent','accepted','changes_requested','declined')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- jobs
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  service_account_id uuid references service_accounts(id) on delete cascade,
  tech_id uuid references technicians(id) on delete set null,
  job_type_id uuid references job_types(id) on delete set null,
  proposal_id uuid references proposals(id) on delete set null,
  address text,
  notes text,
  status text not null default 'scheduled'
    check (status in ('scheduled','on_the_way','in_progress','completed','cancelled')),
  scheduled_date date,
  scheduled_time time,
  started_at timestamptz,
  on_the_way_at timestamptz,
  completed_at timestamptz,
  is_recurring boolean not null default false,
  recurrence_pattern text check (recurrence_pattern in ('weekly','biweekly','monthly')),
  recurring_parent_id uuid references jobs(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- proposal_line_items
create table if not exists proposal_line_items (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid references proposals(id) on delete cascade,
  description text not null,
  quantity numeric not null default 1,
  unit_price numeric not null default 0,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

-- proposal_messages
create table if not exists proposal_messages (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid references proposals(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  body text not null,
  created_at timestamptz default now()
);

-- extend service_accounts
alter table service_accounts add column if not exists sms_opted_in boolean not null default false;
alter table service_accounts add column if not exists phone text;

-- extend basket_items to link to jobs and support custom items
alter table basket_items add column if not exists job_id uuid references jobs(id) on delete set null;
alter table basket_items add column if not exists notes text;
alter table basket_items add column if not exists unit_price numeric;

-- ── RLS: job_types ────────────────────────────────────────────
alter table job_types enable row level security;
create policy "Authenticated view job types"  on job_types for select using (auth.uid() is not null);
create policy "Admins manage job types"        on job_types for all    using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- ── RLS: jobs ─────────────────────────────────────────────────
alter table jobs enable row level security;
create policy "Admins full access to jobs"    on jobs for all    using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
create policy "Techs select their jobs"       on jobs for select using (tech_id in (select id from technicians where user_id = auth.uid()));
create policy "Techs update their jobs"       on jobs for update using (tech_id in (select id from technicians where user_id = auth.uid()));
create policy "Techs insert jobs"             on jobs for insert with check (true); -- needed for recurring next-instance creation
create policy "Customers view their jobs"     on jobs for select using (service_account_id in (select id from service_accounts where customer_id = auth.uid()));

-- ── RLS: proposals ────────────────────────────────────────────
alter table proposals enable row level security;
create policy "Admins full access to proposals"        on proposals for all    using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
create policy "Customers view their proposals"         on proposals for select using (service_account_id in (select id from service_accounts where customer_id = auth.uid()));
create policy "Customers update proposal status"       on proposals for update using (service_account_id in (select id from service_accounts where customer_id = auth.uid()));

-- ── RLS: proposal_line_items ──────────────────────────────────
alter table proposal_line_items enable row level security;
create policy "Admins full access to proposal_line_items" on proposal_line_items for all    using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
create policy "Customers view their proposal line items"  on proposal_line_items for select using (
  proposal_id in (select p.id from proposals p join service_accounts sa on p.service_account_id = sa.id where sa.customer_id = auth.uid())
);

-- ── RLS: proposal_messages ────────────────────────────────────
alter table proposal_messages enable row level security;
create policy "Admins full access to proposal_messages"        on proposal_messages for all using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
create policy "Customers manage their proposal messages"       on proposal_messages for all using (
  proposal_id in (select p.id from proposals p join service_accounts sa on p.service_account_id = sa.id where sa.customer_id = auth.uid())
);

-- realtime
alter publication supabase_realtime add table proposal_messages;
