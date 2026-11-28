-- Minimal Supabase-shaped schema for a plain Postgres instance.
--
-- The migrations target Supabase, which supplies auth, storage, the roles and
-- pg_cron. A CI Postgres has none of that, so this file builds just enough of
-- the shape for the migrations to run — no data, no policies of its own.
--
-- It exists so the SQL is executed somewhere before it reaches a live project:
-- the search_path bug (0017 -> 0022 -> 0025 -> 0038) survived four passes
-- because nothing ever ran the migrations against a real database.

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists cron;
create schema if not exists realtime;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then create role supabase_admin nologin; end if;
end $$;

grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;

-- auth.users: only the columns the migrations touch
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- the three auth helpers the migrations call
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'sub'
    ), ''
  )::uuid;
$$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'role',
    'anon'
  );
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

-- storage: the two objects the migrations reference
create table if not exists storage.buckets (
  id text primary key,
  name text,
  owner uuid,
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text,
  user_metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now()
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name, '/');
$$;

-- pg_cron: record the schedule instead of running it
create table if not exists cron.job (
  jobid serial primary key,
  schedule text,
  command text,
  jobname text,
  active boolean default true
);

create or replace function cron.schedule(job_name text, schedule text, command text)
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  returning jobid into v_id;
  return v_id;
end $$;

create or replace function cron.schedule(schedule text, command text)
returns bigint language plpgsql as $$
begin
  return cron.schedule('job-' || gen_random_uuid()::text, schedule, command);
end $$;

-- realtime: the migrations add tables to the publication
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- Supabase's migration bookkeeping, so migrations that record themselves work
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  name text,
  inserted_at timestamptz default now()
);
