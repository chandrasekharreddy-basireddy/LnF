-- L&F :: 0009 security hardening (additive; 0001-0008 are untouched)
--
-- Fixes found in the code audit:
--   1. two desks could approve competing claims on one item at the same time
--   2. losing claims stayed 'submitted' forever after the item was collected
--   3. a handover code could be guessed without limit (no lockout)
--   4. a user could rewrite their own profiles.email, which staff trust
--   5. staff/admin RPCs were executable by anon (they returned null, but why allow it)

alter table public.handover_codes
  add column if not exists failed_attempts int not null default 0,
  add column if not exists locked_until timestamptz;

create or replace function public.staff_decide_claim(p_claim_ref text, p_decision text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_claim public.claims;
  v_item public.items;
  v_status public.claim_status;
  v_code text;
begin
  if not public.is_staff() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if p_decision not in ('approve', 'reject', 'review') then
    return jsonb_build_object('ok', false, 'error', 'BAD_DECISION');
  end if;

  select * into v_claim from public.claims where upper(ref_code) = upper(p_claim_ref);
  if v_claim.id is null then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  select * into v_item from public.items where id = v_claim.item_id;

  -- serialise competing decisions on the same item
  perform 1 from public.items where id = v_item.id for update;

  if p_decision = 'review' then
    update public.claims set status = 'under_review' where id = v_claim.id;
    insert into public.claim_events (claim_id, status, note, actor_id)
    values (v_claim.id, 'under_review', nullif(btrim(coalesce(p_reason, '')), ''), v_uid);
    return jsonb_build_object('ok', true, 'status', 'under_review');
  end if;

  if v_claim.status in ('approved', 'rejected', 'withdrawn') then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_DECIDED');
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

  -- approve: issue a one-time handover code
  v_status := 'approved';
  update public.claims set status = v_status, decision_reason = p_reason,
    decided_by = v_uid, decided_at = now() where id = v_claim.id;
  update public.items set status = 'claimed' where id = v_item.id;

  -- one item, one owner: every other open claim closes neutrally, in the same statement
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

  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
           (floor(random() * 32) + 1)::int, 1), '')
  into v_code from generate_series(1, 6);

  insert into public.handover_codes (claim_id, code_hash, code_plain)
  values (v_claim.id, encode(digest(v_code, 'sha256'), 'hex'), v_code)
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

create or replace function public.staff_confirm_handover(p_item_ref text, p_code text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_item public.items;
  v_claim public.claims;
  v_code public.handover_codes;
  v_verified boolean := false;
begin
  if not public.is_staff() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;

  select * into v_item from public.items where upper(ref_code) = upper(p_item_ref);
  if v_item.id is null then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if v_item.status = 'recovered' then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_RECOVERED');
  end if;

  select * into v_claim from public.claims
    where item_id = v_item.id and status = 'approved'
    order by decided_at desc limit 1;
  if v_claim.id is null then return jsonb_build_object('ok', false, 'error', 'NO_APPROVED_CLAIM'); end if;

  select * into v_code from public.handover_codes where claim_id = v_claim.id;

  if v_code.id is not null and v_code.locked_until is not null and v_code.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'LOCKED',
      'minutes', ceil(extract(epoch from (v_code.locked_until - now())) / 60));
  end if;
  if p_code is not null and btrim(p_code) <> '' then
    if v_code.id is null
       or v_code.code_hash <> encode(digest(upper(btrim(p_code)), 'sha256'), 'hex') then
      if v_code.id is not null then
        update public.handover_codes
           set failed_attempts = failed_attempts + 1,
               locked_until = case when failed_attempts + 1 >= 5
                                   then now() + interval '15 minutes'
                                   else locked_until end
         where id = v_code.id;
      end if;
      insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail, severity)
      values (v_uid, 'handover_code_mismatch', 'item', v_item.id,
        jsonb_build_object('item', v_item.ref_code,
          'attempts', coalesce(v_code.failed_attempts, 0) + 1), 'alert');
      return jsonb_build_object('ok', false, 'error', 'CODE_MISMATCH');
    end if;
    if v_code.used_at is not null then
      return jsonb_build_object('ok', false, 'error', 'CODE_USED');
    end if;
    v_verified := true;
    update public.handover_codes set used_at = now() where id = v_code.id;
  end if;

  update public.items set status = 'recovered' where id = v_item.id;

  insert into public.handover_records (item_id, claim_id, staff_id, code_verified, note)
  values (v_item.id, v_claim.id, v_uid, v_verified, nullif(btrim(coalesce(p_note, '')), ''));

  insert into public.claim_events (claim_id, status, note, actor_id)
  values (v_claim.id, 'approved', 'Handover confirmed at the desk.', v_uid);

  insert into public.notifications (user_id, kind, title, body, link)
  values (v_claim.claimant_id, 'handover', 'Item handed over',
    'Your claim ' || v_claim.ref_code || ' is closed. Item ' || v_item.ref_code || ' is with you now.',
    '/claims/' || v_claim.ref_code);

  if v_item.reporter_id is not null then
    insert into public.notifications (user_id, kind, title, body, link)
    values (v_item.reporter_id, 'handover', 'Your find went home',
      'The item you handed in (' || v_item.ref_code || ') was returned to its owner. Thank you.',
      '/items/' || v_item.ref_code);
  end if;

  insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail, severity)
  values (v_uid, 'handover_confirmed', 'item', v_item.id,
    jsonb_build_object('claim', v_claim.ref_code, 'code_verified', v_verified), 'info');

  perform public.event_log('handover_confirmed', jsonb_build_object(
    'item_ref', v_item.ref_code, 'code_verified', v_verified));

  return jsonb_build_object('ok', true, 'itemRef', v_item.ref_code);
end;
$$;
-- 4. profiles.email is the address staff trust; the user may not rewrite it.
revoke update on public.profiles from authenticated;
grant update (full_name, phone, alerts_opt_in, marketing_opt_in) on public.profiles to authenticated;

-- 5. nothing except a signed-in session may call these
revoke execute on function
  public.create_item(text, text, text, text, text, text, date, text, text, text, boolean, text, text, text),
  public.submit_claim(text, text, text),
  public.my_claims(), public.my_claim(text),
  public.submit_report(text, text, text),
  public.staff_claim_queue(), public.staff_item_detail(text), public.staff_decide_claim(text, text, text),
  public.staff_confirm_handover(text, text, text), public.staff_update_item(text, text, text),
  public.admin_metrics(), public.admin_list_users(), public.admin_set_role(text, text, boolean),
  public.admin_audit_log(int), public.admin_open_reports(), public.admin_close_report(uuid),
  public.admin_purge_samples()
from public, anon;

grant execute on function
  public.create_item(text, text, text, text, text, text, date, text, text, text, boolean, text, text, text),
  public.submit_claim(text, text, text),
  public.my_claims(), public.my_claim(text),
  public.submit_report(text, text, text),
  public.staff_claim_queue(), public.staff_item_detail(text), public.staff_decide_claim(text, text, text),
  public.staff_confirm_handover(text, text, text), public.staff_update_item(text, text, text),
  public.admin_metrics(), public.admin_list_users(), public.admin_set_role(text, text, boolean),
  public.admin_audit_log(int), public.admin_open_reports(), public.admin_close_report(uuid),
  public.admin_purge_samples()
to authenticated, service_role;

notify pgrst, 'reload schema';
