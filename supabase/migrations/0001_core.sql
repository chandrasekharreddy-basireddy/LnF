-- L&F :: 0001 core schema
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

create type public.item_type as enum ('lost', 'found');
create type public.item_status as enum (
  'pending_moderation', 'available', 'claimed', 'recovered', 'expired', 'quarantined', 'archived'
);
create type public.claim_status as enum ('submitted', 'under_review', 'approved', 'rejected', 'withdrawn');
create type public.app_role as enum ('admin', 'staff', 'member');
create type public.audit_severity as enum ('info', 'warn', 'alert');
create type public.notification_kind as enum ('match', 'claim_update', 'handover', 'system');

-- ---------- reference codes ----------
create sequence public.item_ref_seq start 1;
create sequence public.claim_ref_seq start 1;

create or replace function public.next_item_ref() returns text
language sql volatile as $$
  select 'LF-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.item_ref_seq')::text, 4, '0');
$$;

create or replace function public.next_claim_ref() returns text
language sql volatile as $$
  select 'CLM-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.claim_ref_seq')::text, 4, '0');
$$;

-- ---------- reference data ----------
create table public.campus_zones (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  is_active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(full_name) <= 120),
  email text,
  phone text check (char_length(phone) <= 20),
  alerts_opt_in boolean not null default false,
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- ---------- items ----------
create table public.items (
  id uuid primary key default gen_random_uuid(),
  ref_code text not null unique default public.next_item_ref(),
  type public.item_type not null,
  status public.item_status not null default 'available',
  category text not null check (char_length(category) between 2 and 40),
  title text not null check (char_length(title) between 3 and 120),
  public_description text not null check (char_length(public_description) between 10 and 1000),
  zone_id uuid references public.campus_zones (id) on delete set null,
  spot text check (char_length(spot) <= 120),
  event_date date not null check (event_date <= current_date),
  custody_label text,
  verification_question text check (char_length(verification_question) between 8 and 200),
  sensitive_hidden_photo boolean not null default false,
  is_sample boolean not null default false,
  reporter_id uuid references auth.users (id) on delete set null,
  reporter_kind text not null default 'member' check (reporter_kind in ('member', 'staff', 'owner')),
  contact_email text,
  finder_email text,
  expires_at timestamptz not null default now() + interval '90 days',
  published_at timestamptz default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_tsv tsvector generated always as (
    to_tsvector('english',
      coalesce(title, '') || ' ' || coalesce(public_description, '') || ' ' || coalesce(category, '') || ' ' || coalesce(spot, ''))
  ) stored
);

create index items_status_idx on public.items (status);
create index items_type_idx on public.items (type);
create index items_category_idx on public.items (category);
create index items_zone_idx on public.items (zone_id);
create index items_created_idx on public.items (created_at desc);
create index items_reporter_idx on public.items (reporter_id);
create index items_expires_idx on public.items (expires_at);
create index items_tsv_idx on public.items using gin (search_tsv);
create index items_title_trgm_idx on public.items using gin (title gin_trgm_ops);

create table public.item_private (
  item_id uuid primary key references public.items (id) on delete cascade,
  answer_hash text,
  private_notes text,
  serial_number text,
  bin_code text,
  finder_contact text
);

create table public.item_images (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  storage_path text not null,
  alt_text text not null check (char_length(alt_text) between 4 and 200),
  width int,
  height int,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index item_images_item_idx on public.item_images (item_id);

-- ---------- claims ----------
create table public.claims (
  id uuid primary key default gen_random_uuid(),
  ref_code text not null unique default public.next_claim_ref(),
  item_id uuid not null references public.items (id) on delete cascade,
  claimant_id uuid not null references auth.users (id) on delete cascade,
  answer_hash text,
  answer_matched boolean not null default false,
  proof text check (char_length(proof) <= 1000),
  status public.claim_status not null default 'submitted',
  decision_reason text,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index claims_one_open_per_item on public.claims (item_id, claimant_id)
  where status in ('submitted', 'under_review', 'approved');
create index claims_item_idx on public.claims (item_id);
create index claims_claimant_idx on public.claims (claimant_id);

create table public.claim_events (
  id bigserial primary key,
  claim_id uuid not null references public.claims (id) on delete cascade,
  status public.claim_status not null,
  note text,
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index claim_events_claim_idx on public.claim_events (claim_id, created_at);

create table public.handover_codes (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null unique references public.claims (id) on delete cascade,
  code_hash text not null,
  code_plain text not null,
  revealed_at timestamptz,
  used_at timestamptz,
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now()
);

create table public.handover_records (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  claim_id uuid references public.claims (id) on delete set null,
  staff_id uuid references auth.users (id) on delete set null,
  code_verified boolean not null default false,
  note text,
  created_at timestamptz not null default now()
);

-- ---------- matching, messaging, ops ----------
create table public.match_alerts (
  id uuid primary key default gen_random_uuid(),
  lost_item_id uuid not null references public.items (id) on delete cascade,
  found_item_id uuid not null references public.items (id) on delete cascade,
  score numeric(4, 3) not null default 0,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (lost_item_id, found_item_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind public.notification_kind not null default 'system',
  title text not null,
  body text not null,
  link text,
  read_at timestamptz,
  email_status text not null default 'none',
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.abuse_reports (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.items (id) on delete cascade,
  reporter_id uuid references auth.users (id) on delete set null,
  reporter_email text,
  reason text not null,
  details text check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'closed')),
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigserial primary key,
  actor_id uuid references auth.users (id) on delete set null,
  actor_role public.app_role,
  action text not null,
  resource_type text,
  resource_id uuid,
  detail jsonb not null default '{}'::jsonb,
  ip_hash text,
  severity public.audit_severity not null default 'info',
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_action_idx on public.audit_logs (action);

-- server-emitted product events; never contains personal data
create table public.events (
  id bigserial primary key,
  name text not null,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index events_name_idx on public.events (name, created_at desc);

create table public.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket, window_start)
);

-- ---------- triggers ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger items_touch before update on public.items
  for each row execute function public.touch_updated_at();
create trigger claims_touch before update on public.claims
  for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- profile row on signup
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', null))
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'member')
  on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- role helpers ----------
create or replace function public.has_role(uid uuid, r public.app_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = uid and role = r);
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role in ('staff', 'admin')
  );
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.rate_limit(p_bucket text, p_limit int, p_window interval)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_window timestamptz := date_trunc('hour', now()) + (floor(extract(epoch from now() - date_trunc('hour', now())) / extract(epoch from p_window)) * p_window);
  v_count int;
begin
  insert into public.rate_limits (bucket, window_start, count)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set count = public.rate_limits.count + 1
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;

revoke all on function public.rate_limit(text, int, interval) from public, anon, authenticated;
