-- L&F :: 0011 masked claim messaging
--
-- The last reason two strangers exchange phone numbers is that they have no way
-- to talk. This gives them one that never reveals an address: every message is
-- read in the app, every sender is labelled by role, and anything that tries to
-- move the conversation off-platform (or paste a phone number into it) is
-- quarantined instead of delivered.

create table public.claim_messages (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id) on delete cascade,
  sender_id uuid references auth.users (id) on delete set null,
  sender_role text not null check (sender_role in ('claimant', 'finder', 'staff')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  quarantined boolean not null default false,
  flagged_reason text,
  created_at timestamptz not null default now()
);

create index claim_messages_thread_idx on public.claim_messages (claim_id, created_at);

alter table public.claim_messages enable row level security;

create policy claim_messages_read on public.claim_messages for select to authenticated
  using (
    public.is_staff()
    or exists (
      select 1
      from public.claims c
      join public.items i on i.id = c.item_id
      where c.id = claim_messages.claim_id
        and (c.claimant_id = auth.uid() or i.reporter_id = auth.uid())
    )
  );

-- no insert/update/delete policy: post_claim_message() is the only writer
revoke all on public.claim_messages from anon, authenticated;
grant select on public.claim_messages to authenticated;

-- ---------------------------------------------------------------- the scan
-- Kept in SQL because a client-side check is advice, not enforcement.
create or replace function public.scan_message(p_text text)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'extortion', coalesce(p_text ~* '(venmo|zelle|(^|[^a-z])upi([^a-z]|$)|paytm|gpay|phonepe|bhim|gift[[:space:]]?card|ransom|reward[[:space:]]?fee|pay[[:space:]]?me|send[[:space:]]?money|whatsapp[[:space:]]?me|telegram|western[[:space:]]?union|bit\.ly|tinyurl)', false),
    'contact', coalesce(p_text ~* '([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|(^|[^0-9])(\+?91)?[6-9][0-9]{9}([^0-9]|$))', false),
    'id_number', coalesce(p_text ~ '[2-9][0-9]{3}[[:space:]]?[0-9]{4}[[:space:]]?[0-9]{4}' or p_text ~ '[A-Z]{5}[0-9]{4}[A-Z]', false)
  );
$$;

revoke all on function public.scan_message(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- post
create or replace function public.post_claim_message(p_claim_ref text, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_claim public.claims;
  v_item public.items;
  v_role text;
  v_body text := btrim(coalesce(p_body, ''));
  v_scan jsonb;
  v_reason text;
  v_recipient uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); end if;
  if char_length(v_body) < 1 then return jsonb_build_object('ok', false, 'error', 'EMPTY'); end if;
  if char_length(v_body) > 2000 then return jsonb_build_object('ok', false, 'error', 'TOO_LONG'); end if;

  select * into v_claim from public.claims where upper(ref_code) = upper(p_claim_ref);
  if v_claim.id is null then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  select * into v_item from public.items where id = v_claim.item_id;

  if public.is_staff() then
    v_role := 'staff';
  elsif v_claim.claimant_id = v_uid then
    v_role := 'claimant';
  elsif v_item.reporter_id = v_uid then
    v_role := 'finder';
  else
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  if v_claim.status in ('rejected', 'withdrawn') or v_item.status = 'recovered' then
    return jsonb_build_object('ok', false, 'error', 'THREAD_CLOSED');
  end if;

  if not public.rate_limit('msg:' || v_uid::text, 30, interval '15 minutes') then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;

  v_scan := public.scan_message(v_body);
  if (v_scan ->> 'extortion')::boolean then
    v_reason := 'Asks for payment or moves the conversation off the board';
  elsif (v_scan ->> 'contact')::boolean then
    v_reason := 'Contains a phone number or email address';
  elsif (v_scan ->> 'id_number')::boolean then
    v_reason := 'Contains an identity or card number';
  end if;

  insert into public.claim_messages (claim_id, sender_id, sender_role, body, quarantined, flagged_reason)
  values (v_claim.id, v_uid, v_role, v_body, v_reason is not null, v_reason);

  if v_reason is not null then
    insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail, severity)
    values (v_uid, 'message_quarantined', 'claim', v_claim.id,
      jsonb_build_object('reason', v_reason), 'alert');
    return jsonb_build_object('ok', false, 'error', 'BLOCKED', 'reason', v_reason);
  end if;

  if v_role = 'claimant' then
    v_recipient := v_item.reporter_id;
  elsif v_role = 'finder' then
    v_recipient := v_claim.claimant_id;
  end if;

  if v_recipient is not null then
    insert into public.notifications (user_id, kind, title, body, link)
    values (v_recipient, 'claim_update', 'New message on a claim',
      'Reference ' || v_claim.ref_code || '. Open the thread to read it. Replies stay on the board.',
      '/claims/' || v_claim.ref_code);
  end if;

  insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail)
  values (v_uid, 'message_sent', 'claim', v_claim.id, jsonb_build_object('role', v_role));

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- read
create or replace function public.claim_thread(p_claim_ref text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_claim public.claims;
  v_item public.items;
  v_role text;
begin
  if v_uid is null then return null; end if;

  select * into v_claim from public.claims where upper(ref_code) = upper(p_claim_ref);
  if v_claim.id is null then return null; end if;
  select * into v_item from public.items where id = v_claim.item_id;

  if public.is_staff() then
    v_role := 'staff';
  elsif v_claim.claimant_id = v_uid then
    v_role := 'claimant';
  elsif v_item.reporter_id = v_uid then
    v_role := 'finder';
  else
    return null;
  end if;

  return jsonb_build_object(
    'role', v_role,
    'locked', v_claim.status in ('rejected', 'withdrawn') or v_item.status = 'recovered',
    'lockReason', case
      when v_item.status = 'recovered' then 'This item was handed over, so the thread is read-only.'
      when v_claim.status = 'rejected' then 'This claim was closed, so the thread is read-only.'
      else null end,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'body', m.body,
        'role', m.sender_role,
        'mine', m.sender_id = v_uid,
        'quarantined', m.quarantined,
        'flaggedReason', m.flagged_reason,
        'at', m.created_at
      ) order by m.created_at)
      from public.claim_messages m
      where m.claim_id = v_claim.id
        and (not m.quarantined or m.sender_id = v_uid or public.is_staff())
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.post_claim_message(text, text) from public, anon;
revoke all on function public.claim_thread(text) from public, anon;
grant execute on function public.post_claim_message(text, text) to authenticated;
grant execute on function public.claim_thread(text) to authenticated;

notify pgrst, 'reload schema';
