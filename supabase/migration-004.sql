-- Migration 004: Add active flag to technicians
-- Run in: Supabase Dashboard → SQL Editor → New Query

alter table technicians
  add column if not exists active boolean default true;
