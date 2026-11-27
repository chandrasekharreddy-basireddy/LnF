-- L&F :: 0021 the backlog arrives in one paste
--
-- A board launches with a cardboard box, not with six listings. This lets the
-- desk import a spreadsheet of everything already sitting behind the counter,
-- with the same validation and the same ID-document quarantine as a normal
-- intake — just 200 rows at a time.

create or replace function public.bulk_import_items(p_rows jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_row jsonb;
  v_i int := 0;
  v_ok int := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_refs jsonb := '[]'::jsonb;
  v_item public.items;
  v_zone uuid;
  v_days int;
  v_reason text;
  v_text text;
  v_id_hit boolean;
  v_term text;
  v_terms text[] := array[
    'aadhaar', 'passport', 'pan card', 'driving licence', 'driving license',
    'voter id', 'id card', 'identity card', 'atm card', 'debit card', 'credit card'
  ];
  v_categories text[] := array[
    'electronics', 'bags', 'documents', 'accessories', 'clothing', 'keys', 'books', 'sports', 'other'
  ];
begin
  if not public.is_staff() then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'BAD_INPUT');
  end if;
  if jsonb_array_length(p_rows) > 500 then
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY', 'limit', 500);
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_reason := null;
    v_id_hit := false;

    if char_length(btrim(coalesce(v_row ->> 'title', ''))) < 3 then
      v_reason := 'title too short';
    elsif char_length(btrim(coalesce(v_row ->> 'description', ''))) < 10 then
      v_reason := 'description too short';
    elsif char_length(btrim(coalesce(v_row ->> 'question', ''))) < 8 then
      v_reason := 'question too short';
    elsif char_length(btrim(coalesce(v_row ->> 'answer', ''))) < 1 then
      v_reason := 'answer missing';
    elsif coalesce(v_row ->> 'category', 'other') <> all (v_categories) then
      v_reason := 'unknown category';
    elsif (v_row ->> 'event_date') is null
       or (v_row ->> 'event_date')::date > current_date then
      v_reason := 'bad or future date';
    end if;

    if v_reason is null then
      v_text := lower(coalesce(v_row ->> 'title', '') || ' ' || coalesce(v_row ->> 'description', ''));
      foreach v_term in array v_terms loop
        if position(v_term in v_text) > 0 then v_id_hit := true; end if;
      end loop;

      select id into v_zone from public.campus_zones
       where code = nullif(btrim(coalesce(v_row ->> 'zone_code', '')), '') and is_active;

      select coalesce(retention_days, 90) into v_days from public.retention_policies
       where category = coalesce(v_row ->> 'category', 'other');
      v_days := coalesce(v_days, 90);

      insert into public.items (
        type, status, category, title, public_description, zone_id, spot, event_date,
        custody_label, verification_question, sensitive_hidden_photo, reporter_id,
        reporter_kind, published_at, expires_at
      ) values (
        'found',
        case when v_id_hit then 'quarantined'::public.item_status
             else 'available'::public.item_status end,
        coalesce(v_row ->> 'category', 'other'),
        btrim(v_row ->> 'title'),
        btrim(v_row ->> 'description'),
        v_zone,
        nullif(btrim(coalesce(v_row ->> 'spot', '')), ''),
        (v_row ->> 'event_date')::date,
        coalesce(nullif(btrim(coalesce(v_row ->> 'custody', '')), ''), 'Main Gate & Security Desk'),
        btrim(v_row ->> 'question'),
        true,
        null,
        'staff',
        case when v_id_hit then null else now() end,
        now() + (v_days || ' days')::interval
      ) returning * into v_item;

      insert into public.item_private (item_id, answer_hash, bin_code)
      values (
        v_item.id,
        encode(digest(lower(btrim(v_row ->> 'answer')), 'sha256'), 'hex'),
        nullif(btrim(coalesce(v_row ->> 'bin', '')), '')
      );

      v_ok := v_ok + 1;
      v_refs := v_refs || jsonb_build_array(v_item.ref_code);
    else
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('row', v_i, 'title', left(coalesce(v_row ->> 'title', ''), 60), 'reason', v_reason));
    end if;
  end loop;

  insert into public.audit_logs (actor_id, action, resource_type, detail, severity)
  values (v_uid, 'bulk_import', 'item',
    jsonb_build_object('imported', v_ok, 'skipped', jsonb_array_length(v_skipped),
      'note', left(coalesce(p_note, ''), 200)), 'info');

  perform public.event_log('bulk_import', jsonb_build_object('imported', v_ok));

  return jsonb_build_object('ok', true, 'imported', v_ok,
    'skipped', v_skipped, 'refs', v_refs);
end;
$$;

revoke all on function public.bulk_import_items(jsonb, text) from public, anon;
grant execute on function public.bulk_import_items(jsonb, text) to authenticated, service_role;

notify pgrst, 'reload schema';
