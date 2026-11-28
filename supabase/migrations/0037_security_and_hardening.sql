-- L&F :: 0035 security & hardening (additive; 0001-0034 are untouched)
--
-- Closes confirmed High & Medium findings from the c52e26e audit:
--   H-01: allowlist Web Push endpoints (blocks SSRF) & rate-limit push RPCs
--   M-07: revoke direct SELECT on push_subscriptions (bearer secrets)
--   H-05: fix stale-read TOCTOU in staff_decide_claim & staff_confirm_handover
--   H-07/M-01: exclude sensitive_hidden_photo from pHash matching, rate-limit
--              set_item_photo_hash, add extensions to refresh_matches search_path
--   H-08: complete DPDP erasure (finder_contact, push_subscriptions, push_opt_in,
--         finder disputes, item_images rows, return pre-scrub email)
--   H-09: rate-limit bulk_import_items & guard malformed dates/non-object rows
--   M-03: revoke direct SELECT on disputes (staff/counterparty UUID privacy)

-- ---------------------------------------------------------------- 1. H-01 & M-07: Web Push SSRF allowlist & secret isolation
revoke select on public.push_subscriptions from authenticated;
drop policy if exists push_subscriptions_read_own on public.push_subscriptions;

alter table public.push_subscriptions
  drop constraint if exists push_endpoint_allowed_host;
alter table public.push_subscriptions
  add constraint push_endpoint_allowed_host check (
    endpoint ~* '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com|[a-z0-9-]+\.push\.services\.mozilla\.com)(/|$)'
  );

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

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, failed_count, last_error)
  values (v_uid, v_endpoint, v_p256dh, v_auth, v_ua, 0, null)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        failed_count = 0,
        last_error = null,
        updated_at = now();

  update public.profiles set push_opt_in = true where id = v_uid;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- 2. H-05: Fix stale-read TOCTOU in staff_decide_claim & staff_confirm_handover
create or replace function public.staff_decide_claim(p_claim_ref text, p_decision text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_claim public.claims;
  v_item public.items;
  v_item_id uuid;
  v_status public.claim_status;
  v_code text := '';
  v_bytes bytea;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
begin
  if not public.is_staff() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if p_decision not in ('approve', 'reject', 'review') then
    return jsonb_build_object('ok', false, 'error', 'BAD_DECISION');
  end if;

  select item_id into v_item_id from public.claims where upper(ref_code) = upper(p_claim_ref);
  if v_item_id is null then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;

  -- Lock item and claim inline BEFORE evaluating status
  select * into v_item from public.items where id = v_item_id for update;
  select * into v_claim from public.claims where upper(ref_code) = upper(p_claim_ref) for update;
  if v_claim.id is null or v_item.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  if v_claim.status in ('approved', 'rejected', 'withdrawn') then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_DECIDED');
  end if;

  if p_decision = 'review' then
    update public.claims set status = 'under_review' where id = v_claim.id;
    insert into public.claim_events (claim_id, status, note, actor_id)
    values (v_claim.id, 'under_review', nullif(btrim(coalesce(p_reason, '')), ''), v_uid);
    return jsonb_build_object('ok', true, 'status', 'under_review');
  end if;

  if p_decision = 'reject' then
    v_status := 'rejected';
    update public.claims set status = v_status, decision_reason = p_reason,
      decided_by = v_uid, decided_at = now() where id = v_claim.id;
    insert into public.claim_events (claim_id, status, note, actor_id)
    values (v_claim.id, v_status, nullif(btrim(coalesce(p_reason, '')), ''), v_uid);
    insert into public.notifications (user_id, kind, title, body, link)
    values (v_claim.claimant_id, 'claim_update', 'Claim not approved',
      'Reference ' || v_claim.ref_code || '. ' ||
      coalesce(nullif(btrim(p_reason), ''), 'The desk could not verify ownership for this claim.') ||
      ' You can reply to the desk if you have more proof.',
      '/claims/' || v_claim.ref_code);
    insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail, severity)
    values (v_uid, 'claim_decided', 'claim', v_claim.id,
      jsonb_build_object('decision', 'reject', 'reason', p_reason), 'warn');
    perform public.event_log('claim_decided', jsonb_build_object('decision', 'reject'));
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;

  if v_item.status <> 'available' then
    return jsonb_build_object('ok', false, 'error', 'NOT_AVAILABLE');
  end if;

  v_status := 'approved';
  update public.claims set status = v_status, decision_reason = p_reason,
    decided_by = v_uid, decided_at = now() where id = v_claim.id;
  update public.items set status = 'claimed' where id = v_item.id;

  with others as (
    update public.claims
       set status = 'rejected',
           decision_reason = 'Matched to another verified claimant.',
           decided_by = v_uid,
           decided_at = now()
     where item_id = v_item.id
       and id <> v_claim.id
       and status in ('submitted', 'under_review')
    returning id, claimant_id, ref_code
  ), logged as (
    insert into public.claim_events (claim_id, status, note, actor_id)
    select id, 'rejected', 'Matched to another verified claimant.', v_uid from others
  )
  insert into public.notifications (user_id, kind, title, body, link)
  select claimant_id, 'claim_update', 'Claim closed',
    'Reference ' || ref_code || '. Another claimant verified ownership of this item, so this claim is closed. Nothing else is needed from you.',
    '/claims/' || ref_code
  from others;

  v_bytes := extensions.gen_random_bytes(6);
  for i in 0..5 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;

  insert into public.handover_codes (claim_id, code_hash, code_plain)
  values (v_claim.id, encode(extensions.digest(v_code, 'sha256'), 'hex'), v_code)
  on conflict (claim_id) do nothing;

  insert into public.claim_events (claim_id, status, note, actor_id)
  values (v_claim.id, v_status, nullif(btrim(coalesce(p_reason, '')), ''), v_uid);

  insert into public.notifications (user_id, kind, title, body, link)
  values (v_claim.claimant_id, 'handover', 'Claim approved — collect at the desk',
    'Reference ' || v_claim.ref_code || '. Show your handover code at ' ||
    coalesce(v_item.custody_label, 'the desk') || '. Do not share the code.',
    '/claims/' || v_claim.ref_code);

  insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail, severity)
  values (v_uid, 'claim_decided', 'claim', v_claim.id,
    jsonb_build_object('decision', 'approve', 'reason', p_reason), 'info');
  perform public.event_log('claim_decided', jsonb_build_object('decision', 'approve'));

  return jsonb_build_object('ok', true, 'status', 'approved');
end;
$$;

create or replace function public.staff_confirm_handover(
  p_item_ref text,
  p_code text default null,
  p_note text default null,
  p_witness uuid default null
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_needs_witness boolean := false;
  v_item public.items;
  v_claim public.claims;
  v_code public.handover_codes;
  v_verified boolean := false;
begin
  if not public.is_staff() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;

  select * into v_item from public.items where upper(ref_code) = upper(p_item_ref) for update;
  if v_item.id is null then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;

  if v_item.status = 'recovered' then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_RECOVERED');
  end if;

  select * into v_claim from public.claims
    where item_id = v_item.id and status = 'approved'
    order by decided_at desc limit 1;
  if v_claim.id is null then return jsonb_build_object('ok', false, 'error', 'NO_APPROVED_CLAIM'); end if;

  select coalesce(r.requires_photo_id, false) into v_needs_witness
    from public.retention_policies r where r.category = v_item.category;

  if v_needs_witness then
    if p_witness is null then return jsonb_build_object('ok', false, 'error', 'WITNESS_REQUIRED'); end if;
    if p_witness = v_uid then return jsonb_build_object('ok', false, 'error', 'WITNESS_IS_SELF'); end if;
    if not exists (select 1 from public.user_roles where user_id = p_witness and role in ('staff', 'admin')) then
      return jsonb_build_object('ok', false, 'error', 'WITNESS_NOT_STAFF');
    end if;
  end if;

  select * into v_code from public.handover_codes where claim_id = v_claim.id for update;

  if v_code.id is not null and v_code.locked_until is not null and v_code.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'LOCKED',
      'minutes', ceil(extract(epoch from (v_code.locked_until - now())) / 60));
  end if;

  if p_code is not null and btrim(p_code) <> '' then
    if v_code.id is null
       or v_code.code_hash <> encode(extensions.digest(upper(btrim(p_code)), 'sha256'), 'hex') then
      update public.handover_codes
         set failed_attempts = failed_attempts + 1,
             locked_until = case when failed_attempts + 1 >= 5
                                 then now() + interval '15 minutes'
                                 else locked_until end
       where id = v_code.id;
      insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail, severity)
      values (v_uid, 'handover_code_mismatch', 'item', v_item.id,
        jsonb_build_object('item', v_item.ref_code), 'alert');
      return jsonb_build_object('ok', false, 'error', 'CODE_MISMATCH');
    end if;
    if v_code.used_at is not null then return jsonb_build_object('ok', false, 'error', 'CODE_USED'); end if;
    if v_code.expires_at is not null and v_code.expires_at < now() then
      return jsonb_build_object('ok', false, 'error', 'CODE_EXPIRED');
    end if;
    v_verified := true;
    update public.handover_codes set used_at = now(), code_plain = null where id = v_code.id;
  elsif char_length(btrim(coalesce(p_note, ''))) < 4 then
    return jsonb_build_object('ok', false, 'error', 'NOTE_REQUIRED');
  else
    if v_code.id is not null then
      update public.handover_codes set code_plain = null where id = v_code.id;
    end if;
  end if;

  update public.items set status = 'recovered' where id = v_item.id;

  insert into public.handover_records (item_id, claim_id, staff_id, code_verified, note, witness_id)
  values (v_item.id, v_claim.id, v_uid, v_verified, nullif(btrim(coalesce(p_note, '')), ''), p_witness);

  insert into public.claim_events (claim_id, status, note, actor_id)
  values (v_claim.id, 'approved', 'Handover confirmed at the desk.', v_uid);

  insert into public.notifications (user_id, kind, title, body, link)
  values (v_claim.claimant_id, 'handover', 'Handover recorded',
    'Item ' || v_item.ref_code || ' was marked collected at the desk.', '/claims/' || v_claim.ref_code);

  insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail, severity)
  values (v_uid, 'handover_confirmed', 'item', v_item.id,
    jsonb_build_object('claim', v_claim.ref_code, 'verified', v_verified, 'witness', p_witness), 'info');
  perform public.event_log('handover_confirmed', jsonb_build_object('verified', v_verified));

  return jsonb_build_object('ok', true, 'itemRef', v_item.ref_code, 'claimRef', v_claim.ref_code, 'verified', v_verified);
end;
$$;

-- ---------------------------------------------------------------- 3. H-07 & M-01: Exclude hidden photos from pHash & fix search_path
alter function public.refresh_matches(uuid) set search_path = public, extensions;

create or replace function public.item_photo_distance(p_a uuid, p_b uuid)
returns int language sql stable security definer set search_path = public as $$
  select min(public.photo_distance(ia.phash, ib.phash))
    from public.item_images ia
    join public.items a on a.id = ia.item_id and a.sensitive_hidden_photo = false
    join public.item_images ib on ib.item_id = p_b
    join public.items b on b.id = ib.item_id and b.sensitive_hidden_photo = false
   where ia.item_id = p_a
     and ia.phash is not null
     and ib.phash is not null;
$$;

-- ---------------------------------------------------------------- 4. H-08: Complete DPDP erasure & return pre-scrub email
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

  update public.profiles
     set full_name = null,
         phone = null,
         alerts_opt_in = false,
         marketing_opt_in = false,
         push_opt_in = false
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

-- ---------------------------------------------------------------- 5. M-03: Revoke direct SELECT on disputes (staff/counterparty UUID privacy)
revoke select on public.disputes from authenticated;

notify pgrst, 'reload schema';
