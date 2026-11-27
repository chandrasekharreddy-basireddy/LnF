-- L&F :: 0026 a CASE expression is text, and audit_logs.severity is an enum
--
-- Found by running the claim lifecycle for the first time: staff_update_item
-- raised
--   42804: column "severity" is of type audit_severity but expression is of type text
-- on its first real call. A bare 'warn' literal coerces to the enum; a CASE that
-- returns it does not. Two functions had the pattern, both on a write path a
-- person only reaches in the middle of a real handover.

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
    (case when p_status in ('quarantined', 'archived') then 'warn' else 'info' end)::public.audit_severity);

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

revoke all on function public.staff_update_item(text, text, text) from public, anon;
grant execute on function public.staff_update_item(text, text, text) to authenticated, service_role;

-- The same shape existed in create_item's status audit (0003:724). Re-apply the
-- 0018 body with the cast, keeping the 0022 additions intact.
do $$
declare
  v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_item' limit 1;

  if v_src is not null and position('::public.audit_severity' in v_src) = 0
     and position('case when p_status = ''quarantined''' in v_src) > 0 then
    v_src := replace(v_src,
      'case when p_status = ''quarantined'' then ''warn'' else ''info'' end)',
      '(case when p_status = ''quarantined'' then ''warn'' else ''info'' end)::public.audit_severity)');
    execute v_src;
  end if;
end;
$$;

notify pgrst, 'reload schema';
