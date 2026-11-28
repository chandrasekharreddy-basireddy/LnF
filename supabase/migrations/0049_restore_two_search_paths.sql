-- L&F :: 0049 the probe caught 0048
--
-- 0048 re-created check_signin_allowed() and log_auth_event() from their 0016
-- bodies, which carry `set search_path = public`. Both call digest(), so both
-- lost pgcrypto. Nothing failed at apply time; the assertion inside
-- assert_write_paths_hashable() caught it on the CI run, and the search_path
-- guard would have caught it statically.
--
-- This is the fourth occurrence of the same mistake, and the first one that did
-- not reach production.

alter function public.check_signin_allowed(text, text) set search_path = public, extensions;
alter function public.log_auth_event(text, text, text) set search_path = public, extensions;

select public.assert_write_paths_hashable();
