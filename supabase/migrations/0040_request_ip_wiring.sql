-- L&F :: 0040 one place decides what "the caller's address" means
--
-- 0039 added request_ip(), which takes the last hop the proxy appended instead
-- of the whole x-forwarded-for chain (a value that changes on every request and
-- so never fills a bucket). This wires it into the functions that throttle by
-- address, so a caller cannot pick their own bucket by posting a header.

create or replace function public.request_ip(p_fallback text default null)
returns text language sql stable as $$
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
  v_ip text := public.request_ip(p_ip);
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

create or replace function public.create_claim_draft(
  p_ref text, p_email text, p_answer text, p_proof text default null, p_ip text default null
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_item public.items;
  v_priv public.item_private;
  v_token text;
  v_matched boolean := false;
  v_ip_hash text := encode(digest(coalesce(public.request_ip(p_ip), 'anon-global'), 'sha256'), 'hex');
begin
  if p_email is null or position('@' in p_email) = 0 then
    return jsonb_build_object('ok', false, 'error', 'EMAIL_REQUIRED');
  end if;

  if not public.rate_limit('claimdraft:ip:' || v_ip_hash, 8, interval '1 hour') then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;
  if not public.rate_limit('claimdraft:email:' || encode(digest(lower(btrim(p_email)), 'sha256'), 'hex'),
                           5, interval '15 minutes') then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;

  select * into v_item from public.items where upper(ref_code) = upper(p_ref);
  if v_item.id is null then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if v_item.type <> 'found' then return jsonb_build_object('ok', false, 'error', 'NOT_CLAIMABLE'); end if;
  if v_item.status <> 'available' then
    return jsonb_build_object('ok', false, 'error', 'NOT_AVAILABLE', 'status', v_item.status);
  end if;

  select * into v_priv from public.item_private where item_id = v_item.id;
  if v_priv.answer_hash is not null and p_answer is not null then
    v_matched := v_priv.answer_hash = encode(digest(lower(btrim(p_answer)), 'sha256'), 'hex');
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');
  delete from public.claim_drafts where expires_at < now();

  insert into public.claim_drafts (token_hash, item_id, email, answer_hash, answer_matched, proof)
  values (encode(digest(v_token, 'sha256'), 'hex'), v_item.id, lower(btrim(p_email)),
    encode(digest(lower(btrim(coalesce(p_answer, ''))), 'sha256'), 'hex'),
    v_matched, nullif(btrim(coalesce(p_proof, '')), ''));

  return jsonb_build_object('ok', true, 'token', v_token, 'email', lower(btrim(p_email)));
end;
$$;

revoke all on function public.create_found_item_anonymous(text, text, text, text, text, date, text, text, text, text, text) from public, authenticated;
grant execute on function public.create_found_item_anonymous(text, text, text, text, text, date, text, text, text, text, text) to anon, authenticated, service_role;

revoke all on function public.create_claim_draft(text, text, text, text, text) from public, authenticated;
grant execute on function public.create_claim_draft(text, text, text, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
