-- L&F :: 0030 the dispute room, and the numbers behind a second look
--
-- A claim decision is made by one staff member from an answer hash and whatever
-- proof the claimant typed. Sometimes that is wrong: the owner described the
-- item badly, the finder's question was ambiguous, or two people own identical
-- things. Today the only recourse is an email to the desk, which leaves no
-- record, no deadline and no way to see whether the desk is fair.
--
-- This adds the missing half of the claim:
--   1. disputes            — one row per contested claim, with a state machine
--   2. open_dispute()      — the claimant (or the finder) asks for a second look
--   3. decide_dispute()    — staff uphold or dismiss, with a reason on the record
--   4. withdraw_dispute()  — the opener can drop it before it is decided
--   5. my_disputes()       — what the signed-in person has open
--   6. dispute_room()      — the one dispute, for the page that renders it
--   7. dispute_queue()     — the desk's queue, oldest first
--   8. claimant_trust()    — staff-only counts behind a claimant's history
--   9. public_trust()      — public, person-free numbers about the desk itself
--
-- The conversation in a dispute room is not a second chat system. It is the
-- claim's existing thread (0011/0020): one message table, one moderation path,
-- one audit trail. A dispute adds state and a deadline around that thread.
--
-- Authorization lives here, in the functions. The page decides what to draw; it
-- never decides who may write.

create sequence if not exists public.dispute_ref_seq start 1;

create or replace function public.next_dispute_ref() returns text
language sql volatile as $$
  select 'DSP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.dispute_ref_seq')::text, 4, '0');
$$;

-- ---------------------------------------------------------------- storage
create table if not exists public.disputes (
  id uuid primary key default gen_random_uuid(),
  ref_code text not null unique default public.next_dispute_ref(),
  claim_id uuid not null unique references public.claims (id) on delete cascade,
  opened_by uuid not null references auth.users (id) on delete cascade,
  opener_role text not null check (opener_role in ('claimant', 'finder')),
  reason text not null check (char_length(reason) between 20 and 2000),
  status text not null default 'open' check (status in ('open', 'upheld', 'dismissed', 'withdrawn')),
  outcome_note text check (char_length(outcome_note) between 1 and 2000),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  reopened_claim boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists disputes_status_idx on public.disputes (status, created_at);
create index if not exists disputes_opened_by_idx on public.disputes (opened_by);

drop trigger if exists disputes_touch on public.disputes;
create trigger disputes_touch before update on public.disputes
  for each row execute function public.touch_updated_at();

alter table public.disputes enable row level security;

-- Parties are resolved through a definer helper, not an inline join: the
-- claimant cannot read the item row under RLS, so an inline `exists (... join
-- items ...)` would quietly deny them their own dispute.
create or replace function public.dispute_party(p_claim_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.claims c
    join public.items i on i.id = c.item_id
    where c.id = p_claim_id
      and (c.claimant_id = auth.uid() or i.reporter_id = auth.uid())
  );
$$;

revoke all on function public.dispute_party(uuid) from public, anon;
grant execute on function public.dispute_party(uuid) to authenticated, service_role;

drop policy if exists disputes_read_parties on public.disputes;
create policy disputes_read_parties on public.disputes for select to authenticated
  using (public.is_staff() or opened_by = auth.uid() or public.dispute_party(claim_id));

-- no insert/update/delete policy and no write grant: the functions are the only writers
revoke all on public.disputes from anon, authenticated;
grant select on public.disputes to authenticated;
grant select, insert, update on public.disputes to service_role;

-- ---------------------------------------------------------------- open
create or replace function public.open_dispute(p_claim_ref text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_claim public.claims;
  v_item public.items;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_role text;
  v_scan jsonb;
  v_reason_flag text;
  v_decided timestamptz;
  v_ref text;
  v_recipient uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;

  select * into v_claim from public.claims where upper(ref_code) = upper(btrim(coalesce(p_claim_ref, '')));
  if v_claim.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  select * into v_item from public.items where id = v_claim.item_id;
  if v_item.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  if v_claim.claimant_id = v_uid then
    v_role := 'claimant';
  elsif v_item.reporter_id = v_uid then
    v_role := 'finder';
  else
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  if char_length(v_reason) < 20 then
    return jsonb_build_object('ok', false, 'error', 'REASON_TOO_SHORT');
  end if;
  if char_length(v_reason) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'TOO_LONG');
  end if;

  -- the same scan the chat uses: a dispute is a conversation, not a loophole
  v_scan := public.scan_message(v_reason);
  if (v_scan ->> 'extortion')::boolean then
    v_reason_flag := 'payment requests';
  elsif (v_scan ->> 'id_number')::boolean then
    v_reason_flag := 'ID or card numbers';
  elsif (v_scan ->> 'contact')::boolean then
    v_reason_flag := 'phone numbers or email addresses';
  end if;
  if v_reason_flag is not null then
    return jsonb_build_object('ok', false, 'error', 'BLOCKED', 'reason', v_reason_flag);
  end if;

  -- there has to be a decision to contest
  if v_claim.status not in ('rejected', 'approved') and v_item.status <> 'recovered' then
    return jsonb_build_object('ok', false, 'error', 'NOT_DECIDED');
  end if;

  v_decided := coalesce(v_claim.decided_at, v_claim.updated_at, v_claim.created_at);
  if now() - v_decided > interval '14 days' then
    return jsonb_build_object('ok', false, 'error', 'WINDOW_CLOSED');
  end if;

  if exists (select 1 from public.disputes d where d.claim_id = v_claim.id) then
    return jsonb_build_object('ok', false, 'error', 'DISPUTE_EXISTS');
  end if;

  if not public.rate_limit('dispute:' || v_uid::text, 3, interval '24 hours') then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;

  insert into public.disputes (claim_id, opened_by, opener_role, reason)
  values (v_claim.id, v_uid, v_role, v_reason)
  returning ref_code into v_ref;

  insert into public.claim_events (claim_id, status, note, actor_id)
  values (v_claim.id, v_claim.status, 'Dispute ' || v_ref || ' opened.', v_uid);

  -- tell the other side; never the opener
  v_recipient := case when v_role = 'claimant' then v_item.reporter_id else v_claim.claimant_id end;
  insert into public.notifications (user_id, kind, title, body, link)
  select v_recipient, 'claim_update', 'A claim decision was contested',
    'Reference ' || v_claim.ref_code || ' (dispute ' || v_ref || '). Someone asked the desk to look again. '
      || 'You can follow it in the conversation.',
    '/claims/' || v_claim.ref_code
  where v_recipient is not null;

  insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail, severity)
  values (v_uid, 'dispute_opened', 'claim', v_claim.id,
    jsonb_build_object('dispute', v_ref, 'role', v_role, 'claim', v_claim.ref_code), 'warn');

  perform public.event_log('dispute_opened', jsonb_build_object('role', v_role));

  return jsonb_build_object('ok', true, 'ref', v_ref);
end;
$$;

revoke all on function public.open_dispute(text, text) from public, anon;
grant execute on function public.open_dispute(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------- decide
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

revoke all on function public.decide_dispute(text, text, text) from public, anon;
grant execute on function public.decide_dispute(text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------- withdraw
create or replace function public.withdraw_dispute(p_dispute_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_dispute public.disputes;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;

  select * into v_dispute from public.disputes
   where upper(ref_code) = upper(btrim(coalesce(p_dispute_ref, '')));
  if v_dispute.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if v_dispute.opened_by <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  perform 1 from public.disputes where id = v_dispute.id for update;
  select * into v_dispute from public.disputes where id = v_dispute.id;
  if v_dispute.status <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_DECIDED');
  end if;

  update public.disputes set status = 'withdrawn', decided_at = now() where id = v_dispute.id;

  insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail, severity)
  values (v_uid, 'dispute_withdrawn', 'claim', v_dispute.claim_id,
    jsonb_build_object('dispute', v_dispute.ref_code), 'info');

  return jsonb_build_object('ok', true, 'status', 'withdrawn');
end;
$$;

revoke all on function public.withdraw_dispute(text) from public, anon;
grant execute on function public.withdraw_dispute(text) to authenticated, service_role;

-- ---------------------------------------------------------------- list
create or replace function public.my_disputes()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(payload order by created_at desc)
    from (
      select jsonb_build_object(
        'ref', d.ref_code,
        'claimRef', c.ref_code,
        'itemRef', i.ref_code,
        'itemTitle', i.title,
        'status', d.status,
        'openerRole', d.opener_role,
        'mine', d.opened_by = v_uid,
        'claimStatus', c.status,
        'reopened', d.reopened_claim,
        'createdAt', d.created_at,
        'decidedAt', d.decided_at
      ) as payload,
      d.created_at
      from public.disputes d
      join public.claims c on c.id = d.claim_id
      join public.items i on i.id = c.item_id
      where d.opened_by = v_uid or c.claimant_id = v_uid or i.reporter_id = v_uid
      order by d.created_at desc
      limit 50
    ) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.my_disputes() from public, anon;
grant execute on function public.my_disputes() to authenticated, service_role;

-- ---------------------------------------------------------------- what I can contest
-- The page needs to know which of my claims are still inside the window and have
-- no dispute yet. Computing that in the browser from my_claims() would mean
-- shipping decided_at for every claim and re-deriving the window in TypeScript,
-- which is exactly the kind of rule that drifts from the one the database applies.
create or replace function public.my_disputable_claims()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(payload order by decided_at desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'claimRef', c.ref_code,
      'itemRef', i.ref_code,
      'itemTitle', i.title,
      'role', case when c.claimant_id = auth.uid() then 'claimant' else 'finder' end,
      'claimStatus', c.status,
      'itemStatus', i.status,
      'decidedAt', coalesce(c.decided_at, c.updated_at, c.created_at),
      'daysLeft', greatest(0, 14 - floor(extract(epoch from (now() - coalesce(c.decided_at, c.updated_at, c.created_at))) / 86400)::int)
    ) as payload,
    coalesce(c.decided_at, c.updated_at, c.created_at) as decided_at
    from public.claims c
    join public.items i on i.id = c.item_id
    where auth.uid() is not null
      and (c.claimant_id = auth.uid() or i.reporter_id = auth.uid())
      and (c.status in ('rejected', 'approved') or i.status = 'recovered')
      and coalesce(c.decided_at, c.updated_at, c.created_at) > now() - interval '14 days'
      and not exists (select 1 from public.disputes d where d.claim_id = c.id)
    order by coalesce(c.decided_at, c.updated_at, c.created_at) desc
    limit 20
  ) t;
$$;

revoke all on function public.my_disputable_claims() from public, anon;
grant execute on function public.my_disputable_claims() to authenticated, service_role;

-- ---------------------------------------------------------------- room
create or replace function public.dispute_room(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_dispute public.disputes;
  v_claim public.claims;
  v_item public.items;
  v_staff boolean := public.is_staff();
  v_role text;
begin
  if v_uid is null then return null; end if;

  select * into v_dispute from public.disputes
   where upper(ref_code) = upper(btrim(coalesce(p_ref, '')));
  if v_dispute.id is null then return null; end if;

  select * into v_claim from public.claims where id = v_dispute.claim_id;
  select * into v_item from public.items where id = v_claim.item_id;

  if v_staff then
    v_role := 'staff';
  elsif v_claim.claimant_id = v_uid then
    v_role := 'claimant';
  elsif v_item.reporter_id = v_uid then
    v_role := 'finder';
  else
    return null;
  end if;

  return jsonb_build_object(
    'ref', v_dispute.ref_code,
    'status', v_dispute.status,
    'reason', v_dispute.reason,
    'openerRole', v_dispute.opener_role,
    'outcomeNote', v_dispute.outcome_note,
    'reopened', v_dispute.reopened_claim,
    'createdAt', v_dispute.created_at,
    'decidedAt', v_dispute.decided_at,
    'role', v_role,
    'canWithdraw', v_dispute.status = 'open' and v_dispute.opened_by = v_uid,
    'claimRef', v_claim.ref_code,
    'claimStatus', v_claim.status,
    'claimDecisionReason', v_claim.decision_reason,
    'claimDecidedAt', v_claim.decided_at,
    'itemRef', v_item.ref_code,
    'itemTitle', v_item.title,
    'itemStatus', v_item.status,
    'itemCustody', v_item.custody_label
  );
end;
$$;

revoke all on function public.dispute_room(text) from public, anon;
grant execute on function public.dispute_room(text) to authenticated, service_role;

-- ---------------------------------------------------------------- desk queue
create or replace function public.dispute_queue(p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if not public.is_staff() then return null; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'ref', q.ref_code,
      'claimRef', q.claim_ref,
      'itemRef', q.item_ref,
      'itemTitle', q.item_title,
      'itemStatus', q.item_status,
      'claimStatus', q.claim_status,
      'openerRole', q.opener_role,
      'reason', q.reason,
      'createdAt', q.created_at,
      'ageDays', floor(extract(epoch from (now() - q.created_at)) / 86400)::int,
      'claimant', q.claimant,
      'claimantEmail', q.claimant_email,
      'trust', q.trust
    ) order by q.created_at)
    from (
      select d.ref_code, c.ref_code as claim_ref, i.ref_code as item_ref, i.title as item_title,
             i.status::text as item_status, c.status::text as claim_status,
             d.opener_role, left(d.reason, 400) as reason, d.created_at,
             coalesce(p.full_name, 'Member') as claimant, p.email as claimant_email,
             jsonb_build_object(
               'claimsTotal', (select count(*) from public.claims x where x.claimant_id = c.claimant_id),
               'approved', (select count(*) from public.claims x where x.claimant_id = c.claimant_id and x.status = 'approved'),
               'rejected', (select count(*) from public.claims x where x.claimant_id = c.claimant_id and x.status = 'rejected'),
               'handovers', (select count(*) from public.handover_records h
                               join public.claims x on x.id = h.claim_id
                              where x.claimant_id = c.claimant_id),
               'disputesOpened', (select count(*) from public.disputes y where y.opened_by = c.claimant_id),
               'disputesUpheld', (select count(*) from public.disputes y where y.opened_by = c.claimant_id and y.status = 'upheld'),
               'accountAgeDays', (select greatest(0, floor(extract(epoch from (now() - pr.created_at)) / 86400))::int
                                    from public.profiles pr where pr.id = c.claimant_id)
             ) as trust
      from public.disputes d
      join public.claims c on c.id = d.claim_id
      join public.items i on i.id = c.item_id
      left join public.profiles p on p.id = c.claimant_id
      where d.status = 'open'
      order by d.created_at
      limit v_limit
    ) q
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.dispute_queue(int) from public, anon;
grant execute on function public.dispute_queue(int) to authenticated, service_role;

-- ---------------------------------------------------------------- trust
-- Staff-only. These are counts, not a verdict: the desk reads them next to the
-- claim, and the label is computed in src/lib/trust.ts so it can be tested.
create or replace function public.claimant_trust(p_claim_ref text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_claim public.claims;
  v_claimant uuid;
begin
  if not public.is_staff() then return null; end if;

  select * into v_claim from public.claims where upper(ref_code) = upper(btrim(coalesce(p_claim_ref, '')));
  if v_claim.id is null then return null; end if;
  v_claimant := v_claim.claimant_id;

  return jsonb_build_object(
    'claimsTotal', (select count(*) from public.claims x where x.claimant_id = v_claimant),
    'approved', (select count(*) from public.claims x where x.claimant_id = v_claimant and x.status = 'approved'),
    'rejected', (select count(*) from public.claims x where x.claimant_id = v_claimant and x.status = 'rejected'),
    'handovers', (select count(*) from public.handover_records h
                    join public.claims x on x.id = h.claim_id
                   where x.claimant_id = v_claimant),
    'disputesOpened', (select count(*) from public.disputes y where y.opened_by = v_claimant),
    'disputesUpheld', (select count(*) from public.disputes y where y.opened_by = v_claimant and y.status = 'upheld'),
    'accountAgeDays', (select greatest(0, floor(extract(epoch from (now() - pr.created_at)) / 86400))::int
                         from public.profiles pr where pr.id = v_claimant)
  );
end;
$$;

revoke all on function public.claimant_trust(text) from public, anon;
grant execute on function public.claimant_trust(text) to authenticated, service_role;

-- Public. Deliberately person-free: it describes the desk's own behaviour, never
-- a claimant, a finder or an item.
create or replace function public.public_trust()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'disputesOpened', (select count(*) from public.disputes),
    'disputesResolved', (select count(*) from public.disputes where status in ('upheld', 'dismissed')),
    'disputesUpheld', (select count(*) from public.disputes where status = 'upheld'),
    'openDisputes', (select count(*) from public.disputes where status = 'open'),
    'medianResolutionDays', (
      select round(percentile_cont(0.5) within group (
        order by extract(epoch from (decided_at - created_at)) / 86400
      )::numeric, 1)
      from public.disputes where decided_at is not null
    ),
    'claimsDecided30d', (select count(*) from public.claims where decided_at > now() - interval '30 days')
  );
$$;

revoke all on function public.public_trust() from public;
grant execute on function public.public_trust() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
