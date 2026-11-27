-- L&F :: 0019 anyone can hand something in, anyone can claim it
--
-- Until now both sides needed an account before they could do the one thing the
-- product exists for. That is backwards: the finder is motivated at the moment
-- of finding, and the owner is motivated at the moment of recognising. Both now
-- get a path that needs a verified email, not a registration.
--
--   1. create_found_item_anonymous() — a public intake form. No account, no
--      photo upload (the desk photographs at intake), staff review before it is
--      published, throttled per caller.
--   2. claim_drafts — the answer is hashed at the moment it is given, so the
--      plaintext never rests anywhere. The draft is addressed by a random token
--      in an http-only cookie, and is finalised only after the email is proved.
--   3. finalise_claim_draft() — turns a proved draft into a real claim, owned by
--      the session that just verified.

-- ---------------------------------------------------------------- 0
-- A hand-in has no account behind it, so it needs its own reporter kind.
alter table public.items drop constraint if exists items_reporter_kind_check;
alter table public.items
  add constraint items_reporter_kind_check
  check (reporter_kind in ('member', 'staff', 'owner', 'finder'));

-- ---------------------------------------------------------------- 1
create or replace function public.create_found_item_anonymous(
  p_category text,
  p_title text,
  p_description text,
  p_zone_code text default null,
  p_spot text default null,
  p_event_date date default current_date,
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
  v_ip_hash text := case when p_ip is null then null
                         else encode(digest(p_ip, 'sha256'), 'hex') end;
  v_text text;
  v_id_hit boolean := false;
  v_terms text[] := array[
    'aadhaar', 'passport', 'pan card', 'driving licence', 'driving license',
    'voter id', 'id card', 'identity card', 'atm card', 'debit card', 'credit card'
  ];
  v_term text;
begin
  if v_ip_hash is not null then
    if not public.rate_limit('handin:ip:' || v_ip_hash, 5, interval '1 hour') then
      return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
    end if;
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
    v_zone, nullif(btrim(coalesce(p_spot, '')), ''), p_event_date,
    'Main Gate & Security Desk',
    btrim(p_question),
    true,                       -- no photo from an anonymous hand-in
    null,                       -- nobody owns it until the desk does
    'finder',
    nullif(btrim(coalesce(p_finder_email, '')), ''),
    null,
    now() + (v_days || ' days')::interval
  ) returning * into v_item;

  insert into public.item_private (item_id, answer_hash, finder_contact)
  values (
    v_item.id,
    encode(digest(lower(btrim(p_answer)), 'sha256'), 'hex'),
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

revoke all on function public.create_found_item_anonymous(text, text, text, text, text, date, text, text, text, text, text)
  from public, authenticated;
grant execute on function public.create_found_item_anonymous(text, text, text, text, text, date, text, text, text, text, text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------- 2
create table if not exists public.claim_drafts (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  item_id uuid not null references public.items (id) on delete cascade,
  email text not null,
  answer_hash text not null,
  answer_matched boolean not null default false,
  proof text,
  expires_at timestamptz not null default now() + interval '20 minutes',
  created_at timestamptz not null default now()
);

alter table public.claim_drafts enable row level security;
-- no policies: only the functions below touch it
revoke all on public.claim_drafts from anon, authenticated;

create or replace function public.create_claim_draft(
  p_ref text, p_email text, p_answer text, p_proof text default null, p_ip text default null
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_item public.items;
  v_priv public.item_private;
  v_token text;
  v_matched boolean := false;
  v_ip_hash text := case when p_ip is null then null
                         else encode(digest(p_ip, 'sha256'), 'hex') end;
begin
  if p_email is null or position('@' in p_email) = 0 then
    return jsonb_build_object('ok', false, 'error', 'EMAIL_REQUIRED');
  end if;
  if v_ip_hash is not null then
    if not public.rate_limit('claimdraft:ip:' || v_ip_hash, 8, interval '1 hour') then
      return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
    end if;
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

  -- housekeeping: expired drafts are worthless, drop them as we go
  delete from public.claim_drafts where expires_at < now();

  insert into public.claim_drafts (token_hash, item_id, email, answer_hash, answer_matched, proof)
  values (
    encode(digest(v_token, 'sha256'), 'hex'),
    v_item.id, lower(btrim(p_email)),
    encode(digest(lower(btrim(coalesce(p_answer, ''))), 'sha256'), 'hex'),
    v_matched,
    nullif(btrim(coalesce(p_proof, '')), '')
  );

  return jsonb_build_object('ok', true, 'token', v_token, 'email', lower(btrim(p_email)));
end;
$$;

revoke all on function public.create_claim_draft(text, text, text, text, text) from public, authenticated;
grant execute on function public.create_claim_draft(text, text, text, text, text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------- 3
create or replace function public.finalise_claim_draft(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_draft public.claim_drafts;
  v_item public.items;
  v_claim public.claims;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); end if;

  select * into v_draft from public.claim_drafts
   where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and expires_at > now();
  if v_draft.id is null then
    return jsonb_build_object('ok', false, 'error', 'DRAFT_EXPIRED');
  end if;

  select * into v_item from public.items where id = v_draft.item_id;
  if v_item.id is null or v_item.status <> 'available' then
    return jsonb_build_object('ok', false, 'error', 'NOT_AVAILABLE');
  end if;
  if v_item.reporter_id = v_uid then
    return jsonb_build_object('ok', false, 'error', 'OWN_ITEM');
  end if;

  insert into public.claims (item_id, claimant_id, answer_hash, answer_matched, proof)
  values (v_item.id, v_uid, v_draft.answer_hash, v_draft.answer_matched, v_draft.proof)
  returning * into v_claim;

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

revoke all on function public.finalise_claim_draft(text) from public, anon;
grant execute on function public.finalise_claim_draft(text) to authenticated, service_role;

notify pgrst, 'reload schema';
