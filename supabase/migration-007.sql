-- Migration 007: Customer enhancements — subscription, billing address, equipment, photos

-- New columns on service_accounts
alter table service_accounts
  add column if not exists is_subscription  boolean not null default false,
  add column if not exists billing_address  text,
  add column if not exists equipment_notes  text;

-- Pond photos storage bucket (private)
insert into storage.buckets (id, name, public)
  values ('pond-photos', 'pond-photos', false)
  on conflict (id) do nothing;

-- Admins can manage all pond photos
create policy "Admins manage pond photos"
  on storage.objects for all
  using  (bucket_id = 'pond-photos' and public.is_admin())
  with check (bucket_id = 'pond-photos' and public.is_admin());

-- Customers can view photos for their own account folder
create policy "Customers view own pond photos"
  on storage.objects for select
  using (
    bucket_id = 'pond-photos'
    and public.customer_owns_account(
      (string_to_array(name, '/'))[1]::uuid
    )
  );
