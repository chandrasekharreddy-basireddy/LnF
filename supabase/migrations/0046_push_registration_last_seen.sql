-- L&F :: 0046 push registration, the second wrong column
--
-- 0045 fixed failed_count/last_error. The same function also writes
-- `updated_at`, which this table does not have either — it has last_seen_at.
-- Both were found by running it, not by reading it: the function had never been
-- called successfully, so neither column name had ever been checked.
--
-- register_push_subscription (0037) inserts into push_subscriptions.failed_count
-- and .last_error. The table has `failures` and `disabled_at`. Every call has
-- therefore raised 42703 since it was written, so push has never registered a
-- device — and the SSRF allowlist and the five-device cap inside that function
-- never ran at all, because the function died before reaching them.
--
-- Found by the database audit, 28/11, by reading the catalog rather than the file.

create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_endpoint text := btrim(coalesce(p_endpoint, ''));
  v_p256dh text := btrim(coalesce(p_p256dh, ''));
  v_auth text := btrim(coalesce(p_auth, ''));
  v_ua text := nullif(left(btrim(coalesce(p_user_agent, '')), 200), '');
  v_existing_owner uuid;
  v_count int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); end if;
  if not public.rate_limit('push_reg:' || v_uid::text, 15, interval '1 hour') then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;

  if v_endpoint !~* '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com|[a-z0-9-]+\.push\.services\.mozilla\.com)/[^[:space:]]+$'
     or char_length(v_endpoint) < 20 or char_length(v_endpoint) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'BAD_ENDPOINT');
  end if;
  if char_length(v_p256dh) < 16 or char_length(v_p256dh) > 200
     or char_length(v_auth) < 8 or char_length(v_auth) > 100 then
    return jsonb_build_object('ok', false, 'error', 'BAD_KEY');
  end if;

  select user_id into v_existing_owner from public.push_subscriptions where endpoint = v_endpoint;
  if v_existing_owner is not null and v_existing_owner <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'BAD_ENDPOINT');
  end if;

  select count(*) into v_count from public.push_subscriptions where user_id = v_uid and endpoint <> v_endpoint;
  if v_count >= 5 then
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY_DEVICES');
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, failures, disabled_at)
  values (v_uid, v_endpoint, v_p256dh, v_auth, v_ua, 0, null)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        failures = 0,
        disabled_at = null,
        last_seen_at = now();

  update public.profiles set push_opt_in = true where id = v_uid;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
