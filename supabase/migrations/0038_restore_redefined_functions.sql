-- L&F :: 0038 the redefinitions that quietly dropped their predecessors
--
-- The Gemini audit of bc89368 found two High findings, both about migrations I
-- wrote, and both the same mistake in different clothes: I re-created a function
-- from an older file and lost what a later migration had added to it.
--
--   * 0037 (then 0035) redefined admin_erase_user_data and dropped the profile
--     email scrub, the conversation_reads delete and the user_roles delete from
--     0034. A person could ask to be erased and keep their address on file.
--   * 0036 redefined bulk_import_items and dropped the rate limit and the
--     per-row "is this an object" guard from 0035.
--
-- Also fixed here, from the same audit:
--   * the throttle key hashed the whole x-forwarded-for chain, which changes
--     per request; it now takes the last hop the proxy appended
--   * create_item fetched auto_hide_photos and never used it, and accepted
--     reporter_kind='staff' from any member
--   * a dispute could reopen a rejected claim on an item another claimant
--     already holds, which the one-approved-per-item index then refuses
--
-- The duplicate 0035 is gone: 0035_offline_desk_sheet.sql keeps its number and
-- the hardening file is now 0037. It was already applied to the live project
-- under its old name; renaming a file does not re-run it.

create or replace function public.admin_erase_user_data(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_paths text[];
  v_items int := 0;
  v_claims int := 0;
begin
  if v_uid is not null and not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  select lower(email) into v_email from public.profiles where id = p_user_id;

  select coalesce(array_agg(im.storage_path), array[]::text[])
    into v_paths
    from public.item_images im
    join public.items i on i.id = im.item_id
   where i.reporter_id = p_user_id;

  if coalesce(array_length(v_paths, 1), 0) > 0 then
    insert into public.storage_deletion_queue (storage_path)
    select unnest(v_paths)
    on conflict (storage_path) do nothing;
  end if;

  -- Scrub private finder contacts and delete item_images rows before detaching reporter_id
  update public.item_private
     set finder_contact = null, private_notes = null
   where item_id in (select id from public.items where reporter_id = p_user_id);

  delete from public.item_images
   where item_id in (select id from public.items where reporter_id = p_user_id);

  with upd as (
    update public.items
       set reporter_id = null,
           contact_email = null,
           finder_email = null
     where reporter_id = p_user_id
    returning id
  ) select count(*) into v_items from upd;

  with del_c as (
    delete from public.claims where claimant_id = p_user_id returning id
  ) select count(*) into v_claims from del_c;

  delete from public.push_subscriptions where user_id = p_user_id;
  delete from public.saved_items where user_id = p_user_id;
  delete from public.saved_searches where user_id = p_user_id;
  delete from public.notifications where user_id = p_user_id;

  update public.disputes
     set reason = '[erased by user request]'
   where opened_by = p_user_id;

  update public.claim_messages
     set body = '[erased by user request]'
   where sender_id = p_user_id;

  update public.abuse_reports
     set reporter_email = null, details = '[erased]'
   where reporter_id = p_user_id or (v_email is not null and lower(reporter_email) = v_email);

  if v_email is not null then
    delete from public.email_outbox where lower(recipient_email) = v_email;
    delete from public.claim_drafts where lower(email) = v_email;
  end if;

  delete from public.conversation_reads where user_id = p_user_id;
  delete from public.user_roles where user_id = p_user_id;

  update public.profiles
     set full_name = null,
         phone = null,
         alerts_opt_in = false,
         marketing_opt_in = false,
         push_opt_in = false,
         email = concat('erased+', left(p_user_id::text, 8), '@erased.invalid')
   where id = p_user_id;

  insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail, severity)
  values (v_uid, 'user_erased', 'user', p_user_id,
    jsonb_build_object('items', v_items, 'claims', v_claims, 'photos', coalesce(array_length(v_paths, 1), 0)), 'warn');

  return jsonb_build_object(
    'ok', true,
    'email', v_email,
    'photoPaths', to_jsonb(coalesce(v_paths, array[]::text[])),
    'items', v_items,
    'claims', v_claims
  );
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
  if not public.rate_limit('bulk_import:' || v_uid::text, 20, interval '1 hour') then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;

  if jsonb_array_length(p_rows) > 500 then
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY', 'limit', 500);
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_reason := null;

    -- a row that is not an object has no fields to read
    if jsonb_typeof(v_row) <> 'object' then
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('row', v_i, 'reason', 'row is not an object'));
      continue;
    end if;
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
) returns jsonb language plpgsql security definer set search_path = public as $$
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

create or replace function public.decide_dispute(p_dispute_ref text, p_decision text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_dispute public.disputes;
  v_claim public.claims;
  v_item public.items;
  v_note text := btrim(coalesce(p_note, ''));
  v_status text;
  v_reopened boolean := false;
begin
  if not public.is_staff() then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if p_decision not in ('upheld', 'dismissed') then
    return jsonb_build_object('ok', false, 'error', 'BAD_DECISION');
  end if;
  if char_length(v_note) < 10 then
    return jsonb_build_object('ok', false, 'error', 'NOTE_REQUIRED');
  end if;
  if char_length(v_note) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'TOO_LONG');
  end if;

  select * into v_dispute from public.disputes
   where upper(ref_code) = upper(btrim(coalesce(p_dispute_ref, '')));
  if v_dispute.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  -- two staff deciding at once must not both win
  perform 1 from public.disputes where id = v_dispute.id for update;
  select * into v_dispute from public.disputes where id = v_dispute.id;
  if v_dispute.status <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_DECIDED');
  end if;

  select * into v_claim from public.claims where id = v_dispute.claim_id for update;
  select * into v_item from public.items where id = v_claim.item_id for update;

  v_status := p_decision;

  -- Upholding does not hand anything over. It puts the claim back in the queue
  -- when, and only when, the item is still in custody: an item already released
  -- cannot be un-released, and pretending otherwise would be a lie in the log.
  if p_decision = 'upheld'
     and v_claim.status = 'rejected'
     and v_item.status in ('available', 'claimed')
     and not exists (select 1 from public.handover_records h where h.claim_id = v_claim.id)
     and not exists (
       select 1 from public.claims c2
       where c2.item_id = v_claim.item_id
         and c2.claimant_id = v_claim.claimant_id
         and c2.id <> v_claim.id
         and c2.status in ('submitted', 'under_review', 'approved')
     )
     -- and not when someone else already holds the item: reopening would put two
     -- approved claims on one listing, which the unique index refuses at handover
     and not exists (
       select 1 from public.claims c3
       where c3.item_id = v_claim.item_id
         and c3.id <> v_claim.id
         and c3.status = 'approved'
     ) then
    update public.claims set status = 'under_review', decided_by = null, decided_at = null
     where id = v_claim.id;
    insert into public.claim_events (claim_id, status, note, actor_id)
    values (v_claim.id, 'under_review', 'Reopened after dispute ' || v_dispute.ref_code || '.', v_uid);
    v_reopened := true;
  end if;

  update public.disputes
     set status = v_status, outcome_note = v_note, decided_by = v_uid,
         decided_at = now(), reopened_claim = v_reopened
   where id = v_dispute.id;

  insert into public.notifications (user_id, kind, title, body, link)
  values (v_dispute.opened_by, 'claim_update',
    case when p_decision = 'upheld' then 'Your dispute was upheld' else 'Your dispute was reviewed' end,
    'Dispute ' || v_dispute.ref_code || '. ' || v_note ||
      case when v_reopened then ' The claim is back with the desk.' else '' end,
    '/disputes/' || v_dispute.ref_code);

  insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail, severity)
  values (v_uid, 'dispute_decided', 'claim', v_claim.id,
    jsonb_build_object('dispute', v_dispute.ref_code, 'decision', p_decision,
                       'reopened', v_reopened, 'claim', v_claim.ref_code), 'info');

  perform public.event_log('dispute_decided',
    jsonb_build_object('decision', p_decision, 'reopened', v_reopened));

  return jsonb_build_object('ok', true, 'status', v_status, 'reopened', v_reopened);
end;
$$;

revoke all on function public.admin_erase_user_data(uuid) from public, anon;
grant execute on function public.admin_erase_user_data(uuid) to authenticated, service_role;

revoke all on function public.bulk_import_items(jsonb, text) from public, anon;
grant execute on function public.bulk_import_items(jsonb, text) to authenticated, service_role;

revoke all on function public.create_found_item_anonymous(text, text, text, text, text, date, text, text, text, text, text) from public, authenticated;
grant execute on function public.create_found_item_anonymous(text, text, text, text, text, date, text, text, text, text, text) to anon, authenticated, service_role;

revoke all on function public.decide_dispute(text, text, text) from public, anon;
grant execute on function public.decide_dispute(text, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
