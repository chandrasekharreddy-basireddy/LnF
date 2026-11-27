-- L&F :: 0025 re-apply the search_path guard after 0022/0023
--
-- 0017 appended `extensions` to every definer function that calls digest(), so
-- pgcrypto resolves. Then 0022 re-created create_item from its 0018 body, which
-- carried `set search_path = public` — silently undoing the fix. The first run
-- of the full claim lifecycle since then failed with
--   42883: function digest(text, unknown) does not exist
-- on the very first report. Nothing else caught it: the read paths are fine, the
-- unit tests never touch SQL, and smoke renders pages, not writes.
--
-- This is the same idempotent sweep as 0017. It is written to be safe to run
-- again, and the lifecycle check in docs is the thing that proves it.

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
      and (p.proconfig is null or array_to_string(p.proconfig, ',') not like '%extensions%')
  loop
    execute format('alter function %s set search_path = public, extensions', target.signature);
    raise notice 'search_path restored on %', target.signature;
  end loop;
end;
$$;

-- A probe a future migration can call: if this raises, the guard is missing.
create or replace function public.assert_write_paths_hashable()
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  v_missing text;
begin
  select string_agg(p.proname, ', ')
    into v_missing
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and p.prosrc like '%digest(%'
     and (p.proconfig is null or array_to_string(p.proconfig, ',') not like '%extensions%');

  if v_missing is not null then
    raise exception 'definer functions without pgcrypto on their search_path: %', v_missing;
  end if;

  return 'ok';
end;
$$;

revoke all on function public.assert_write_paths_hashable() from public, anon, authenticated;
grant execute on function public.assert_write_paths_hashable() to service_role;

select public.assert_write_paths_hashable();
