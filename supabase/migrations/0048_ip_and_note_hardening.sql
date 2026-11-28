-- L&F :: 0048 the last of the database audit's medium list
--
--   * submit_report() throttled on a single shared 'anon-global' bucket, so one
--     reporter used up the allowance for everyone in the window.
--   * check_signin_allowed() and log_auth_event() accepted the caller's IP as a
--     parameter, which let a caller write an audit row naming any address. They
--     derive it now, and only fall back to the parameter outside PostgREST.
--   * a four-character note bypassed the handover code entirely. Twelve, and the
--     note is still recorded — the point is that "ok" is not a reason.

create or replace function public.submit_report(p_ref text, p_reason text, p_details text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_item public.items;
  v_email text;
begin
  if not public.rate_limit('report:' || coalesce(v_uid::text, 'anon'), 6, interval '1 hour') then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;
  select * into v_item from public.items where upper(ref_code) = upper(p_ref);
  if v_item.id is null then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if v_uid is not null then
    select email into v_email from public.profiles where id = v_uid;
  end if;
  insert into public.abuse_reports (item_id, reporter_id, reporter_email, reason, details)
  values (v_item.id, v_uid, v_email, p_reason, nullif(btrim(coalesce(p_details, '')), ''));
  perform public.event_log('listing_reported', jsonb_build_object('item_ref', v_item.ref_code));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.check_signin_allowed(p_email text, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email_hash text := encode(digest(lower(btrim(coalesce(p_email, ''))), 'sha256'), 'hex');
  v_ip text := public.request_ip(p_ip);
  v_ip_hash text := case when v_ip is null then null
                         else encode(digest(v_ip, 'sha256'), 'hex') end;
  v_ok boolean;
begin
  v_ok := public.rate_limit('signin:email:' || v_email_hash, 5, interval '15 minutes');
  if not v_ok then
    return jsonb_build_object('allowed', false, 'reason', 'email');
  end if;

  if v_ip_hash is not null then
    v_ok := public.rate_limit('signin:ip:' || v_ip_hash, 20, interval '15 minutes');
    if not v_ok then
      return jsonb_build_object('allowed', false, 'reason', 'ip');
    end if;
  end if;

  return jsonb_build_object('allowed', true);
end;
$$;

create or replace function public.log_auth_event(p_kind text, p_email text, p_ip text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('code_requested', 'code_verified', 'code_failed', 'code_throttled') then
    return;
  end if;
  insert into public.auth_events (kind, email_hash, ip_hash)
  values (
    p_kind,
    encode(digest(lower(btrim(coalesce(p_email, ''))), 'sha256'), 'hex'),
    case when public.request_ip(p_ip) is null then null
         else encode(digest(public.request_ip(p_ip), 'sha256'), 'hex') end
  );
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
  elsif char_length(btrim(coalesce(p_note, ''))) < 12 then
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

revoke all on function public.submit_report(text, text, text) from public, anon;
grant execute on function public.submit_report(text, text, text) to authenticated, service_role;

revoke all on function public.check_signin_allowed(text, text) from public;
grant execute on function public.check_signin_allowed(text, text) to anon, authenticated, service_role;

revoke all on function public.log_auth_event(text, text, text) from public;
grant execute on function public.log_auth_event(text, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
