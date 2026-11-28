-- L&F :: 0039 the search_path bug, for the third and last time
--
-- 0038 re-created create_item from its 0022 body, which carried
-- `set search_path = public`. pgcrypto lives in `extensions`, so digest() was
-- unreachable and EVERY report failed with 42883. The same class of bug has now
-- happened three times: 0017 fixed it, 0022 reintroduced it, 0025 fixed it,
-- 0038 reintroduced it.
--
-- A patch each time is not a fix. So this migration does three things:
--   1. repairs create_item, with its grants, which 0038 also forgot
--   2. re-runs the sweep over every definer function that calls digest()
--   3. adds a CI guard (scripts/check-search-path.mjs) that fails the build when
--      a migration defines such a function without `extensions`. The database
--      cannot enforce this itself: event triggers need superuser, which Supabase
--      does not grant.
--
-- Also from the same audit: the throttle key hashed the whole x-forwarded-for
-- chain, which changes on every request, so the bucket never filled. There is
-- now one helper that takes the hop the proxy appended, and the four functions
-- that throttle by address use it.

-- ---------------------------------------------------------------- 1. the ip
create or replace function public.request_ip(p_fallback text default null)
returns text language sql stable as $$
  -- PostgREST publishes the request headers as a GUC the client cannot forge.
  -- x-forwarded-for is a chain; the last hop is the one our proxy appended, and
  -- the only entry a client cannot set.
  select coalesce(
    nullif(btrim(coalesce(current_setting('request.headers', true), '')::json ->> 'x-real-ip'), ''),
    nullif(btrim(coalesce(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip'), ''),
    nullif(btrim(regexp_replace(
      coalesce(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for',
      '^.*,\s*', '')), ''),
    nullif(btrim(coalesce(p_fallback, '')), '')
  );
$$;

revoke all on function public.request_ip(text) from public, anon, authenticated;
grant execute on function public.request_ip(text) to service_role;

-- ---------------------------------------------------------------- 2. create_item
create or replace function public.create_item(
  p_type text,
  p_category text,
  p_title text,
  p_description text,
  p_zone_code text default null,
  p_spot text default null,
  p_event_date date default current_date,
  p_custody text default null,
  p_question text default null,
  p_answer text default null,
  p_sensitive boolean default false,
  p_contact_email text default null,
  p_finder_email text default null,
  p_reporter_kind text default 'member'
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_item public.items;
  v_zone uuid;
  v_status public.item_status := 'available';
  v_text text;
  v_id_hit boolean := false;
  v_id_terms text[] := array[
    'aadhaar', 'passport', 'pan card', 'driving licence', 'driving license',
    'voter id', 'id card', 'identity card', 'atm card', 'debit card', 'credit card'
  ];
  v_term text;
  v_days int;
  v_auto_hide boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;
  if not public.rate_limit('create_item:' || v_uid::text, 12, interval '1 hour') then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;
  if p_type not in ('lost', 'found') then
    return jsonb_build_object('ok', false, 'error', 'BAD_TYPE');
  end if;
  if p_title is null or char_length(btrim(p_title)) < 3 then
    return jsonb_build_object('ok', false, 'error', 'TITLE_TOO_SHORT');
  end if;
  if p_description is null or char_length(btrim(p_description)) < 10 then
    return jsonb_build_object('ok', false, 'error', 'DESCRIPTION_TOO_SHORT');
  end if;
  -- "today" is the desk's today, not UTC's
  if p_event_date is null
     or p_event_date > (now() at time zone 'Asia/Kolkata')::date then
    return jsonb_build_object('ok', false, 'error', 'DATE_IN_FUTURE');
  end if;
  if p_event_date < current_date - 365 then
    return jsonb_build_object('ok', false, 'error', 'DATE_TOO_OLD');
  end if;

  v_text := lower(coalesce(p_title, '') || ' ' || coalesce(p_description, ''));
  foreach v_term in array v_id_terms loop
    if position(v_term in v_text) > 0 then v_id_hit := true; end if;
  end loop;

  if p_type = 'found' and v_id_hit then
    v_status := 'quarantined';
  elsif not public.is_staff()
        and (select count(*) from public.items
              where reporter_id = v_uid and status = 'available') < 2 then
    -- A first or second listing from someone new is reviewed before it goes
    -- public: it is the cheapest moderation there is, and it costs the honest
    -- reporter one review cycle, not their listing.
    v_status := 'pending_moderation';
  end if;

  select id into v_zone from public.campus_zones where code = p_zone_code and is_active;

  -- the window comes from the category, not from one global constant
  select coalesce(r.retention_days, 90), coalesce(r.auto_hide_photos, false)
    into v_days, v_auto_hide
    from (select 1) one
    left join public.retention_policies r on r.category = btrim(p_category);
  v_days := coalesce(v_days, 90);

  insert into public.items (
    type, status, category, title, public_description, zone_id, spot, event_date,
    custody_label, verification_question, sensitive_hidden_photo, reporter_id,
    reporter_kind, contact_email, finder_email, published_at, expires_at
  ) values (
    p_type::public.item_type, v_status, btrim(p_category), btrim(p_title), btrim(p_description),
    v_zone, nullif(btrim(coalesce(p_spot, '')), ''), p_event_date,
    nullif(btrim(coalesce(p_custody, '')), ''),
    nullif(btrim(coalesce(p_question, '')), ''),
    coalesce(p_sensitive, false) or coalesce(v_auto_hide, false) or v_id_hit, v_uid,
    case when public.is_staff() and p_reporter_kind in ('member', 'staff', 'owner')
         then p_reporter_kind else 'member' end,
    nullif(btrim(coalesce(p_contact_email, '')), ''),
    nullif(btrim(coalesce(p_finder_email, '')), ''),
    case when v_status = 'available' then now() else null end,
    now() + (v_days || ' days')::interval
  ) returning * into v_item;

  insert into public.item_private (item_id, answer_hash, finder_contact)
  values (
    v_item.id,
    case when p_answer is null or btrim(p_answer) = '' then null
         else encode(digest(lower(btrim(p_answer)), 'sha256'), 'hex') end,
    nullif(btrim(coalesce(p_finder_email, '')), '')
  );

  if v_status = 'available' then
    perform public.refresh_matches(v_item.id);
  end if;

  insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail)
  values (v_uid, 'item_created', 'item', v_item.id,
    jsonb_build_object('type', p_type, 'status', v_status, 'ref', v_item.ref_code));

  insert into public.notifications (user_id, kind, title, body, link)
  values (v_uid, 'system',
    case v_status
      when 'quarantined' then 'Your report went to the desk'
      when 'pending_moderation' then 'Your report is being checked'
      else 'Your report is live' end,
    case v_status
      when 'quarantined' then 'An ID or card document can only be handed in at the desk, so it is not published. Reference ' || v_item.ref_code || '.'
      when 'pending_moderation' then 'Reference ' || v_item.ref_code || '. A staff member reviews a new reporter''s first listings; this usually takes a few hours. You will be emailed when it is live.'
      else 'Reference ' || v_item.ref_code || '. You can track it from your dashboard.' end,
    case when v_status = 'available' then '/items/' || v_item.ref_code
         else '/account' end);

  return jsonb_build_object('ok', true, 'ref', v_item.ref_code, 'status', v_status);
end;
$$;

-- ---------------------------------------------------------------- 3. the sweep
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

-- create_item lost its grants in 0038 as well
revoke all on function public.create_item(text, text, text, text, text, text, date, text, text, text, boolean, text, text, text) from public, anon;
grant execute on function public.create_item(text, text, text, text, text, text, date, text, text, text, boolean, text, text, text) to authenticated, service_role;

-- the probe that fails loudly if any future migration undoes this again
select public.assert_write_paths_hashable();

notify pgrst, 'reload schema';
