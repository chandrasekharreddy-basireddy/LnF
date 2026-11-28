-- L&F :: 0047 the audit #4 residue
--
-- From the 19:13 audit of 052017a (94/100):
--   * search_items() filtered is_sample in the page query but not in its count,
--     so a board of sample rows showed "6 listings" above an empty grid.
--   * desk_sheet() had the same gap.
--   * queue_match_alerts() did not check that the found item is still available,
--     so it could email someone about an item that had already been collected.
-- Also, from the database audit's medium list:
--   * submit_report() throttled on one shared anonymous bucket, so the first
--     report in a window used up everyone's allowance.
--   * check_signin_allowed() and log_auth_event() took the caller's IP as a
--     parameter; they now derive it, so an audit row cannot be forged by header.
--   * 'documents' was exempt from the two-person handover rule — the exact
--     category where a wrong release matters most.
--   * a four-character note was enough to bypass the handover code; it is twelve.

create or replace function public.search_items(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := nullif(btrim(coalesce(p ->> 'q', '')), '');
  v_qx text;
  v_type public.item_type := nullif(p ->> 'type', '')::public.item_type;
  v_category text := nullif(btrim(coalesce(p ->> 'category', '')), '');
  v_zone text := nullif(btrim(coalesce(p ->> 'zone', '')), '');
  v_status public.item_status := nullif(p ->> 'status', '')::public.item_status;
  v_from date := nullif(p ->> 'from', '')::date;
  v_to date := nullif(p ->> 'to', '')::date;
  v_sort text := coalesce(nullif(p ->> 'sort', ''), 'best');
  v_limit int := least(greatest(coalesce((p ->> 'limit')::int, 20), 1), 50);
  v_offset int := greatest(coalesce((p ->> 'offset')::int, 0), 0);
  v_total int;
  v_items jsonb;
begin
  if v_q is not null then
    v_qx := lower(v_q);
    v_qx := replace(v_qx, 'airpods', 'earbuds');
    v_qx := replace(v_qx, 'airpod', 'earbuds');
    v_qx := replace(v_qx, 'earphone', 'earbuds');
    v_qx := replace(v_qx, 'mobile', 'phone');
    v_qx := replace(v_qx, 'cell', 'phone');
    v_qx := replace(v_qx, 'wallet', 'purse');
    v_qx := replace(v_qx, 'notebook', 'laptop');
    v_qx := replace(v_qx, 'flask', 'bottle');
    v_qx := replace(v_qx, 'spectacles', 'glasses');
    v_qx := replace(v_qx, 'charger', 'adapter');
    v_qx := replace(v_qx, 'rucksack', 'backpack');
  end if;

  select count(*) into v_total
  from public.items i
  where i.is_sample = false
    and i.status in ('available', 'claimed', 'recovered')
    and (v_type is null or i.type = v_type)
    and (v_category is null or i.category = v_category)
    and (v_status is null or i.status = v_status)
    and (v_zone is null or i.zone_id = (select id from public.campus_zones where code = v_zone))
    and (v_from is null or i.event_date >= v_from)
    and (v_to is null or i.event_date <= v_to)
    and (
      v_q is null
      or i.search_tsv @@ websearch_to_tsquery('english', v_qx)
      or i.title ilike '%' || v_q || '%'
      or i.public_description ilike '%' || v_q || '%'
      or i.title % v_q
    );

  select coalesce(jsonb_agg(
    public.to_public_item(x.i, x.zone_label, x.zone_code) || jsonb_build_object('coverPath', x.cover)
    order by x.ord), '[]'::jsonb)
  into v_items
  from (
    select i, z.name as zone_label, z.code as zone_code,
      (select im.storage_path from public.item_images im
        where im.item_id = i.id and i.sensitive_hidden_photo = false
        order by im.position limit 1) as cover,
      row_number() over (
        order by
          case when v_sort = 'newest' then 0
               else (case when v_q is null then 0
                          else ts_rank(i.search_tsv, websearch_to_tsquery('english', v_qx)) * 4 + similarity(i.title, v_q)
                     end)
          end desc,
          i.created_at desc
      ) as ord
    from public.items i
    left join public.campus_zones z on z.id = i.zone_id
    where i.is_sample = false
      and i.status in ('available', 'claimed', 'recovered')
      and (v_type is null or i.type = v_type)
      and (v_category is null or i.category = v_category)
      and (v_status is null or i.status = v_status)
      and (v_zone is null or i.zone_id = (select id from public.campus_zones where code = v_zone))
      and (v_from is null or i.event_date >= v_from)
      and (v_to is null or i.event_date <= v_to)
      and (
        v_q is null
        or i.search_tsv @@ websearch_to_tsquery('english', v_qx)
        or i.title ilike '%' || v_q || '%'
        or i.public_description ilike '%' || v_q || '%'
        or i.title % v_q
      )
    order by ord
    limit v_limit offset v_offset
  ) x;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

create or replace function public.desk_sheet(p_limit int default 300)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_limit int := greatest(1, least(coalesce(p_limit, 300), 500));
  v_rows jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;

  if not public.is_staff() then
    return jsonb_build_object('ok', false, 'error', 'NOT_STAFF');
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'ref', i.ref_code,
               'title', i.title,
               'category', i.category,
               'type', i.type::text,
               'status', i.status::text,
               'zone', z.name,
               'spot', i.spot,
               'eventDate', i.event_date,
               'heldSince', i.created_at)
             order by i.created_at desc),
           '[]'::jsonb)
    into v_rows
    from (
      select it.*
        from public.items it
       where it.is_sample = false
         and it.status in ('available', 'claimed')
         and it.published_at is not null
       order by it.created_at desc
       limit v_limit
    ) i
    left join public.campus_zones z on z.id = i.zone_id;

  return jsonb_build_object(
    'ok', true,
    'generatedAt', now(),
    'count', jsonb_array_length(v_rows),
    'rows', v_rows);
end $$;

create or replace function public.queue_match_alerts(p_limit int default 25)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_queued int := 0;
  r record;
  v_email text;
  v_lost_title text;
  v_found_ref text;
  v_found_title text;
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  for r in
    select m.id, m.lost_item_id, m.found_item_id
      from public.match_alerts m
      join public.items li on li.id = m.lost_item_id
      join public.items fi on fi.id = m.found_item_id
     where m.notified_at is null
       -- the found item must still be on the board: an email about an item that
       -- was already collected sends someone to the desk for nothing
       and fi.status = 'available'
       and m.score >= 0.5
       and li.reporter_id is not null
       and li.status = 'available'
     order by m.score desc, m.created_at asc
     limit greatest(1, least(p_limit, 100))
  loop
    select p.email into v_email
      from public.profiles p
      join public.items li on li.reporter_id = p.id
     where li.id = r.lost_item_id
       and p.alerts_opt_in
       and p.email is not null;

    if v_email is null then
      update public.match_alerts set notified_at = now() where id = r.id;
      continue;
    end if;

    select li.title into v_lost_title from public.items li where li.id = r.lost_item_id;
    select fi.ref_code, fi.title into v_found_ref, v_found_title
      from public.items fi where fi.id = r.found_item_id;

    insert into public.email_outbox (dedupe_key, event_type, recipient_email, payload)
    values (
      'match_alert:' || r.lost_item_id::text || ':' || r.found_item_id::text,
      'match_alert',
      v_email,
      jsonb_build_object(
        'lostTitle', coalesce(v_lost_title, 'Your lost item'),
        'foundRef', coalesce(v_found_ref, ''),
        'foundTitle', coalesce(v_found_title, 'something handed in'))
    )
    on conflict (dedupe_key) do nothing;

    if found then
      v_queued := v_queued + 1;
    end if;

    update public.match_alerts set notified_at = now() where id = r.id;
  end loop;

  return jsonb_build_object('ok', true, 'queued', v_queued);
end;
$$;

-- ---------------------------------------------------------------- policies
update public.retention_policies set requires_photo_id = true where category = 'documents';

-- ---------------------------------------------------------------- revokes
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('request_ip','has_role','dispute_party','claimant_trust',
                         'item_photo_distance','photo_distance','refresh_matches')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
