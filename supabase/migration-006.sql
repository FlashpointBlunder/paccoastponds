-- Migration 006: Ticket/messaging system
-- Tables: tickets, ticket_messages

create table tickets (
  id                 uuid default uuid_generate_v4() primary key,
  service_account_id uuid references service_accounts(id) on delete cascade not null,
  category           text not null check (category in ('upcoming_visit','product_inquiry','billing_issue','ask_tech','pond_emergency')),
  subject            text not null,
  status             text not null default 'open' check (status in ('open','closed')),
  urgent             boolean not null default false,
  created_by         uuid references profiles(id) on delete set null,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create table ticket_messages (
  id         uuid default uuid_generate_v4() primary key,
  ticket_id  uuid references tickets(id) on delete cascade not null,
  sender_id  uuid references profiles(id) on delete set null,
  content    text not null,
  created_at timestamptz default now()
);

-- Auto-set urgent flag for pond_emergency
create or replace function set_ticket_urgent()
returns trigger language plpgsql as $$
begin
  if new.category = 'pond_emergency' then
    new.urgent := true;
  end if;
  return new;
end;
$$;

create trigger trg_ticket_urgent
  before insert or update on tickets
  for each row execute function set_ticket_urgent();

-- updated_at trigger
create or replace function touch_ticket()
returns trigger language plpgsql as $$
begin
  update tickets set updated_at = now() where id = new.ticket_id;
  return new;
end;
$$;

create trigger trg_touch_ticket
  after insert on ticket_messages
  for each row execute function touch_ticket();

-- RLS
alter table tickets enable row level security;
alter table ticket_messages enable row level security;

-- Admins see everything
create policy "Admins manage tickets"
  on tickets for all using (is_admin());

create policy "Admins manage ticket_messages"
  on ticket_messages for all using (is_admin());

-- Customers see their own tickets
create policy "Customers view own tickets"
  on tickets for select
  using (customer_owns_account(service_account_id));

create policy "Customers insert own tickets"
  on tickets for insert
  with check (customer_owns_account(service_account_id));

create policy "Customers view own ticket messages"
  on ticket_messages for select
  using (
    exists (
      select 1 from tickets t
      where t.id = ticket_id
      and customer_owns_account(t.service_account_id)
    )
  );

create policy "Customers insert ticket messages"
  on ticket_messages for insert
  with check (
    exists (
      select 1 from tickets t
      where t.id = ticket_id
      and customer_owns_account(t.service_account_id)
    )
  );

-- Techs see tickets on accounts they service (only ask_tech + pond_emergency)
create policy "Techs view routed tickets"
  on tickets for select
  using (
    category in ('ask_tech','pond_emergency')
    and tech_services_account(service_account_id)
  );

create policy "Techs view routed ticket messages"
  on ticket_messages for select
  using (
    exists (
      select 1 from tickets t
      where t.id = ticket_id
      and t.category in ('ask_tech','pond_emergency')
      and tech_services_account(t.service_account_id)
    )
  );

create policy "Techs insert ticket messages on routed tickets"
  on ticket_messages for insert
  with check (
    exists (
      select 1 from tickets t
      where t.id = ticket_id
      and t.category in ('ask_tech','pond_emergency')
      and tech_services_account(t.service_account_id)
    )
  );

-- Realtime
alter publication supabase_realtime add table tickets;
alter publication supabase_realtime add table ticket_messages;
