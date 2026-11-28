-- L&F :: 0044 sample listings were reachable by search
--
-- board_stats() filtered is_sample and search_items() did not, so the six seeded
-- demo listings were claimable from /browse and the home page while the hero
-- counter excluded them. Caught by the launch-readiness audit before the sample
-- rows were purged; the predicate matters for any fresh environment, where the
-- seed runs again.
--
-- The seed itself stays: it is useful for a demo install, and it is now
-- invisible to the public board until someone flips the flag.

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
  where i.status in ('available', 'claimed', 'recovered')
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

revoke all on function public.search_items(jsonb) from public, anon;
grant execute on function public.search_items(jsonb) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
