-- L&F :: 0022 senior audit remediation
--
-- Everything here was verified against the code before it was changed. Three
-- findings are load-bearing security fixes, not tidying:
--   * handover codes were generated with random(), not a CSPRNG
--   * an email whose subject carried a sign-in code was logged in plaintext
--   * staff_decide_claim could be raced on the claim row, not just the item
--
-- Some findings in that audit were already fixed (the pgcrypto search_path, the
-- quarantine stub, the approved-claim retention guard); those are noted in
-- docs/audit-2026-11-28.md rather than re-implemented.

-- ---------------------------------------------------------------- queue
create table if not exists public.storage_deletion_queue (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);
alter table public.storage_deletion_queue enable row level security;
revoke all on public.storage_deletion_queue from public, anon, authenticated;
grant select, insert, update, delete on public.storage_deletion_queue to service_role;

-- ---------------------------------------------------------------- invariants
create unique index if not exists claims_one_approved_per_item
  on public.claims (item_id) where status = 'approved';
create unique index if not exists handover_records_one_per_item
  on public.handover_records (item_id);
create unique index if not exists item_images_storage_path_uidx
  on public.item_images (storage_path);
create index if not exists items_ref_upper_idx on public.items (upper(ref_code));
create index if not exists claims_ref_upper_idx on public.claims (upper(ref_code));

-- ---------------------------------------------------------------- leaks
-- writes go through toggle_saved_item(); direct table writes are not needed
revoke insert, delete on public.saved_items from authenticated;

-- the photo path must stay inside the uploader's own prefix
drop policy if exists item_images_insert_own on public.item_images;
create policy item_images_insert_own on public.item_images
  for insert to authenticated
  with check (
    exists (
      select 1 from public.items i
      where i.id = item_id
        and i.reporter_id = auth.uid()
        and i.status in ('available', 'pending_moderation')
    )
    and split_part(storage_path, '/', 1) = auth.uid()::text
    and position('..' in storage_path) = 0
  );

-- an anonymous claim report is a report like any other
grant execute on function public.submit_report(text, text, text) to anon;

-- ---------------------------------------------------------------- functions
create or replace function public.get_public_item(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_item public.items;
  v_zone text;
  v_zone_code text;
begin
  select * into v_item from public.items
   where upper(ref_code) = upper(p_ref)
     and status in ('available', 'claimed', 'recovered', 'quarantined');
  if v_item.id is null then return null; end if;

  -- A quarantined listing is an identity document. It gets a reference and
  -- nothing else: no title, no description, no custody label, no photos.
  if v_item.status = 'quarantined' then
    return jsonb_build_object(
      'item', jsonb_build_object(
        'ref', v_item.ref_code, 'type', v_item.type,
        'status', v_item.status, 'sensitiveHiddenPhoto', true
      ),
      'photos', '[]'::jsonb
    );
  end if;

  select z.name, z.code into v_zone, v_zone_code
    from public.campus_zones z where z.id = v_item.zone_id;

  return jsonb_build_object(
    'item', public.to_public_item(v_item, v_zone, v_zone_code),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'path', im.storage_path, 'alt', im.alt_text,
        'width', im.width, 'height', im.height
      ) order by im.position)
      from public.item_images im
      where im.item_id = v_item.id and v_item.sensitive_hidden_photo = false
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.staff_decide_claim(p_claim_ref text, p_decision text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
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

  -- serialise competing decisions on the same item, and on the claim itself
  perform 1 from public.items where id = v_item.id for update;
  perform 1 from public.claims where id = v_claim.id for update;

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

  -- a handover code is a bearer token: it must come from a CSPRNG, not random()
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
           (get_byte(extensions.gen_random_bytes(1), 0) % 32) + 1, 1), '')
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

create or replace function public.staff_confirm_handover(
  p_item_ref text, p_code text default null, p_note text default null, p_witness uuid default null
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

  select * into v_item from public.items where upper(ref_code) = upper(p_item_ref);
  if v_item.id is null then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;

  -- serialise: two counters cannot release the same item, and the attempt
  -- counter cannot be raced past the lockout
  perform 1 from public.items where id = v_item.id for update;

  if v_item.status = 'recovered' then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_RECOVERED');
  end if;

  select * into v_claim from public.claims
    where item_id = v_item.id and status = 'approved'
    order by decided_at desc limit 1;
  if v_claim.id is null then return jsonb_build_object('ok', false, 'error', 'NO_APPROVED_CLAIM'); end if;

  -- High-value categories are released by two people, and both are named.
  select coalesce(r.requires_photo_id, false) into v_needs_witness
    from public.retention_policies r where r.category = v_item.category;

  if v_needs_witness then
    if p_witness is null then
      return jsonb_build_object('ok', false, 'error', 'WITNESS_REQUIRED');
    end if;
    if p_witness = v_uid then
      return jsonb_build_object('ok', false, 'error', 'WITNESS_IS_SELF');
    end if;
    if not exists (
      select 1 from public.user_roles
      where user_id = p_witness and role in ('staff', 'admin')
    ) then
      return jsonb_build_object('ok', false, 'error', 'WITNESS_NOT_STAFF');
    end if;
  end if;

  select * into v_code from public.handover_codes where claim_id = v_claim.id for update;

  if v_code.id is not null and v_code.expires_at is not null and v_code.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'CODE_EXPIRED');
  end if;

  if v_code.id is not null and v_code.locked_until is not null and v_code.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'LOCKED',
      'minutes', ceil(extract(epoch from (v_code.locked_until - now())) / 60));
  end if;

  if p_code is not null and btrim(p_code) <> '' then
    if v_code.id is null
       or v_code.code_hash <> encode(digest(upper(btrim(p_code)), 'sha256'), 'hex') then
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
    if v_code.used_at is not null then
      return jsonb_build_object('ok', false, 'error', 'CODE_USED');
    end if;
    v_verified := true;
    -- single use, and the plaintext is not kept once it has been spent
    update public.handover_codes set used_at = now(), code_plain = null where id = v_code.id;
  elsif char_length(btrim(coalesce(p_note, ''))) < 4 then
    -- no code means a supervisor override, and an override needs a reason
    return jsonb_build_object('ok', false, 'error', 'NOTE_REQUIRED');
  end if;

  update public.items set status = 'recovered' where id = v_item.id;
  update public.handover_codes set code_plain = null
   where claim_id = v_claim.id and used_at is null;

  insert into public.handover_records (item_id, claim_id, staff_id, code_verified, note, witness_id)
  values (v_item.id, v_claim.id, v_uid, v_verified, nullif(btrim(coalesce(p_note, '')), ''), p_witness);

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
    jsonb_build_object('claim', v_claim.ref_code, 'code_verified', v_verified,
      'witness', p_witness, 'witnessed', v_needs_witness), 'info');

  perform public.event_log('handover_confirmed', jsonb_build_object(
    'item_ref', v_item.ref_code, 'code_verified', v_verified));

  return jsonb_build_object('ok', true, 'itemRef', v_item.ref_code);
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
    coalesce(p_sensitive, false), v_uid,
    case when p_reporter_kind in ('member', 'staff', 'owner') then p_reporter_kind else 'member' end,
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

create or replace function public.log_auth_event(p_kind text, p_email text, p_ip text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_bucket text := coalesce(encode(digest(coalesce(p_ip, 'anon-global'), 'sha256'), 'hex'), 'anon-global');
begin
  if p_kind not in ('code_requested', 'code_verified', 'code_failed', 'code_throttled') then
    return;
  end if;
  -- an unthrottled audit writer is a free way to fill a table
  if not public.rate_limit('authlog:' || v_bucket, 30, interval '15 minutes') then
    return;
  end if;

  insert into public.auth_events (kind, email_hash, ip_hash)
  values (
    p_kind,
    encode(digest(lower(btrim(coalesce(p_email, ''))), 'sha256'), 'hex'),
    case when p_ip is null then null else encode(digest(p_ip, 'sha256'), 'hex') end
  );
end;
$$;

create or replace function public.claim_email_batch(p_limit int default 25)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_rows jsonb;
begin
  with picked as (
    select id from public.email_outbox
     where status in ('pending', 'sending')
       and attempts < 3
       and (locked_until is null or locked_until < now())
     order by created_at
     limit v_limit
     for update skip locked
  ),
  claimed as (
    update public.email_outbox o
       set status = 'sending',
           attempts = o.attempts + 1,
           locked_until = now() + interval '5 minutes'
      from picked
     where o.id = picked.id
    returning jsonb_build_object(
      'id', o.id, 'dedupeKey', o.dedupe_key, 'eventType', o.event_type,
      'to', o.recipient_email, 'payload', o.payload, 'attempts', o.attempts
    ) as row
  )
  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_rows from claimed;

  return v_rows;
end;
$$;

create or replace function public.verify_audit_chain(p_limit int default 5000)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  r record;
  v_prev text := null;
  v_expected text;
  v_checked int := 0;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;

  for r in select id, action, resource_type, resource_id, detail, actor_id, created_at, prev_hash, entry_hash
             from public.audit_logs order by id limit least(greatest(p_limit, 1), 20000)
  loop
    v_expected := encode(digest(
      coalesce(v_prev, '') || '|' || coalesce(r.action, '') || '|' ||
      coalesce(r.resource_type, '') || '|' || coalesce(r.resource_id::text, '') || '|' ||
      coalesce(r.detail::text, '') || '|' || coalesce(r.actor_id::text, '') || '|' ||
      r.created_at::text, 'sha256'), 'hex');

    -- the first retained row is the anchor: its prev_hash points at a row that
    -- retention may already have deleted, which is not tampering
    if v_checked = 0 then
      v_prev := r.prev_hash;
      v_expected := encode(digest(
        coalesce(v_prev, '') || '|' || coalesce(r.action, '') || '|' ||
        coalesce(r.resource_type, '') || '|' || coalesce(r.resource_id::text, '') || '|' ||
        coalesce(r.detail::text, '') || '|' || coalesce(r.actor_id::text, '') || '|' ||
        r.created_at::text, 'sha256'), 'hex');
    end if;

    if r.entry_hash is distinct from v_expected or r.prev_hash is distinct from v_prev then
      return jsonb_build_object('ok', false, 'brokenAt', r.id, 'checked', v_checked);
    end if;

    v_prev := r.entry_hash;
    v_checked := v_checked + 1;
  end loop;

  return jsonb_build_object('ok', true, 'checked', v_checked, 'head', v_prev);
end;
$$;

-- ---------------------------------------------------------------- drafts
-- never skip the throttle because a caller hid its address, and bind the
-- finished claim to the address the draft was written for
create or replace function public.create_claim_draft(
  p_ref text, p_email text, p_answer text, p_proof text default null, p_ip text default null
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_item public.items;
  v_priv public.item_private;
  v_token text;
  v_matched boolean := false;
  v_ip_hash text := encode(digest(coalesce(p_ip, 'anon-global'), 'sha256'), 'hex');
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

create or replace function public.finalise_claim_draft(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_draft public.claim_drafts;
  v_item public.items;
  v_claim public.claims;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); end if;

  if not public.rate_limit('claim:' || v_uid::text, 8, interval '1 hour') then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;

  select * into v_draft from public.claim_drafts
   where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and expires_at > now();
  if v_draft.id is null then
    return jsonb_build_object('ok', false, 'error', 'DRAFT_EXPIRED');
  end if;

  -- the session must be the address the draft was written for
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> lower(btrim(v_draft.email)) then
    return jsonb_build_object('ok', false, 'error', 'EMAIL_MISMATCH');
  end if;

  select * into v_item from public.items where id = v_draft.item_id;
  if v_item.id is null or v_item.status <> 'available' then
    return jsonb_build_object('ok', false, 'error', 'NOT_AVAILABLE');
  end if;
  if v_item.reporter_id = v_uid then
    return jsonb_build_object('ok', false, 'error', 'OWN_ITEM');
  end if;

  begin
    insert into public.claims (item_id, claimant_id, answer_hash, answer_matched, proof)
    values (v_item.id, v_uid, v_draft.answer_hash, v_draft.answer_matched, v_draft.proof)
    returning * into v_claim;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'ALREADY_CLAIMED');
  end;

  insert into public.claim_events (claim_id, status, note, actor_id)
  values (v_claim.id, 'submitted', 'Claim submitted from the public item page.', v_uid);

  insert into public.notifications (user_id, kind, title, body, link)
  values (v_uid, 'claim_update', 'Claim submitted',
    'Reference ' || v_claim.ref_code || '. The desk reviews claims within two working days.',
    '/claims/' || v_claim.ref_code);

  insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail)
  values (v_uid, 'claim_submitted', 'claim', v_claim.id,
    jsonb_build_object('ref', v_claim.ref_code, 'item', v_item.ref_code,
      'answer_matched', v_draft.answer_matched, 'via', 'public_page'));

  delete from public.claim_drafts where id = v_draft.id;
  perform public.event_log('claim_submitted', jsonb_build_object('item_ref', v_item.ref_code));

  return jsonb_build_object('ok', true, 'ref', v_claim.ref_code);
end;
$$;

revoke all on function public.create_claim_draft(text, text, text, text, text) from public, authenticated;
revoke all on function public.finalise_claim_draft(text) from public, anon;
grant execute on function public.create_claim_draft(text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.finalise_claim_draft(text) to authenticated, service_role;

notify pgrst, 'reload schema';
