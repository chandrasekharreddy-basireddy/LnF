-- L&F :: 0018 the seven oversight fixes
--
-- 1. audit_logs becomes tamper-evident: each row carries the hash of the one
--    before it, so deleting or editing history breaks the chain visibly.
-- 2. a high-value handover needs a second staff member, named on the record.
-- 3. a first-time reporter's listings are reviewed before they go public.
-- 4. a weekly review can be recorded, so "nobody looks at the numbers" is a
--    state you can see rather than a suspicion.

-- ---------------------------------------------------------------- 1
alter table public.audit_logs
  add column if not exists prev_hash text,
  add column if not exists entry_hash text;

create or replace function public.audit_chain() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_prev text;
begin
  -- serialise chain writes so two concurrent inserts cannot fork it
  perform pg_advisory_xact_lock(918273465);

  select entry_hash into v_prev from public.audit_logs order by id desc limit 1;
  new.prev_hash := v_prev;
  new.entry_hash := encode(digest(
    coalesce(v_prev, '') || '|' ||
    coalesce(new.action, '') || '|' ||
    coalesce(new.resource_type, '') || '|' ||
    coalesce(new.resource_id::text, '') || '|' ||
    coalesce(new.detail::text, '') || '|' ||
    coalesce(new.actor_id::text, '') || '|' ||
    new.created_at::text,
    'sha256'), 'hex');
  return new;
end;
$$;

drop trigger if exists audit_logs_chain on public.audit_logs;
create trigger audit_logs_chain before insert on public.audit_logs
  for each row execute function public.audit_chain();

-- Backfill the rows written before the chain existed, oldest first.
do $$
declare
  r record;
  v_prev text := null;
  v_hash text;
begin
  for r in select id, action, resource_type, resource_id, detail, actor_id, created_at
             from public.audit_logs where entry_hash is null order by id
  loop
    v_hash := encode(digest(
      coalesce(v_prev, '') || '|' || coalesce(r.action, '') || '|' ||
      coalesce(r.resource_type, '') || '|' || coalesce(r.resource_id::text, '') || '|' ||
      coalesce(r.detail::text, '') || '|' || coalesce(r.actor_id::text, '') || '|' ||
      r.created_at::text, 'sha256'), 'hex');
    update public.audit_logs set prev_hash = v_prev, entry_hash = v_hash where id = r.id;
    v_prev := v_hash;
  end loop;
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

    if r.entry_hash is distinct from v_expected or r.prev_hash is distinct from v_prev then
      return jsonb_build_object('ok', false, 'brokenAt', r.id, 'checked', v_checked);
    end if;

    v_prev := r.entry_hash;
    v_checked := v_checked + 1;
  end loop;

  return jsonb_build_object('ok', true, 'checked', v_checked, 'head', v_prev);
end;
$$;

revoke all on function public.verify_audit_chain(int) from public, anon;
grant execute on function public.verify_audit_chain(int) to authenticated, service_role;

-- ---------------------------------------------------------------- 2
alter table public.handover_records
  add column if not exists witness_id uuid references auth.users (id) on delete set null;

create or replace function public.staff_directory()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', coalesce(nullif(p.full_name, ''), split_part(coalesce(p.email, 'staff'), '@', 1))
    ) order by coalesce(p.full_name, p.email))
    from public.profiles p
    join public.user_roles r on r.user_id = p.id and r.role in ('staff', 'admin')
    where p.id <> auth.uid()
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.staff_directory() from public, anon;
grant execute on function public.staff_directory() to authenticated;

-- ---------------------------------------------------------------- 3
-- The three-argument version is replaced, not overloaded: two functions with
-- the same name and overlapping arguments make PostgREST guess.
drop function if exists public.staff_confirm_handover(text, text, text);

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
    update public.handover_codes set used_at = now() where id = v_code.id;
  elsif char_length(btrim(coalesce(p_note, ''))) < 4 then
    -- no code means a supervisor override, and an override needs a reason
    return jsonb_build_object('ok', false, 'error', 'NOTE_REQUIRED');
  end if;

  update public.items set status = 'recovered' where id = v_item.id;

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

revoke all on function public.staff_confirm_handover(text, text, text, uuid) from public, anon;
grant execute on function public.staff_confirm_handover(text, text, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- 4
create table if not exists public.ops_reviews (
  id uuid primary key default gen_random_uuid(),
  week_of date not null unique,
  reviewed_by uuid references auth.users (id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
alter table public.ops_reviews enable row level security;
create policy ops_reviews_read on public.ops_reviews for select to authenticated
  using (public.is_staff());
grant select on public.ops_reviews to authenticated;
revoke all on public.ops_reviews from anon;

create or replace function public.record_weekly_review(p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_week date := date_trunc('week', now())::date;
begin
  if not public.is_staff() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;

  insert into public.ops_reviews (week_of, reviewed_by, notes)
  values (v_week, v_uid, left(coalesce(p_notes, ''), 1000))
  on conflict (week_of) do update
    set reviewed_by = excluded.reviewed_by,
        notes = coalesce(excluded.notes, public.ops_reviews.notes),
        created_at = now();

  insert into public.audit_logs (actor_id, action, resource_type, detail)
  values (v_uid, 'weekly_review_recorded', 'ops_review', jsonb_build_object('week_of', v_week));

  return jsonb_build_object('ok', true, 'week', v_week);
end;
$$;

revoke all on function public.record_weekly_review(text) from public, anon;
grant execute on function public.record_weekly_review(text) to authenticated;

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
  if p_event_date is null or p_event_date > current_date then
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
  select coalesce(r.retention_days, 90) into v_days
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

revoke all on function public.create_item(text, text, text, text, text, text, date, text, text, text, boolean, text, text, text)
  from public, anon;
grant execute on function public.create_item(text, text, text, text, text, text, date, text, text, text, boolean, text, text, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
