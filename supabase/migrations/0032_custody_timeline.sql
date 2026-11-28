-- L&F :: 0032 the custody timeline, for the person who reported the item
--
-- A reporter can see one status word on their listing ("Open", "Returned") and
-- a row in /account. That is the whole story they get, even though the desk
-- knows a lot more: whether it was published or held, how many people claimed
-- it, whether a claim was approved or refused, when a collection code went out,
-- when it left the building. People ask "is anything happening with my thing?"
-- by email, and the desk answers it by hand.
--
-- This adds one read: item_custody_timeline(ref) → the chain of custody for one
-- item, for its reporter (or for staff). Nothing is written, so there is no new
-- table and no new trigger to keep in sync with the write paths — every step is
-- derived from a row the existing functions already write.
--
-- What it deliberately does not return, in any field:
--   * who claimed (no claimant id, name, email, account age, trust counts)
--   * what they said (no answer, no answer_hash, no proof, no decision_reason)
--   * anything to spend (no code, no code_hash, no claim reference)
--   * staff free text (handover note, disposition note, dispute reason) — those
--     are written for the record and can quote a person
-- A claim appears as a count and a date. That is the same rule 0030's public
-- record follows: numbers about the desk, never about a person.
--
-- Authorization lives here, not in the page:
--   * no session                      → AUTH_REQUIRED
--   * unknown ref                     → NOT_FOUND
--   * a ref that exists but is not    → NOT_FOUND   (the same answer, on
--     yours and you are not staff                     purpose: a reference is
--                                                      not a capability, so the
--                                                      function is not an oracle
--                                                      for which refs exist)
--   * reporter or staff               → the timeline
--
-- `anon` cannot execute it at all.

create or replace function public.item_custody_timeline(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_item public.items;
  v_staff boolean := false;
  v_steps jsonb := '[]'::jsonb;
  v_row record;
  v_at timestamptz;
  v_n int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;

  select * into v_item
    from public.items
   where upper(ref_code) = upper(btrim(coalesce(p_ref, '')));

  if v_item.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  v_staff := public.is_staff();
  if not v_staff and v_item.reporter_id is distinct from v_uid then
    -- Indistinguishable from an unknown reference. Answering FORBIDDEN here
    -- would tell a stranger that the reference is real.
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  -- 1. how it arrived
  v_steps := v_steps || jsonb_build_object(
    'key', case when v_item.type = 'lost' then 'reported' else 'handed_in' end,
    'at', v_item.created_at,
    'count', null);

  -- 2. what the desk did with it. A quarantined listing is never published and
  --    has no published_at, so the held step stands in for it.
  if v_item.status = 'quarantined' then
    v_steps := v_steps || jsonb_build_object('key', 'held', 'at', v_item.created_at, 'count', null);
  elsif v_item.status = 'pending_moderation' then
    v_steps := v_steps || jsonb_build_object('key', 'in_review', 'at', v_item.created_at, 'count', null);
  elsif v_item.published_at is not null then
    v_steps := v_steps || jsonb_build_object('key', 'published', 'at', v_item.published_at, 'count', null);
  end if;

  -- 3. claims. First the arrival, as a count of everything ever filed — an
  --    approved claim is still a claim that arrived, so this cannot be read off
  --    the current status. Then each claim's present state, with the date the
  --    desk decided it. The claimant is never named and the claim's own
  --    reference is not passed on.
  select count(*), min(c.created_at) into v_n, v_at
    from public.claims c
   where c.item_id = v_item.id;
  if v_at is not null then
    v_steps := v_steps || jsonb_build_object('key', 'claim_received', 'at', v_at, 'count', v_n);
  end if;

  for v_row in
    select c.status, count(*) as n, max(coalesce(c.decided_at, c.created_at)) as at
      from public.claims c
     where c.item_id = v_item.id
       and c.status <> 'submitted'
     group by c.status
  loop
    v_steps := v_steps || jsonb_build_object(
      'key', case v_row.status
               when 'under_review' then 'claim_under_review'
               when 'approved' then 'claim_approved'
               when 'rejected' then 'claim_rejected'
               when 'withdrawn' then 'claim_withdrawn'
             end,
      'at', v_row.at,
      'count', v_row.n);
  end loop;

  -- 4. the collection code. The code itself is not here, and never was: only
  --    its hash is stored, and code_plain is nulled the moment it is spent.
  select max(hc.created_at) into v_at
    from public.handover_codes hc
    join public.claims c on c.id = hc.claim_id
   where c.item_id = v_item.id;
  if v_at is not null then
    v_steps := v_steps || jsonb_build_object('key', 'code_issued', 'at', v_at, 'count', null);
  end if;

  -- 5. the handover. handover_records.note and the witness are left out.
  select max(hr.created_at) into v_at
    from public.handover_records hr
   where hr.item_id = v_item.id;
  if v_at is not null then
    v_steps := v_steps || jsonb_build_object('key', 'handed_over', 'at', v_at, 'count', null);
  end if;

  -- 6. a second look, as a count per outcome. The reason and the outcome note
  --    are the parties' own words and stay in the dispute room.
  for v_row in
    select d.status, count(*) as n, min(d.created_at) as at
      from public.disputes d
      join public.claims c on c.id = d.claim_id
     where c.item_id = v_item.id
     group by d.status
  loop
    v_steps := v_steps || jsonb_build_object(
      'key', 'dispute_' || v_row.status, 'at', v_row.at, 'count', v_row.n);
  end loop;

  -- 7. the end of custody: what happened to it, or the window running out
  if v_item.disposed_at is not null then
    v_steps := v_steps || jsonb_build_object('key', 'disposed', 'at', v_item.disposed_at, 'count', null);
  end if;

  -- a disposed item is also archived; the disposition is the real last step,
  -- so the closed window is only shown when nothing else ended the custody
  if v_item.status in ('expired', 'archived') and v_item.disposed_at is null then
    v_steps := v_steps || jsonb_build_object(
      'key', 'window_closed', 'at', coalesce(v_item.expires_at, v_item.updated_at), 'count', null);
  end if;

  return jsonb_build_object(
    'ok', true,
    'access', case when v_staff then 'staff' else 'owner' end,
    'item', jsonb_build_object(
      'ref', v_item.ref_code,
      'title', v_item.title,
      'type', v_item.type,
      'status', v_item.status,
      'category', v_item.category,
      'custodyLabel', v_item.custody_label,
      'reportedAt', v_item.created_at,
      'publishedAt', v_item.published_at,
      'expiresAt', v_item.expires_at,
      'disposedAt', v_item.disposed_at,
      'disposition', v_item.disposition
    ),
    'steps', v_steps
  );
end;
$$;

revoke all on function public.item_custody_timeline(text) from public, anon;
grant execute on function public.item_custody_timeline(text) to authenticated, service_role;

notify pgrst, 'reload schema';
