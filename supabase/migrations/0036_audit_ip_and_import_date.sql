-- L&F :: 0036 the audit's spoofable address, and a batch that a typo cannot kill
--
-- From the Gemini audit of c52e26e (the parts not already closed by 0035):
--
--   * create_found_item_anonymous took the caller's IP as a parameter. An
--     anonymous caller can pass anything, so the throttle could be lifted by
--     inventing an address per request. PostgREST publishes the real request
--     headers as a GUC the client cannot forge; that is preferred now, and
--     p_ip is only the fallback for callers that have no headers (service role).
--   * bulk_import_items cast the date inside the loop. One row with 2026-02-30
--     or "yesterday" raised and aborted the whole batch, losing every row after
--     it. The cast is now guarded per row, so a bad date skips one row.

create or replace function public.create_found_item_anonymous(
  p_category text,
  p_title text,
  p_description text,
  p_zone_code text default null,
  p_spot text default null,
  p_event_date date default null,
  p_question text default null,
  p_answer text default null,
  p_finder_email text default null,
  p_finder_phone text default null,
  p_ip text default null
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_item public.items;
  v_zone uuid;
  v_days int;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_date date := coalesce(p_event_date, v_today);
  -- PostgREST exposes the request headers as a GUC the client cannot set. Prefer
  -- it over p_ip, which an anonymous caller can put anything into: the whole
  -- point of the throttle is that hiding your address does not lift it.
  v_header_ip text := coalesce(
    nullif(btrim(coalesce(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for'), ''),
    nullif(btrim(coalesce(current_setting('request.headers', true), '')::json ->> 'x-real-ip'), '')
  );
  v_ip text := coalesce(v_header_ip, nullif(btrim(coalesce(p_ip, '')), ''));
  v_ip_key text := case when v_ip is null then 'anon-global'
                        else encode(extensions.digest(v_ip, 'sha256'), 'hex') end;
  v_text text;
  v_id_hit boolean := false;
  v_terms text[] := array[
    'aadhaar', 'passport', 'pan card', 'driving licence', 'driving license',
    'voter id', 'id card', 'identity card', 'atm card', 'debit card', 'credit card'
  ];
  v_term text;
begin
  if not public.rate_limit('handin:ip:' || v_ip_key, 5, interval '1 hour') then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;

  if p_title is null or char_length(btrim(p_title)) < 3 then
    return jsonb_build_object('ok', false, 'error', 'TITLE_TOO_SHORT');
  end if;
  if p_description is null or char_length(btrim(p_description)) < 10 then
    return jsonb_build_object('ok', false, 'error', 'DESCRIPTION_TOO_SHORT');
  end if;
  if v_date > v_today then
    return jsonb_build_object('ok', false, 'error', 'DATE_IN_FUTURE');
  end if;
  if p_question is null or char_length(btrim(p_question)) < 8 then
    return jsonb_build_object('ok', false, 'error', 'QUESTION_REQUIRED');
  end if;
  if p_answer is null or char_length(btrim(p_answer)) < 1 then
    return jsonb_build_object('ok', false, 'error', 'ANSWER_REQUIRED');
  end if;

  v_text := lower(coalesce(p_title, '') || ' ' || coalesce(p_description, ''));
  foreach v_term in array v_terms loop
    if position(v_term in v_text) > 0 then v_id_hit := true; end if;
  end loop;

  select id into v_zone from public.campus_zones where code = p_zone_code and is_active;
  select coalesce(retention_days, 90) into v_days from public.retention_policies where category = btrim(p_category);
  v_days := coalesce(v_days, 90);

  insert into public.items (
    type, status, category, title, public_description, zone_id, spot, event_date,
    custody_label, verification_question, sensitive_hidden_photo, reporter_id,
    reporter_kind, finder_email, published_at, expires_at
  ) values (
    'found',
    case when v_id_hit then 'quarantined'::public.item_status
         else 'pending_moderation'::public.item_status end,
    btrim(p_category), btrim(p_title), btrim(p_description),
    v_zone, nullif(btrim(coalesce(p_spot, '')), ''), v_date,
    'Main Gate & Security Desk',
    btrim(p_question),
    true,
    null,
    'finder',
    nullif(btrim(coalesce(p_finder_email, '')), ''),
    null,
    now() + make_interval(days => v_days)
  ) returning * into v_item;

  insert into public.item_private (item_id, answer_hash, finder_contact)
  values (
    v_item.id,
    encode(extensions.digest(lower(btrim(p_answer)), 'sha256'), 'hex'),
    nullif(concat_ws(' · ',
      nullif(btrim(coalesce(p_finder_email, '')), ''),
      nullif(btrim(coalesce(p_finder_phone, '')), '')), '')
  );

  insert into public.audit_logs (action, resource_type, resource_id, detail)
  values ('item_handed_in_anonymously', 'item', v_item.id,
    jsonb_build_object('ref', v_item.ref_code, 'status', v_item.status));

  perform public.event_log('anonymous_hand_in', jsonb_build_object('ref', v_item.ref_code));

  return jsonb_build_object('ok', true, 'ref', v_item.ref_code, 'status', v_item.status);
end;
$$;

create or replace function public.bulk_import_items(p_rows jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_row jsonb;
  v_i int := 0;
  v_ok int := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_refs jsonb := '[]'::jsonb;
  v_item public.items;
  v_zone uuid;
  v_days int;
  v_date date;
  v_reason text;
  v_text text;
  v_id_hit boolean;
  v_term text;
  v_terms text[] := array[
    'aadhaar', 'passport', 'pan card', 'driving licence', 'driving license',
    'voter id', 'id card', 'identity card', 'atm card', 'debit card', 'credit card'
  ];
  v_categories text[] := array[
    'electronics', 'bags', 'documents', 'accessories', 'clothing', 'keys', 'books', 'sports', 'other'
  ];
begin
  if not public.is_staff() then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'BAD_INPUT');
  end if;
  if jsonb_array_length(p_rows) > 500 then
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY', 'limit', 500);
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_reason := null;
    v_id_hit := false;

    if char_length(btrim(coalesce(v_row ->> 'title', ''))) < 3 then
      v_reason := 'title too short';
    elsif char_length(btrim(coalesce(v_row ->> 'description', ''))) < 10 then
      v_reason := 'description too short';
    elsif char_length(btrim(coalesce(v_row ->> 'question', ''))) < 8 then
      v_reason := 'question too short';
    elsif char_length(btrim(coalesce(v_row ->> 'answer', ''))) < 1 then
      v_reason := 'answer missing';
    elsif coalesce(v_row ->> 'category', 'other') <> all (v_categories) then
      v_reason := 'unknown category';
    elsif (v_row ->> 'event_date') is null then
      v_reason := 'bad or future date';
    end if;

    if v_reason is null then
      -- 2026-02-30 parses to March; garbage raises. Either way the row is skipped.
      begin
        v_date := (v_row ->> 'event_date')::date;
        if v_date > (now() at time zone 'Asia/Kolkata')::date then
          v_reason := 'bad or future date';
        end if;
      exception when others then
        v_reason := 'bad or future date';
      end;
    end if;

    if v_reason is null then
      v_text := lower(coalesce(v_row ->> 'title', '') || ' ' || coalesce(v_row ->> 'description', ''));
      foreach v_term in array v_terms loop
        if position(v_term in v_text) > 0 then v_id_hit := true; end if;
      end loop;

      select id into v_zone from public.campus_zones
       where code = nullif(btrim(coalesce(v_row ->> 'zone_code', '')), '') and is_active;

      select coalesce(retention_days, 90) into v_days from public.retention_policies
       where category = coalesce(v_row ->> 'category', 'other');
      v_days := coalesce(v_days, 90);

      insert into public.items (
        type, status, category, title, public_description, zone_id, spot, event_date,
        custody_label, verification_question, sensitive_hidden_photo, reporter_id,
        reporter_kind, published_at, expires_at
      ) values (
        'found',
        case when v_id_hit then 'quarantined'::public.item_status
             else 'available'::public.item_status end,
        coalesce(v_row ->> 'category', 'other'),
        btrim(v_row ->> 'title'),
        btrim(v_row ->> 'description'),
        v_zone,
        nullif(btrim(coalesce(v_row ->> 'spot', '')), ''),
        v_date,
        coalesce(nullif(btrim(coalesce(v_row ->> 'custody', '')), ''), 'Main Gate & Security Desk'),
        btrim(v_row ->> 'question'),
        true,
        null,
        'staff',
        case when v_id_hit then null else now() end,
        now() + (v_days || ' days')::interval
      ) returning * into v_item;

      insert into public.item_private (item_id, answer_hash, bin_code)
      values (
        v_item.id,
        encode(digest(lower(btrim(v_row ->> 'answer')), 'sha256'), 'hex'),
        nullif(btrim(coalesce(v_row ->> 'bin', '')), '')
      );

      v_ok := v_ok + 1;
      v_refs := v_refs || jsonb_build_array(v_item.ref_code);
    else
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('row', v_i, 'title', left(coalesce(v_row ->> 'title', ''), 60), 'reason', v_reason));
    end if;
  end loop;

  insert into public.audit_logs (actor_id, action, resource_type, detail, severity)
  values (v_uid, 'bulk_import', 'item',
    jsonb_build_object('imported', v_ok, 'skipped', jsonb_array_length(v_skipped),
      'note', left(coalesce(p_note, ''), 200)), 'info');

  perform public.event_log('bulk_import', jsonb_build_object('imported', v_ok));

  return jsonb_build_object('ok', true, 'imported', v_ok,
    'skipped', v_skipped, 'refs', v_refs);
end;
$$;

revoke all on function public.create_found_item_anonymous(text, text, text, text, text, date, text, text, text, text, text) from public, authenticated;
grant execute on function public.create_found_item_anonymous(text, text, text, text, text, date, text, text, text, text, text) to anon, authenticated, service_role;

revoke all on function public.bulk_import_items(jsonb, text) from public, anon;
grant execute on function public.bulk_import_items(jsonb, text) to authenticated, service_role;

notify pgrst, 'reload schema';
