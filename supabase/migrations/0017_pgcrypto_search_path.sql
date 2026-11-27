-- L&F :: 0017 fix a runtime failure in every function that hashes
--
-- pgcrypto is installed in the `extensions` schema on Supabase, but every
-- SECURITY DEFINER function here sets `search_path = public` for safety. That
-- hid `digest()`, so these paths raised
--   42883: function digest(text, unknown) does not exist
-- the first time a real user touched them:
--
--   create_item            -> hashing the verification answer when reporting
--   submit_claim           -> hashing the answer when claiming
--   staff_decide_claim     -> hashing the issued handover code
--   staff_confirm_handover -> verifying the handover code
--   check_signin_allowed   -> hashing the address for the throttle bucket
--   log_auth_event         -> hashing the address in the audit row
--
-- Nothing caught it earlier because every SQL check ran the read paths
-- (search, item detail, stats) and never created or claimed an item.
--
-- `extensions` is appended, not prepended: a schema in public still wins, so
-- this cannot be used to shadow a function.

do $$
declare
  target record;
begin
  for target in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prosrc like '%digest(%'
  loop
    execute format('alter function %s set search_path = public, extensions', target.signature);
  end loop;
end;
$$;

-- Prove it, and leave the proof behind as a test the next migration can run.
create or replace function public.assert_digest_available()
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  return encode(digest('probe', 'sha256'), 'hex');
end;
$$;

revoke all on function public.assert_digest_available() from public, anon, authenticated;
grant execute on function public.assert_digest_available() to service_role;

notify pgrst, 'reload schema';
