-- L&F :: 0013 category-tiered retention and the disposal queue
--
-- One global 90-day window was wrong in both directions: a sandwich should not
-- sit in a bin for three months, and a laptop charger should not be thrown out
-- after a month. The window now comes from the category, and the desk gets a
-- queue with an auditable disposition for everything that reaches the end.

create table public.retention_policies (
  category text primary key,
  retention_days int not null check (retention_days between 1 and 365),
  requires_photo_id boolean not null default false,
  auto_hide_photos boolean not null default false,
  notes text
);

insert into public.retention_policies (category, retention_days, requires_photo_id, auto_hide_photos, notes) values
  ('electronics', 90, true,  false, 'High value; check photo ID at handover.'),
  ('keys',        90, true,  false, 'Keys open doors; check photo ID at handover.'),
  ('bags',        60, false, false, null),
  ('documents',   60, false, true,  'Photo withheld by default; collect at the desk.'),
  ('accessories', 60, false, false, null),
  ('books',       60, false, false, null),
  ('other',       60, false, false, null),
  ('clothing',    30, false, false, 'Short window: donated if unclaimed.'),
  ('sports',      30, false, false, 'Short window: donated if unclaimed.')
on conflict (category) do nothing;

alter table public.items
  add column if not exists disposition text
    check (disposition in ('donated', 'disposed', 'returned_to_issuer', 'transferred_to_security')),
  add column if not exists disposed_at timestamptz,
  add column if not exists disposition_note text;

alter table public.retention_policies enable row level security;
create policy retention_policies_read on public.retention_policies for select to anon, authenticated using (true);
create policy retention_policies_admin on public.retention_policies for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select on public.retention_policies to anon, authenticated;

create or replace function public.create_item(
  p_type text,
  p_category text,
  p_title text,
  p_description text,
  p_zone_code text default null,
  p_spot text default null,
  p_event_date date default current_date,
  p_custody text default null,
  p_question text default null,
  p_answer text default null,
  p_sensitive boolean default false,
  p_contact_email text default null,
  p_finder_email text default null,
  p_reporter_kind text default 'member'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_item public.items;
  v_zone uuid;
  v_status public.item_status := 'available';
  v_text text;
  v_id_hit boolean := false;
  v_id_terms text[] := array[
    'aadhaar', 'passport', 'pan card', 'driving licence', 'driving license',
    'voter id', 'id card', 'identity card', 'atm card', 'debit card', 'credit card'
  ];
  v_term text;
  v_days int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;
  if not public.rate_limit('create_item:' || v_uid::text, 12, interval '1 hour') then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;
  if p_type not in ('lost', 'found') then
    return jsonb_build_object('ok', false, 'error', 'BAD_TYPE');
  end if;
  if p_title is null or char_length(btrim(p_title)) < 3 then
    return jsonb_build_object('ok', false, 'error', 'TITLE_TOO_SHORT');
  end if;
  if p_description is null or char_length(btrim(p_description)) < 10 then
    return jsonb_build_object('ok', false, 'error', 'DESCRIPTION_TOO_SHORT');
  end if;
  if p_event_date is null or p_event_date > current_date then
    return jsonb_build_object('ok', false, 'error', 'DATE_IN_FUTURE');
  end if;
  if p_event_date < current_date - 365 then
    return jsonb_build_object('ok', false, 'error', 'DATE_TOO_OLD');
  end if;

  v_text := lower(coalesce(p_title, '') || ' ' || coalesce(p_description, ''));
  foreach v_term in array v_id_terms loop
    if position(v_term in v_text) > 0 then v_id_hit := true; end if;
  end loop;

  if p_type = 'found' and v_id_hit then
    v_status := 'quarantined';
  end if;

  select id into v_zone from public.campus_zones where code = p_zone_code and is_active;

  -- the window comes from the category, not from one global constant
  select coalesce(r.retention_days, 90) into v_days
    from (select 1) one
    left join public.retention_policies r on r.category = btrim(p_category);
  v_days := coalesce(v_days, 90);

  insert into public.items (
    type, status, category, title, public_description, zone_id, spot, event_date,
    custody_label, verification_question, sensitive_hidden_photo, reporter_id,
    reporter_kind, contact_email, finder_email, published_at, expires_at
  ) values (
    p_type::public.item_type, v_status, btrim(p_category), btrim(p_title), btrim(p_description),
    v_zone, nullif(btrim(coalesce(p_spot, '')), ''), p_event_date,
    nullif(btrim(coalesce(p_custody, '')), ''),
    nullif(btrim(coalesce(p_question, '')), ''),
    coalesce(p_sensitive, false), v_uid,
    case when p_reporter_kind in ('member', 'staff', 'owner') then p_reporter_kind else 'member' end,
    nullif(btrim(coalesce(p_contact_email, '')), ''),
    nullif(btrim(coalesce(p_finder_email, '')), ''),
    case when v_status = 'available' then now() else null end,
    now() + (v_days || ' days')::interval
  ) returning * into v_item;

  insert into public.item_private (item_id, answer_hash, finder_contact)
  values (
    v_item.id,
    case when p_answer is null or btrim(p_answer) = '' then null
         else encode(digest(lower(btrim(p_answer)), 'sha256'), 'hex') end,
    nullif(btrim(coalesce(p_finder_email, '')), '')
  );

  if v_status = 'available' then
    perform public.refresh_matches(v_item.id);
  end if;

  insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail)
  values (v_uid, 'item_created', 'item', v_item.id,
    jsonb_build_object('type', p_type, 'status', v_status, 'ref', v_item.ref_code));

  insert into public.notifications (user_id, kind, title, body, link)
  values (v_uid, 'system',
    case when v_status = 'quarantined' then 'Your report went to the desk' else 'Your report is live' end,
    case when v_status = 'quarantined'
      then 'An ID or card document can only be handed in at the desk, so it is not published. Reference ' || v_item.ref_code || '.'
      else 'Reference ' || v_item.ref_code || '. You can track it from your dashboard.' end,
    '/items/' || v_item.ref_code);

  return jsonb_build_object('ok', true, 'ref', v_item.ref_code, 'status', v_status);
end;
$$;

-- ---------------------------------------------------------------- disposal
create or replace function public.disposal_queue()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then return null; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'ref', i.ref_code,
      'title', i.title,
      'category', i.category,
      'status', i.status,
      'zone', z.name,
      'eventDate', i.event_date,
      'expiresAt', i.expires_at,
      'daysLeft', ceil(extract(epoch from (i.expires_at - now())) / 86400)::int,
      'disposition', i.disposition,
      'suggested', case i.category
        when 'electronics' then 'returned_to_issuer'
        when 'documents' then 'returned_to_issuer'
        else 'donated' end
    ) order by i.expires_at)
    from public.items i
    left join public.campus_zones z on z.id = i.zone_id
    where i.status in ('expired', 'available')
      and i.is_sample = false
      and i.disposition is null
      and i.expires_at < now() + interval '7 days'
  ), '[]'::jsonb);
end;
$$;

create or replace function public.dispose_item(
  p_ref text,
  p_disposition text,
  p_note text default null
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

revoke all on function public.disposal_queue() from public, anon;
revoke all on function public.dispose_item(text, text, text) from public, anon;
grant execute on function public.disposal_queue(), public.dispose_item(text, text, text) to authenticated;

notify pgrst, 'reload schema';
