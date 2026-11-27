-- L&F :: 0024 the things I said were not done
--
-- Each of these was listed in docs/audit-2026-11-28.md as open. Closing them
-- here rather than leaving the list to rot.

-- ---------------------------------------------------------------- 1. erasure
-- DPDP expects a real erasure, not a request row. This scrubs the person's
-- presence in every table that holds it, keeps the desk's custody record
-- (handovers are evidence), and queues their photos for deletion.
create or replace function public.admin_erase_user_data(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_claims int := 0;
  v_messages int := 0;
  v_items int := 0;
  v_paths int := 0;
  v_drafts int := 0;
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'BAD_INPUT');
  end if;

  -- photos of the listings they reported, and of claims they made
  with doomed as (
    select im.storage_path
    from public.item_images im
    join public.items i on i.id = im.item_id
    where i.reporter_id = p_user_id
  )
  insert into public.storage_deletion_queue (storage_path)
  select storage_path from doomed
  on conflict (storage_path) do nothing;
  get diagnostics v_paths = row_count;

  -- claims first: this cascades claim_messages, claim_events and handover codes
  with gone as (
    delete from public.claims where claimant_id = p_user_id returning id
  ) select count(*) into v_claims from gone;

  with gone as (
    delete from public.claim_messages where sender_id = p_user_id returning id
  ) select count(*) into v_messages from gone;

  delete from public.claim_drafts where lower(email) = lower(coalesce(
    (select email from public.profiles where id = p_user_id), '###'));
  get diagnostics v_drafts = row_count;

  -- the listings stay: they are the desk's custody record, not the person's
  with touched as (
    update public.items
       set reporter_id = null,
           contact_email = null,
           finder_email = null
     where reporter_id = p_user_id
    returning id
  ) select count(*) into v_items from touched;

  update public.item_private ip
     set finder_contact = null
   where ip.item_id in (select id from public.items where reporter_id is null and is_sample = false)
     and ip.finder_contact is not null
     and exists (select 1 from public.handover_records h where h.item_id = ip.item_id and h.staff_id = p_user_id);

  delete from public.saved_items where user_id = p_user_id;
  delete from public.saved_searches where user_id = p_user_id;
  delete from public.notifications where user_id = p_user_id;
  delete from public.conversation_reads where user_id = p_user_id;
  delete from public.email_outbox where recipient_user_id = p_user_id;
  update public.abuse_reports
     set reporter_email = null,
         details = case when reason = 'account_deletion' then details else 'Erased at the request of the reporter.' end
   where reporter_id = p_user_id;
  delete from public.user_roles where user_id = p_user_id;

  update public.profiles
     set full_name = null,
         phone = null,
         marketing_opt_in = false,
         alerts_opt_in = false,
         email = concat('erased+', left(p_user_id::text, 8), '@erased.invalid')
   where id = p_user_id;

  insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail, severity)
  values (auth.uid(), 'user_data_erased', 'user', p_user_id,
    jsonb_build_object('claims', v_claims, 'messages', v_messages, 'items', v_items,
      'photos', v_paths, 'drafts', v_drafts), 'alert');

  return jsonb_build_object('ok', true, 'claims', v_claims, 'messages', v_messages,
    'items', v_items, 'photosQueued', v_paths, 'drafts', v_drafts,
    'note', 'The auth.users row still holds the address; delete it from the dashboard or the admin API.');
end;
$$;

revoke all on function public.admin_erase_user_data(uuid) from public, anon;
grant execute on function public.admin_erase_user_data(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- 2. saved items
-- a saved listing that has since expired or been quarantined must drop out
create or replace function public.my_saved_items()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(public.to_public_item(i, z.name, z.code) || jsonb_build_object('savedAt', s.created_at))
    from public.saved_items s
    join public.items i on i.id = s.item_id
    left join public.campus_zones z on z.id = i.zone_id
    where s.user_id = v_uid
      and i.status in ('available', 'claimed', 'recovered')
    order by s.created_at desc
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- 3. desk detail
create or replace function public.staff_item_detail(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_item public.items;
  v_zone text;
  v_zone_code text;
  v_priv public.item_private;
  v_claims jsonb;
  v_history jsonb;
begin
  if not public.is_staff() then return null; end if;

  select * into v_item from public.items where upper(ref_code) = upper(p_ref);
  if v_item.id is null then return null; end if;

  select z.name, z.code into v_zone, v_zone_code
    from public.campus_zones z where z.id = v_item.zone_id;
  select * into v_priv from public.item_private where item_id = v_item.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'ref', c.ref_code, 'status', c.status, 'createdAt', c.created_at,
      'answerMatched', c.answer_matched, 'proof', c.proof,
      'reason', c.decision_reason, 'claimantId', c.claimant_id
    ) order by c.created_at desc), '[]'::jsonb) into v_claims
  from public.claims c where c.item_id = v_item.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'at', h.created_at, 'action', h.action, 'detail', h.detail, 'severity', h.severity
    ) order by h.created_at desc), '[]'::jsonb) into v_history
  from public.audit_logs h
  where h.resource_id = v_item.id and h.resource_type = 'item';

  return jsonb_build_object(
    'item', public.to_public_item(v_item, v_zone, v_zone_code)
      || jsonb_build_object(
        'expiresAt', v_item.expires_at,
        'reporterKind', v_item.reporter_kind,
        'disposition', v_item.disposition,
        'disposedAt', v_item.disposed_at,
        'dispositionNote', v_item.disposition_note
      ),
    'private', jsonb_build_object(
      'answerHash', v_priv.answer_hash, 'notes', v_priv.private_notes,
      'serial', v_priv.serial_number, 'bin', v_priv.bin_code,
      'finderContact', v_priv.finder_contact
    ),
    'claims', v_claims,
    'history', v_history,
    'contactEmail', v_item.contact_email
  );
end;
$$;

-- ---------------------------------------------------------------- 4. reports
create or replace function public.admin_open_reports()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'reason', r.reason, 'details', r.details, 'status', r.status,
      'createdAt', r.created_at, 'itemRef', i.ref_code, 'itemTitle', i.title,
      'reporterId', r.reporter_id, 'reporterEmail', r.reporter_email
    ) order by r.created_at desc)
    from public.abuse_reports r
    left join public.items i on i.id = r.item_id
    where r.status = 'open'
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- 5. housekeeping
-- queue the photos before the rows go, so nothing is orphaned in the bucket
create or replace function public.housekeeping() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_expired int; v_purged int; v_notifs int; v_audit int; v_reports int;
  v_paths jsonb; v_outbox int; v_searches int; v_queued int := 0;
begin
  with upd as (
    update public.items i set status = 'expired'
    where i.status in ('available', 'claimed')
      and i.expires_at < now()
      and not exists (select 1 from public.claims c where c.item_id = i.id and c.status = 'approved')
    returning i.id
  ) select count(*) into v_expired from upd;

  with doomed as (
    select im.storage_path
    from public.item_images im
    join public.items i on i.id = im.item_id
    where i.status = 'expired' and i.expires_at < now() - interval '30 days'
  ), queued as (
    insert into public.storage_deletion_queue (storage_path)
    select storage_path from doomed
    on conflict (storage_path) do nothing
    returning storage_path
  ) select coalesce(jsonb_agg(storage_path), '[]'::jsonb), count(*) into v_paths, v_queued from queued;

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
  delete from public.auth_events where created_at < now() - interval '365 days';
  delete from public.claim_drafts where expires_at < now();

  with d as (delete from public.email_outbox where status in ('sent', 'failed') and created_at < now() - interval '30 days' returning id)
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
    'expired', v_expired, 'purged', v_purged, 'photosQueued', v_queued,
    'outboxDeleted', v_outbox, 'savedSearches', v_searches));

  return jsonb_build_object(
    'expired', v_expired, 'purged', v_purged, 'photoPaths', v_paths, 'photosQueued', v_queued,
    'notificationsDeleted', v_notifs, 'auditDeleted', v_audit,
    'reportsDeleted', v_reports, 'outboxDeleted', v_outbox, 'savedSearches', v_searches
  );
end;
$$;

revoke all on function public.housekeeping() from public, anon, authenticated;
grant execute on function public.housekeeping() to service_role;

notify pgrst, 'reload schema';
