-- L&F :: 0014 fixes from the multi-agent audit (27/11/2026)
--
-- 1. get_public_item() served quarantined ID-document listings to anonymous
--    callers, including their title and description.
-- 2. refresh_matches() and to_public_item() were executable by anon.
-- 3. The claim_messages RLS policy exposed quarantined messages to the other
--    party through PostgREST, bypassing post_claim_message().
-- 4. staff_confirm_handover() read the attempt counter without a row lock, so
--    the 5-try lockout could be raced.
-- 5. housekeeping() expired items that had an approved claim waiting to be
--    collected.
-- 6. The pg_cron schedule existed only in the live database, never in a
--    migration, so a fresh install had no retention job.

-- ---------------------------------------------------------------- 1
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
        'id', v_item.id, 'ref', v_item.ref_code, 'type', v_item.type,
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

-- ---------------------------------------------------------------- 2
revoke all on function public.refresh_matches(uuid) from public, anon, authenticated;
revoke all on function public.to_public_item(public.items, text, text) from public, anon, authenticated;
grant execute on function public.refresh_matches(uuid) to service_role;
grant execute on function public.to_public_item(public.items, text, text) to service_role;

-- ---------------------------------------------------------------- 3
drop policy if exists claim_messages_read on public.claim_messages;
create policy claim_messages_read on public.claim_messages for select to authenticated
  using (
    not claim_messages.quarantined
    and (
      public.is_staff()
      or exists (
        select 1
        from public.claims c
        join public.items i on i.id = c.item_id
        where c.id = claim_messages.claim_id
          and (c.claimant_id = auth.uid() or i.reporter_id = auth.uid())
      )
    )
  );

-- staff still need to see a held message: they read it through claim_thread()
-- (SECURITY DEFINER), which filters on is_staff() itself.

-- ---------------------------------------------------------------- 4
create or replace function public.staff_confirm_handover(
  p_item_ref text, p_code text default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
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

revoke all on function public.staff_confirm_handover(text, text, text) from public, anon;
grant execute on function public.staff_confirm_handover(text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------- 5
create or replace function public.housekeeping() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_expired int; v_purged int; v_notifs int; v_audit int; v_reports int;
  v_paths jsonb; v_outbox int; v_searches int;
begin
  -- an approved claim waiting to be collected must not be expired out from
  -- under the person who is coming to fetch it
  with upd as (
    update public.items i set status = 'expired'
    where i.status in ('available', 'claimed')
      and i.expires_at < now()
      and not exists (
        select 1 from public.claims c
        where c.item_id = i.id and c.status = 'approved'
      )
    returning i.id
  ) select count(*) into v_expired from upd;

  select coalesce(jsonb_agg(im.storage_path), '[]'::jsonb) into v_paths
  from public.item_images im
  join public.items i on i.id = im.item_id
  where i.status = 'expired' and i.expires_at < now() - interval '30 days';

  with del as (
    delete from public.items
    where status = 'expired' and expires_at < now() - interval '30 days'
    returning id
  ) select count(*) into v_purged from del;

  with d as (delete from public.notifications where created_at < now() - interval '180 days' returning id)
  select count(*) into v_notifs from d;
  with d as (delete from public.audit_logs where created_at < now() - interval '365 days' returning id)
  select count(*) into v_audit from d;
  with d as (delete from public.abuse_reports where status = 'closed' and created_at < now() - interval '180 days' returning id)
  select count(*) into v_reports from d;
  delete from public.rate_limits where window_start < now() - interval '2 days';

  with d as (delete from public.email_outbox where status = 'sent' and created_at < now() - interval '30 days' returning id)
  select count(*) into v_outbox from d;

  insert into public.notifications (user_id, kind, title, body, link)
  select i.reporter_id, 'system', 'Your listing expires soon',
    'Listing ' || i.ref_code || ' comes off the board in a few days. Collect it from ' ||
    coalesce(i.custody_label, 'the desk') || ' or renew it.',
    '/items/' || i.ref_code
  from public.items i
  where i.reporter_id is not null
    and i.status = 'available'
    and i.expires_at between now() and now() + interval '7 days'
    and not exists (
      select 1 from public.notifications n
      where n.user_id = i.reporter_id and n.link = '/items/' || i.ref_code
        and n.title = 'Your listing expires soon'
        and n.created_at > now() - interval '14 days'
    );

  v_searches := public.run_saved_searches();

  perform public.event_log('housekeeping_run', jsonb_build_object(
    'expired', v_expired, 'purged', v_purged, 'photos', jsonb_array_length(v_paths),
    'outboxDeleted', v_outbox, 'savedSearches', v_searches));

  return jsonb_build_object(
    'expired', v_expired, 'purged', v_purged, 'photoPaths', v_paths,
    'notificationsDeleted', v_notifs, 'auditDeleted', v_audit,
    'reportsDeleted', v_reports, 'outboxDeleted', v_outbox, 'savedSearches', v_searches
  );
end;
$$;

revoke all on function public.housekeeping() from public, anon, authenticated;
grant execute on function public.housekeeping() to service_role;

-- ---------------------------------------------------------------- 6
-- The schedule belongs in the repository, not only in the live dashboard.
-- Wrapped so a plan without pg_cron does not fail the whole migration.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('lnf-housekeeping', '15 2 * * *', 'select public.housekeeping()');
exception
  when others then
    raise notice 'pg_cron unavailable (%); schedule the job from the dashboard instead', sqlerrm;
end;
$$;

notify pgrst, 'reload schema';
