-- Migration 001: Add contact fields for uninvited customers
-- Run in: Supabase Dashboard → SQL Editor

alter table service_accounts
  add column if not exists contact_name    text,
  add column if not exists contact_email   text,
  add column if not exists contact_phone   text,
  add column if not exists invite_sent_at  timestamptz;
