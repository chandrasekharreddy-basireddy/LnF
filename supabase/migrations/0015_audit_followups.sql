-- L&F :: 0015 the remaining audit findings
--
-- 1. A staff status change could archive or expire an item that has an
--    approved claim waiting to be collected.
-- 2. dispose_item() could do the same, permanently.
-- 3. Sequences were usable by `authenticated`, so a signed-in user could burn
--    reference numbers with nextval().
-- 4. The sample seed in 0004 re-inserted rows if the file was ever re-run.

-- ---------------------------------------------------------------- 1 + 2
create or replace function public.staff_update_item(p_ref text, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_item public.items;
begin
  if not public.is_staff() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if p_status not in ('available', 'pending_moderation', 'quarantined', 'archived', 'expired') then
    return jsonb_build_object('ok', false, 'error', 'BAD_STATUS');
  end if;

  select * into v_item from public.items where upper(ref_code) = upper(p_ref);
  if v_item.id is null then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;

  -- An approved claim is a promise to a person who is coming to collect.
  if p_status in ('archived', 'expired', 'quarantined')
     and exists (select 1 from public.claims c where c.item_id = v_item.id and c.status = 'approved') then
    return jsonb_build_object('ok', false, 'error', 'HAS_APPROVED_CLAIM');
  end if;

  update public.items set status = p_status::public.item_status,
    published_at = case when p_status = 'available' then coalesce(published_at, now()) else published_at end
  where id = v_item.id;

  insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail, severity)
  values (v_uid, 'item_status_changed', 'item', v_item.id,
    jsonb_build_object('from', v_item.status, 'to', p_status, 'note', p_note),
    case when p_status in ('quarantined', 'archived') then 'warn' else 'info' end);

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

create or replace function public.dispose_item(
  p_ref text, p_disposition text, p_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_item public.items;
begin
  if not public.is_staff() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if p_disposition not in ('donated', 'disposed', 'returned_to_issuer', 'transferred_to_security') then
    return jsonb_build_object('ok', false, 'error', 'BAD_DISPOSITION');
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 4 then
    return jsonb_build_object('ok', false, 'error', 'NOTE_REQUIRED');
  end if;

  select * into v_item from public.items where upper(ref_code) = upper(p_ref);
  if v_item.id is null then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if v_item.status = 'recovered' then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_RETURNED');
  end if;
  if v_item.disposition is not null then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_DISPOSED');
  end if;
  if exists (select 1 from public.claims c where c.item_id = v_item.id and c.status = 'approved') then
    return jsonb_build_object('ok', false, 'error', 'HAS_APPROVED_CLAIM');
  end if;

  update public.items
     set disposition = p_disposition,
         disposed_at = now(),
         disposition_note = left(btrim(p_note), 300),
         status = 'archived'
   where id = v_item.id;

  insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail, severity)
  values (v_uid, 'item_disposed', 'item', v_item.id,
    jsonb_build_object('disposition', p_disposition, 'note', left(btrim(p_note), 300)), 'warn');

  perform public.event_log('item_disposed', jsonb_build_object('disposition', p_disposition));

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.staff_update_item(text, text, text) from public, anon;
revoke all on function public.dispose_item(text, text, text) from public, anon;
grant execute on function public.staff_update_item(text, text, text) to authenticated, service_role;
grant execute on function public.dispose_item(text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------- 3
revoke usage, select on all sequences in schema public from authenticated;

-- ---------------------------------------------------------------- 4
-- Guard the seed so re-running 0004 cannot duplicate the sample board.
do $$
begin
  delete from public.items a
   using public.items b
   where a.is_sample and b.is_sample
     and a.title = b.title
     and a.created_at > b.created_at;
exception
  when others then null;
end;
$$;

notify pgrst, 'reload schema';
