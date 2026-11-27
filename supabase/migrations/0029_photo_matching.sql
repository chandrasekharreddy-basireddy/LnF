-- L&F :: 0029 photo-similarity matching
--
-- Text alone misses the commonest real case: the owner describes "earphones lost
-- near the shuttle stop" and the finder writes "black wired earphones, white tip".
-- The photos of those two things are the same photo of the same object, and a
-- 64-bit difference hash can say so without storing the image again, without a
-- model, and without an unexplainable score.
--
-- What this migration adds:
--   1. item_images.phash          — a 64-bit dHash of the normalised photo
--   2. photo_distance()           — Hamming distance between two hashes
--   3. item_photo_distance()      — best distance between two listings' photos
--   4. set_item_photo_hash()      — the only way a hash is ever written
--   5. refresh_matches()          — photo term folded into the score, both
--                                   directions, and the owner is told either way
--   6. recompute_item_matches()   — a listing can be re-scored after its photos land
--   7. match_queue()              — what the desk sees, with the reason for each pair
--
-- Authorization: hashes are written by one SECURITY DEFINER function that checks
-- the uploader, direct INSERT of the column is not granted to any client, and the
-- queue returns null unless the caller is staff. Nothing here trusts the page.

-- ---------------------------------------------------------------- storage
alter table public.item_images add column if not exists phash bigint;

comment on column public.item_images.phash is
  '64-bit difference hash of the normalised photo, as a signed bigint. Written only by set_item_photo_hash().';

alter table public.match_alerts
  add column if not exists title_score numeric(4, 3),
  add column if not exists photo_score numeric(4, 3),
  add column if not exists photo_distance int,
  add column if not exists updated_at timestamptz not null default now();

comment on column public.match_alerts.photo_distance is
  'Hamming distance between the two listings'' nearest photos, null when either has no hash.';

-- The insert path used to be table-wide, so a browser could post its own phash.
-- Column grants keep the app working and leave phash to the function below.
revoke insert on public.item_images from authenticated;
grant insert (item_id, storage_path, alt_text, width, height, position)
  on public.item_images to authenticated;
grant insert on public.item_images to service_role;

-- ---------------------------------------------------------------- distance
create or replace function public.photo_distance(p_a bigint, p_b bigint)
returns int language sql immutable as $$
  select bit_count((p_a # p_b)::bit(64))::int;
$$;

create or replace function public.item_photo_distance(p_a uuid, p_b uuid)
returns int language sql stable security definer set search_path = public as $$
  select min(public.photo_distance(x.phash, y.phash))::int
  from public.item_images x
  join public.item_images y on y.item_id = p_b
  where x.item_id = p_a
    and x.phash is not null
    and y.phash is not null;
$$;

revoke all on function public.photo_distance(bigint, bigint) from public, anon, authenticated;
revoke all on function public.item_photo_distance(uuid, uuid) from public, anon, authenticated;
grant execute on function public.photo_distance(bigint, bigint) to service_role;
grant execute on function public.item_photo_distance(uuid, uuid) to service_role;

-- ---------------------------------------------------------------- hash write
-- The path is a bearer-ish value: the first segment is the uploader's uid, which
-- is exactly the rule the storage policy and the item_images policy already use.
create or replace function public.set_item_photo_hash(p_storage_path text, p_phash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_img public.item_images;
  v_item public.items;
  v_hash bigint;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'SIGN_IN_REQUIRED');
  end if;
  if p_storage_path is null or btrim(p_storage_path) = '' or length(p_storage_path) > 300 then
    return jsonb_build_object('ok', false, 'error', 'BAD_PATH');
  end if;
  -- a 64-bit pattern travels as text so no client ever rounds it through a float
  if p_phash is null or p_phash !~ '^-?[0-9]{1,20}$' then
    return jsonb_build_object('ok', false, 'error', 'BAD_HASH');
  end if;
  begin
    v_hash := p_phash::bigint;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'BAD_HASH');
  end;

  select * into v_img from public.item_images where storage_path = p_storage_path;
  if v_img.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  select * into v_item from public.items where id = v_img.item_id;
  if v_item.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  -- the caller must have uploaded this object, and must own the listing (or be staff)
  if split_part(p_storage_path, '/', 1) <> v_uid::text then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if v_item.reporter_id is distinct from v_uid and not public.is_staff() then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  update public.item_images set phash = v_hash where id = v_img.id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.set_item_photo_hash(text, text) from public, anon;
grant execute on function public.set_item_photo_hash(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------- matching
-- The score is the documented one, plus one photo term:
--
--   base  = 0.55·title similarity + 0.25·same category + 0.10·same zone
--         + up to 0.10 for two events inside 45 days
--   photo = max(0, 1 − hamming/24)        (24 bits apart reads as unrelated)
--   score = min(1, base + 0.35·photo)
--
-- A photo alone can carry a pair over the 0.35 line, which is the point: the
-- title is the part a person is worst at matching and a camera is best at.
create or replace function public.refresh_matches(p_item_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_item public.items;
  v_count int := 0;
  v_lost uuid;
  v_found uuid;
  v_found_title text;
  v_found_ref text;
  v_lost_reporter uuid;
  v_title_sim numeric;
  v_photo_d int;
  v_photo_sim numeric;
  v_base numeric;
  v_score numeric;
  v_new boolean;
  r record;
begin
  select * into v_item from public.items where id = p_item_id;
  if v_item.id is null then return 0; end if;
  if v_item.status not in ('available', 'claimed') then return 0; end if;

  -- one candidate list, whichever side was just created: the old version had two
  -- near-identical loops that disagreed (only one applied the date term), so the
  -- same pair scored differently depending on which listing was filed last.
  for r in
    select c.other_id, c.other_reporter, c.ref_code, c.title, c.category, c.zone_id, c.event_date
    from (
      select l.id as other_id, l.reporter_id as other_reporter, l.ref_code, l.title,
             l.category, l.zone_id, l.event_date
      from public.items l
      where v_item.type = 'found'
        and l.type = 'lost'
        and l.status in ('available', 'claimed')
        and l.id <> v_item.id
      union all
      select f.id, f.reporter_id, f.ref_code, f.title, f.category, f.zone_id, f.event_date
      from public.items f
      where v_item.type = 'lost'
        and f.type = 'found'
        and f.status = 'available'
        and f.id <> v_item.id
    ) c
    where abs(c.event_date - v_item.event_date) <= 45
      and (
        c.category = v_item.category
        or similarity(c.title, v_item.title) > 0.3
        or coalesce(public.item_photo_distance(c.other_id, v_item.id), 64) <= 12
      )
  loop
    if v_item.type = 'found' then
      v_lost := r.other_id;
      v_found := v_item.id;
      v_found_title := v_item.title;
      v_found_ref := v_item.ref_code;
      v_lost_reporter := r.other_reporter;
    else
      v_lost := v_item.id;
      v_found := r.other_id;
      v_found_title := r.title;
      v_found_ref := r.ref_code;
      v_lost_reporter := v_item.reporter_id;
    end if;

    v_title_sim := similarity(r.title, v_item.title)::numeric;
    v_photo_d := public.item_photo_distance(r.other_id, v_item.id);
    v_photo_sim := case
      when v_photo_d is null then 0
      else greatest(0, 1 - v_photo_d::numeric / 24)
    end;
    v_base := v_title_sim * 0.55
      + case when r.category = v_item.category then 0.25 else 0 end
      + case when r.zone_id is not null and r.zone_id = v_item.zone_id then 0.10 else 0 end
      + greatest(0, 0.10 - (abs(r.event_date - v_item.event_date)::numeric / 300));
    v_score := round(least(1, v_base + 0.35 * v_photo_sim), 3);

    continue when v_score < 0.35;

    insert into public.match_alerts (lost_item_id, found_item_id, score, title_score, photo_score, photo_distance)
    values (v_lost, v_found, v_score, round(v_title_sim, 3), round(v_photo_sim, 3), v_photo_d)
    on conflict (lost_item_id, found_item_id) do nothing;
    v_new := found;

    if v_new then
      v_count := v_count + 1;
      insert into public.notifications (user_id, kind, title, body, link)
      select v_lost_reporter, 'match',
        'A possible match for your lost item',
        'We found something that may be yours: ' || v_found_title || '.'
          || case when v_photo_d is not null and v_photo_d <= 12
                  then ' The photo looks very similar too.' else '' end
          || ' Check it and start a claim if it looks right.',
        '/items/' || v_found_ref
      where v_lost_reporter is not null
        and exists (select 1 from public.profiles p
                    where p.id = v_lost_reporter and p.alerts_opt_in);
    else
      -- an alert already existed; keep its numbers honest as photos arrive
      update public.match_alerts m
         set score = v_score,
             title_score = round(v_title_sim, 3),
             photo_score = round(v_photo_sim, 3),
             photo_distance = v_photo_d,
             updated_at = now()
       where m.lost_item_id = v_lost
         and m.found_item_id = v_found
         and (m.score is distinct from v_score or m.photo_distance is distinct from v_photo_d);
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.refresh_matches(uuid) from public, anon, authenticated;
grant execute on function public.refresh_matches(uuid) to service_role;

-- ---------------------------------------------------------------- recompute
-- create_item() scores a listing before its photos exist. This is the second
-- pass, called by the upload path once a hash is stored.
create or replace function public.recompute_item_matches(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_item public.items;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'SIGN_IN_REQUIRED');
  end if;

  select * into v_item from public.items where upper(ref_code) = upper(btrim(coalesce(p_ref, '')));
  if v_item.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if v_item.reporter_id is distinct from v_uid and not public.is_staff() then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  if not public.rate_limit('rematch:' || v_uid::text, 30, interval '1 hour') then
    return jsonb_build_object('ok', false, 'error', 'TOO_OFTEN');
  end if;

  return jsonb_build_object('ok', true, 'matched', public.refresh_matches(v_item.id));
end;
$$;

revoke all on function public.recompute_item_matches(text) from public, anon;
grant execute on function public.recompute_item_matches(text) to authenticated, service_role;

-- ---------------------------------------------------------------- desk queue
create or replace function public.match_queue(p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if not public.is_staff() then return null; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'lostRef', q.lost_ref,
      'lostTitle', q.lost_title,
      'lostCategory', q.lost_category,
      'foundRef', q.found_ref,
      'foundTitle', q.found_title,
      'foundCategory', q.found_category,
      'zone', q.zone,
      'score', q.score,
      'titleScore', q.title_score,
      'photoScore', q.photo_score,
      'photoDistance', q.photo_distance,
      'dayGap', q.day_gap,
      'notifiedAt', q.notified_at,
      'createdAt', q.created_at
    ) order by q.score desc, q.created_at desc)
    from (
      select l.ref_code as lost_ref, l.title as lost_title, l.category as lost_category,
             f.ref_code as found_ref, f.title as found_title, f.category as found_category,
             z.name as zone, m.score, m.title_score, m.photo_score, m.photo_distance,
             abs(l.event_date - f.event_date) as day_gap,
             m.notified_at, m.created_at
      from public.match_alerts m
      join public.items l on l.id = m.lost_item_id
      join public.items f on f.id = m.found_item_id
      left join public.campus_zones z on z.id = f.zone_id
      where l.status in ('available', 'claimed')
        and f.status in ('available', 'claimed')
        and l.is_sample = false
        and f.is_sample = false
      order by m.score desc, m.created_at desc
      limit v_limit
    ) q
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.match_queue(int) from public, anon;
grant execute on function public.match_queue(int) to authenticated, service_role;

notify pgrst, 'reload schema';
