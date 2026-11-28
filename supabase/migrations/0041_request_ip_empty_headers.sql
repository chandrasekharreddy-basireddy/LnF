-- L&F :: 0041 request_ip() must survive a request with no headers
--
-- 0040 cast the request-headers GUC straight to json. Outside PostgREST — a
-- direct psql session, a cron job, a migration — that GUC is empty and the cast
-- raises 22P02, so every caller of request_ip() failed rather than falling back.
-- Found on the first call after applying 0040.

create or replace function public.request_ip(p_fallback text default null)
returns text language sql stable as $$
  select coalesce(
    nullif(btrim(
      (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'x-real-ip'), ''),
    nullif(btrim(
      (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'cf-connecting-ip'), ''),
    nullif(btrim(regexp_replace(
      (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'x-forwarded-for',
      '^.*,\s*', '')), ''),
    nullif(btrim(coalesce(p_fallback, '')), '')
  );
$$;

revoke all on function public.request_ip(text) from public, anon, authenticated;
grant execute on function public.request_ip(text) to service_role;

notify pgrst, 'reload schema';
