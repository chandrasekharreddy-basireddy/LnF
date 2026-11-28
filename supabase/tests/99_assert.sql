-- Assertions over the migrated schema. Runs after every migration, on a real
-- Postgres, in CI. Each one is a statement that must be true; psql exits
-- non-zero on the first failure because the runner uses ON_ERROR_STOP.

\set ON_ERROR_STOP on

do $$
begin
  -- the bug that survived four passes: pgcrypto unreachable from a definer function
  perform public.assert_write_paths_hashable();

  -- RLS is on for every table that holds a person
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
      and c.relname in ('items', 'claims', 'profiles', 'claim_messages', 'saved_items',
                        'notifications', 'abuse_reports', 'disputes', 'push_subscriptions',
                        'audit_logs', 'email_outbox', 'claim_drafts')
  ) then
    raise exception 'RLS is off on a table that holds personal data';
  end if;

  -- the tables whose contents are bearer secrets must not be readable by a member
  if has_table_privilege('authenticated', 'public.push_subscriptions', 'select') then
    raise exception 'authenticated can select push_subscriptions';
  end if;
  if has_table_privilege('authenticated', 'public.disputes', 'select') then
    raise exception 'authenticated can select disputes';
  end if;

  -- the functions that must never be callable by a stranger
  if has_function_privilege('anon', 'public.admin_erase_user_data(uuid)', 'execute') then
    raise exception 'anon can erase a user';
  end if;
  if has_function_privilege('anon', 'public.bulk_import_items(jsonb, text)', 'execute') then
    raise exception 'anon can bulk import';
  end if;
  if has_function_privilege('authenticated', 'public.has_role(uuid, public.app_role)', 'execute') then
    raise exception 'a member can call has_role()';
  end if;

  -- the one-approved-per-item invariant
  if not exists (select 1 from pg_indexes where indexname = 'claims_one_approved_per_item') then
    raise exception 'the one-approved-claim-per-item index is missing';
  end if;

  -- the push endpoint allowlist (SSRF)
  if not exists (select 1 from pg_constraint where conname = 'push_endpoint_allowed_host') then
    raise exception 'the push endpoint allowlist is missing';
  end if;

  -- a handover code may be nulled once spent
  if exists (
    select 1 from information_schema.columns
    where table_name = 'handover_codes' and column_name = 'code_plain' and is_nullable = 'NO'
  ) then
    raise exception 'code_plain is still not null, so a handover cannot spend it';
  end if;

  raise notice 'all schema assertions passed';
end $$;

-- a real write, end to end: report a found item as a member and read it back
insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000001', 'ci@lnf.test')
  on conflict (id) do nothing;
insert into public.profiles (id, full_name, email)
  values ('00000000-0000-4000-8000-000000000001', 'CI Member', 'ci@lnf.test')
  on conflict (id) do nothing;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","email":"ci@lnf.test"}', false);

do $$
declare v_result jsonb;
begin
  -- this is the call that failed in production when search_path lost extensions
  v_result := public.create_item(
    'found', 'other', 'CI probe listing',
    'A listing created by the CI schema check', null, null, current_date,
    null, 'What proves this?', 'the probe', false, null, null);

  if (v_result ->> 'ok')::boolean is not true then
    raise exception 'create_item returned %', v_result;
  end if;

  -- and the claim path that hashes the answer
  if not exists (
    select 1 from public.item_private p
    join public.items i on i.id = p.item_id
    where i.ref_code = v_result ->> 'ref' and p.answer_hash is not null
  ) then
    raise exception 'the answer was not hashed';
  end if;

  raise notice 'write path works: %', v_result ->> 'ref';
end $$;
