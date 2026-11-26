-- L&F :: 0012 saved items and saved searches
--
-- A lost report is a standing question. This lets someone keep watching a
-- question — bookmark a listing, or save the filter they keep retyping — and
-- get one quiet notification when something new matches, instead of polling
-- the board.

create table public.saved_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 2 and 60),
  query_text text check (char_length(query_text) <= 120),
  item_type public.item_type,
  category text,
  zone_code text,
  active boolean not null default true,
  last_notified_at timestamptz,
  created_at timestamptz not null default now()
);

create index saved_searches_user_idx on public.saved_searches (user_id, created_at desc);

alter table public.saved_items enable row level security;
alter table public.saved_searches enable row level security;

create policy saved_items_own on public.saved_items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy saved_searches_own on public.saved_searches for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, delete on public.saved_items to authenticated;
grant select, insert, update, delete on public.saved_searches to authenticated;

-- ---------------------------------------------------------------- items
create or replace function public.toggle_saved_item(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_item public.items;
  v_exists boolean;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); end if;

  select * into v_item from public.items
   where upper(ref_code) = upper(p_ref) and status in ('available', 'claimed', 'recovered');
  if v_item.id is null then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;

  select exists(select 1 from public.saved_items where user_id = v_uid and item_id = v_item.id)
    into v_exists;

  if v_exists then
    delete from public.saved_items where user_id = v_uid and item_id = v_item.id;
    return jsonb_build_object('ok', true, 'saved', false);
  end if;

  if (select count(*) from public.saved_items where user_id = v_uid) >= 200 then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;

  insert into public.saved_items (user_id, item_id) values (v_uid, v_item.id)
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'saved', true);
end;
$$;

create or replace function public.is_item_saved(p_ref text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.saved_items s
    join public.items i on i.id = s.item_id
    where s.user_id = auth.uid() and upper(i.ref_code) = upper(p_ref)
  );
$$;

create or replace function public.my_saved_items()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(public.to_public_item(i, z.name, z.code) order by s.created_at desc)
    from public.saved_items s
    join public.items i on i.id = s.item_id
    left join public.campus_zones z on z.id = i.zone_id
    where s.user_id = v_uid
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- searches
create or replace function public.save_search(
  p_label text,
  p_query text default null,
  p_type text default null,
  p_category text default null,
  p_zone text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); end if;
  if not public.rate_limit('search_save:' || v_uid::text, 20, interval '1 hour') then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;
  if char_length(btrim(coalesce(p_label, ''))) < 2 then
    return jsonb_build_object('ok', false, 'error', 'EMPTY');
  end if;

  insert into public.saved_searches (user_id, label, query_text, item_type, category, zone_code)
  values (
    v_uid, left(btrim(p_label), 60), nullif(btrim(coalesce(p_query, '')), ''),
    case when p_type in ('lost', 'found') then p_type::public.item_type else null end,
    nullif(btrim(coalesce(p_category, '')), ''),
    nullif(btrim(coalesce(p_zone, '')), '')
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.my_saved_searches()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'label', s.label, 'query', s.query_text, 'type', s.item_type,
    'category', s.category, 'zone', s.zone_code, 'active', s.active,
    'lastNotifiedAt', s.last_notified_at, 'createdAt', s.created_at
  ) order by s.created_at desc), '[]'::jsonb)
  from public.saved_searches s where s.user_id = auth.uid();
$$;

create or replace function public.delete_saved_search(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); end if;
  delete from public.saved_searches where id = p_id and user_id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- the job
create or replace function public.run_saved_searches()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_sent int := 0;
begin
  with fresh as (
    select s.id as search_id, s.user_id, s.label,
           count(*) as hits,
           min(i.ref_code) as sample_ref
    from public.saved_searches s
    join public.items i
      on i.status = 'available'
     and i.is_sample = false
     and i.published_at > coalesce(s.last_notified_at, s.created_at)
     and (s.item_type is null or i.type = s.item_type)
     and (s.category is null or i.category = s.category)
     and (s.zone_code is null or i.zone_id = (select id from public.campus_zones where code = s.zone_code))
     and (
       s.query_text is null
       or i.search_tsv @@ websearch_to_tsquery('english', s.query_text)
       or i.title ilike '%' || s.query_text || '%'
     )
    where s.active
    group by s.id, s.user_id, s.label
  ), notified as (
    insert into public.notifications (user_id, kind, title, body, link)
    select f.user_id, 'match', 'New matches for a saved search',
      f.hits || ' new listing' || case when f.hits = 1 then '' else 's' end ||
      ' match "' || f.label || '". Start with ' || f.sample_ref || '.',
      '/browse'
    from fresh f
    returning 1
  )
  select count(*) into v_sent from notified;

  update public.saved_searches s
     set last_notified_at = now()
   where s.active
     and exists (
       select 1 from public.items i
        where i.status = 'available'
          and i.is_sample = false
          and i.published_at > coalesce(s.last_notified_at, s.created_at)
     );

  return v_sent;
end;
$$;

-- fold it into the nightly job
create or replace function public.housekeeping() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_expired int; v_purged int; v_notifs int; v_audit int; v_reports int;
  v_paths jsonb; v_outbox int; v_searches int;
begin
  with upd as (
    update public.items set status = 'expired'
    where status in ('available', 'claimed') and expires_at < now()
    returning id
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

revoke all on function public.run_saved_searches() from public, anon, authenticated;
grant execute on function public.run_saved_searches() to service_role;

revoke all on function public.toggle_saved_item(text) from public, anon;
revoke all on function public.is_item_saved(text) from public, anon;
revoke all on function public.my_saved_items() from public, anon;
revoke all on function public.save_search(text, text, text, text, text) from public, anon;
revoke all on function public.my_saved_searches() from public, anon;
revoke all on function public.delete_saved_search(uuid) from public, anon;

grant execute on function public.toggle_saved_item(text), public.is_item_saved(text),
  public.my_saved_items(), public.save_search(text, text, text, text, text),
  public.my_saved_searches(), public.delete_saved_search(uuid) to authenticated;

notify pgrst, 'reload schema';
