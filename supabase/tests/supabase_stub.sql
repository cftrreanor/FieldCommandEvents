-- Minimal stand-in for the parts of Supabase our migrations rely on, so the
-- schema and its security rules can be tested against plain Postgres
-- (see scripts/test-db.sh). Not used in production.
create extension if not exists pgcrypto;
do $$ begin
  create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz
);
create table auth.audit_log_entries (
  instance_id uuid,
  id uuid primary key default gen_random_uuid(),
  payload json,
  created_at timestamptz default now(),
  ip_address varchar(64) not null default ''
);
-- Like Supabase's: null when there are no claims (a direct database session).
create function auth.jwt() returns jsonb language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
-- Tables get no access automatically (as on Supabase from October 30, 2026):
-- each migration grants it explicitly.
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Supabase Storage's bucket list (files themselves aren't needed for these tests).
create schema storage;
create table storage.buckets (
  id                  text primary key,
  name                text not null,
  public              boolean default false,
  file_size_limit     bigint,
  allowed_mime_types  text[]
);
-- Its file list, enough for the sponsor logo cleanup (sponsor_logo_orphans).
create table storage.objects (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text,
  name        text,
  created_at  timestamptz default now()
);
