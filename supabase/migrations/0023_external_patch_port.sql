-- L&F :: 0023 the sound half of the external hardening patch
--
-- An attached patch (lnf-full-hardening.patch) was written against an older
-- commit and creates 0020/0021, which are already chat and bulk-import here, so
-- it cannot be applied as-is. This migration ports the parts that are genuinely
-- better than what we have, each verified first:
--
--   * the moderation scanner missed "+91 98765 43210" (split phone numbers) and
--     "pan abcde1234f" (lower case) — both are exactly what a scammer writes
--   * the public hand-in form defaulted its date to UTC and let a caller hide
--     its address to escape the throttle
--   * the email retry queue accepted any event name and had no rate limit
--   * notifications were updatable column-by-column by their owner
--   * account erasure went through a raw table insert from the browser
--
-- Deliberately NOT ported: revoking execute on check_signin_allowed() and
-- log_auth_event() from anon. Our sign-in path calls both with the visitor's
-- session before it exists; revoking them breaks sign-in. The throttle they
-- enforce is the thing protecting the form, so they must stay callable by the
-- flow they guard.

-- ---------------------------------------------------------------- intake
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
  v_ip_key text := case when p_ip is null or btrim(p_ip) = '' then 'anon-global'
                        else encode(extensions.digest(btrim(p_ip), 'sha256'), 'hex') end;
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

-- ---------------------------------------------------------------- scanner
create or replace function public.scan_message(p_text text)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'extortion', coalesce(p_text ~* '(venmo|zelle|(^|[^a-z])upi([^a-z]|$)|paytm|gpay|phonepe|bhim|gift[[:space:]]?card|ransom|reward[[:space:]]?fee|pay[[:space:]]?me|send[[:space:]]?money|whatsapp[[:space:]]?me|telegram|western[[:space:]]?union|bit\.ly|tinyurl)', false),
    'contact', coalesce(p_text ~* '([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|(^|[^0-9])(\+?91[[:space:]-]?)?[6-9][0-9]{4}[[:space:]-]?[0-9]{5}([^0-9]|$))', false),
    'id_number', coalesce(p_text ~ '[2-9][0-9]{3}[[:space:]-]?[0-9]{4}[[:space:]-]?[0-9]{4}' or p_text ~* '(^|[^a-z0-9])[a-z]{5}[0-9]{4}[a-z]([^a-z0-9]|$)', false)
  );
$$;

-- ---------------------------------------------------------------- retries
create or replace function public.queue_email_retry(
  p_dedupe_key text,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb,
  p_to text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_self text;
  v_email text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); end if;
  if p_event_type not in ('item_published', 'claim_received', 'claim_decided', 'finder_thanks', 'match_alert') then
    return jsonb_build_object('ok', false, 'error', 'BAD_EVENT_TYPE');
  end if;
  if not public.is_staff() and not public.rate_limit('email_queue:' || v_uid::text, 10, interval '1 hour') then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;

  select email into v_self from public.profiles where id = v_uid;
  v_email := coalesce(nullif(btrim(coalesce(p_to, '')), ''), v_self);

  if v_email is null then return jsonb_build_object('ok', false, 'error', 'NO_ADDRESS'); end if;
  if v_email <> coalesce(v_self, '') and not public.is_staff() then
    v_email := v_self;
  end if;

  insert into public.email_outbox (dedupe_key, event_type, recipient_email, payload)
  values (left(p_dedupe_key, 200), p_event_type, v_email, coalesce(p_payload, '{}'::jsonb))
  on conflict (dedupe_key) do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- erasure
create or replace function public.request_account_deletion()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); end if;
  if not public.rate_limit('erase_req:' || v_uid::text, 2, interval '1 day') then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;

  if exists (
    select 1 from public.abuse_reports
     where reporter_id = v_uid
       and reason = 'account_deletion'
       and status <> 'closed'
  ) then
    return jsonb_build_object('ok', true, 'alreadyOpen', true);
  end if;

  select email into v_email from public.profiles where id = v_uid;

  insert into public.abuse_reports (item_id, reporter_id, reporter_email, reason, details)
  values (null, v_uid, v_email, 'account_deletion', 'Data subject requested erasure of their account and records.');

  insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail, severity)
  values (v_uid, 'erasure_requested', 'user', v_uid, '{}'::jsonb, 'warn');

  return jsonb_build_object('ok', true, 'alreadyOpen', false);
end;
$$;

-- ---------------------------------------------------------------- grants
-- writes go through the RPCs; the tables are not a public API
revoke insert, update, delete on public.saved_searches from authenticated;
revoke insert on public.abuse_reports from authenticated;

-- a notification is read or unread; nothing else about it is the owner's to change
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- has_role() is an internal predicate, not something a client calls
revoke all on function public.has_role(uuid, public.app_role) from public, anon, authenticated;
grant execute on function public.has_role(uuid, public.app_role) to service_role;

revoke all on function public.request_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated, service_role;

notify pgrst, 'reload schema';
