-- L&F :: 0003 functions (all authorization is enforced here or in RLS)

-- ---------------------------------------------------------------- projection
create or replace function public.to_public_item(i public.items, zname text, zcode text)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id', i.id,
    'ref', i.ref_code,
    'type', i.type,
    'status', i.status,
    'category', i.category,
    'title', i.title,
    'description', i.public_description,
    'zoneLabel', zname,
    'zoneCode', zcode,
    'spot', i.spot,
    'eventDate', i.event_date,
    'custodyLabel', i.custody_label,
    'verificationQuestion', i.verification_question,
    'sensitiveHiddenPhoto', i.sensitive_hidden_photo,
    'isSample', i.is_sample,
    'createdAt', i.created_at
  );
$$;

create or replace function public.event_log(p_name text, p_props jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.events (name, props) values (p_name, coalesce(p_props, '{}'::jsonb));
$$;

revoke all on function public.event_log(text, jsonb) from public, anon, authenticated;
grant execute on function public.event_log(text, jsonb) to service_role;

-- ---------------------------------------------------------------- search
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
    -- expand what people actually type onto what the board says
    v_qx := lower(v_q);
    v_qx := replace(v_qx, 'airpods', 'earbuds');
    v_qx := replace(v_qx, 'airpod', 'earbuds');
    v_qx := replace(v_qx, 'earphone', 'earbuds');
    v_qx := replace(v_qx, 'headphone', 'headphones');
    v_qx := replace(v_qx, 'mobile', 'phone');
    v_qx := replace(v_qx, 'cell', 'phone');
    v_qx := replace(v_qx, 'wallet', 'purse');
    v_qx := replace(v_qx, 'notebook', 'laptop');
    v_qx := replace(v_qx, 'flask', 'bottle');
    v_qx := replace(v_qx, 'spectacles', 'glasses');
    v_qx := replace(v_qx, 'charger', 'adapter');
    v_qx := replace(v_qx, 'rucksack', 'backpack');
    v_qx := replace(v_qx, 'umbrella', 'umbrella');
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

  select coalesce(jsonb_agg(public.to_public_item(x.i, x.zone_label, x.zone_code) order by x.ord), '[]'::jsonb)
  into v_items
  from (
    select i, z.name as zone_label, z.code as zone_code,
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
      )
    order by ord
    limit v_limit offset v_offset
  ) x;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

create or replace function public.get_public_item(p_ref text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'item', public.to_public_item(i, z.name, z.code),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'path', im.storage_path, 'alt', im.alt_text,
        'width', im.width, 'height', im.height
      ) order by im.position)
      from public.item_images im
      where im.item_id = i.id and i.sensitive_hidden_photo = false
    ), '[]'::jsonb)
  )
  from public.items i
  left join public.campus_zones z on z.id = i.zone_id
  where upper(i.ref_code) = upper(p_ref)
    and i.status in ('available', 'claimed', 'recovered', 'quarantined');
$$;

create or replace function public.board_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(s) from public.public_stats s;
$$;

-- ---------------------------------------------------------------- matching
create or replace function public.refresh_matches(p_item_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_item public.items;
  v_count int := 0;
  r record;
begin
  select * into v_item from public.items where id = p_item_id;
  if v_item.id is null then return 0; end if;

  if v_item.type = 'found' then
    for r in
      select l.id, l.reporter_id,
        round((
          similarity(l.title, v_item.title) * 0.55
          + (case when l.category = v_item.category then 0.25 else 0 end)
          + (case when l.zone_id = v_item.zone_id then 0.10 else 0 end)
          + greatest(0, 0.10 - (abs(l.event_date - v_item.event_date)::numeric / 300))
        )::numeric, 3) as score
      from public.items l
      where l.type = 'lost' and l.status in ('available', 'claimed')
        and l.id <> v_item.id
        and abs(l.event_date - v_item.event_date) <= 45
        and (l.category = v_item.category or similarity(l.title, v_item.title) > 0.3)
    loop
      if r.score >= 0.35 then
        insert into public.match_alerts (lost_item_id, found_item_id, score)
        values (r.id, v_item.id, r.score)
        on conflict (lost_item_id, found_item_id) do nothing;
        if found then
          v_count := v_count + 1;
          if r.reporter_id is not null then
            insert into public.notifications (user_id, kind, title, body, link)
            select r.reporter_id, 'match', 'A possible match for your lost item',
              'We found something that may be yours: ' || v_item.title || '. Check it and start a claim if it looks right.',
              '/items/' || v_item.ref_code
            where exists (select 1 from public.profiles p where p.id = r.reporter_id and p.alerts_opt_in);
          end if;
        end if;
      end if;
    end loop;
  else
    for r in
      select f.id, f.reporter_id,
        round((
          similarity(f.title, v_item.title) * 0.55
          + (case when f.category = v_item.category then 0.25 else 0 end)
          + (case when f.zone_id = v_item.zone_id then 0.10 else 0 end)
        )::numeric, 3) as score
      from public.items f
      where f.type = 'found' and f.status = 'available'
        and abs(f.event_date - v_item.event_date) <= 45
        and (f.category = v_item.category or similarity(f.title, v_item.title) > 0.3)
    loop
      if r.score >= 0.35 then
        insert into public.match_alerts (lost_item_id, found_item_id, score)
        values (v_item.id, r.id, r.score)
        on conflict (lost_item_id, found_item_id) do nothing;
        if found then v_count := v_count + 1; end if;
      end if;
    end loop;
  end if;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------- create item
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

  insert into public.items (
    type, status, category, title, public_description, zone_id, spot, event_date,
    custody_label, verification_question, sensitive_hidden_photo, reporter_id,
    reporter_kind, contact_email, finder_email, published_at
  ) values (
    p_type::public.item_type, v_status, btrim(p_category), btrim(p_title), btrim(p_description),
    v_zone, nullif(btrim(coalesce(p_spot, '')), ''), p_event_date,
    nullif(btrim(coalesce(p_custody, '')), ''),
    nullif(btrim(coalesce(p_question, '')), ''),
    coalesce(p_sensitive, false), v_uid,
    case when p_reporter_kind in ('member', 'staff', 'owner') then p_reporter_kind else 'member' end,
    nullif(btrim(coalesce(p_contact_email, '')), ''),
    nullif(btrim(coalesce(p_finder_email, '')), ''),
    case when v_status = 'available' then now() else null end
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

-- ---------------------------------------------------------------- claims
create or replace function public.submit_claim(p_ref text, p_answer text, p_proof text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_item public.items;
  v_priv public.item_private;
  v_claim public.claims;
  v_matched boolean := false;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); end if;
  if not public.rate_limit('claim:' || v_uid::text, 8, interval '1 hour') then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;

  select * into v_item from public.items where upper(ref_code) = upper(p_ref);
  if v_item.id is null then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if v_item.type <> 'found' then return jsonb_build_object('ok', false, 'error', 'NOT_CLAIMABLE'); end if;
  if v_item.status <> 'available' then
    return jsonb_build_object('ok', false, 'error', 'NOT_AVAILABLE', 'status', v_item.status);
  end if;
  if v_item.reporter_id = v_uid then
    return jsonb_build_object('ok', false, 'error', 'OWN_ITEM');
  end if;

  select * into v_priv from public.item_private where item_id = v_item.id;
  if v_priv.answer_hash is not null and p_answer is not null then
    v_matched := v_priv.answer_hash = encode(digest(lower(btrim(p_answer)), 'sha256'), 'hex');
  end if;

  insert into public.claims (item_id, claimant_id, answer_hash, answer_matched, proof)
  values (
    v_item.id, v_uid,
    case when p_answer is null then null else encode(digest(lower(btrim(p_answer)), 'sha256'), 'hex') end,
    v_matched,
    nullif(btrim(coalesce(p_proof, '')), '')
  ) returning * into v_claim;

  insert into public.claim_events (claim_id, status, note, actor_id)
  values (v_claim.id, 'submitted', 'Claim submitted by claimant.', v_uid);

  insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail)
  values (v_uid, 'claim_submitted', 'claim', v_claim.id,
    jsonb_build_object('ref', v_claim.ref_code, 'item', v_item.ref_code, 'answer_matched', v_matched));

  insert into public.notifications (user_id, kind, title, body, link)
  values (v_uid, 'claim_update', 'Claim submitted',
    'Reference ' || v_claim.ref_code || '. The desk reviews claims within two working days.',
    '/claims/' || v_claim.ref_code);

  perform public.event_log('claim_submitted', jsonb_build_object('item_ref', v_item.ref_code));

  return jsonb_build_object('ok', true, 'ref', v_claim.ref_code);
end;
$$;

create or replace function public.my_claims()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'ref', c.ref_code, 'status', c.status, 'createdAt', c.created_at,
    'itemRef', i.ref_code, 'itemTitle', i.title, 'itemType', i.type,
    'itemCategory', i.category
  ) order by c.created_at desc), '[]'::jsonb)
  from public.claims c
  join public.items i on i.id = c.item_id
  where c.claimant_id = auth.uid();
$$;

create or replace function public.my_claim(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_claim public.claims;
  v_item public.items;
  v_zone text;
  v_code public.handover_codes;
  v_reveal text := null;
  v_revealed boolean := false;
begin
  if v_uid is null then return null; end if;
  select * into v_claim from public.claims
    where upper(ref_code) = upper(p_ref) and claimant_id = v_uid;
  if v_claim.id is null then return null; end if;

  select * into v_item from public.items where id = v_claim.item_id;
  select name into v_zone from public.campus_zones where id = v_item.zone_id;

  select * into v_code from public.handover_codes where claim_id = v_claim.id;
  if v_code.id is not null then
    if v_code.used_at is not null then
      v_revealed := true;
    elsif v_code.revealed_at is null then
      v_reveal := v_code.code_plain;
      v_revealed := true;
      update public.handover_codes set revealed_at = now() where id = v_code.id;
    else
      v_revealed := true;
    end if;
  end if;

  return jsonb_build_object(
    'claim', jsonb_build_object(
      'ref', v_claim.ref_code, 'status', v_claim.status,
      'createdAt', v_claim.created_at, 'decidedAt', v_claim.decided_at,
      'reason', v_claim.decision_reason, 'proof', v_claim.proof
    ),
    'item', public.to_public_item(v_item, v_zone, null),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
        'status', e.status, 'note', e.note, 'at', e.created_at
      ) order by e.created_at)
      from public.claim_events e where e.claim_id = v_claim.id
    ), '[]'::jsonb),
    'handover', jsonb_build_object(
      'code', v_reveal,
      'alreadyShown', v_revealed,
      'used', v_code.used_at is not null,
      'expiresAt', v_code.expires_at
    )
  );
end;
$$;

-- ---------------------------------------------------------------- abuse reports
create or replace function public.submit_report(p_ref text, p_reason text, p_details text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_item public.items;
  v_email text;
begin
  if not public.rate_limit('report:' || coalesce(v_uid::text, 'anon'), 6, interval '1 hour') then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;
  select * into v_item from public.items where upper(ref_code) = upper(p_ref);
  if v_item.id is null then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if v_uid is not null then
    select email into v_email from public.profiles where id = v_uid;
  end if;
  insert into public.abuse_reports (item_id, reporter_id, reporter_email, reason, details)
  values (v_item.id, v_uid, v_email, p_reason, nullif(btrim(coalesce(p_details, '')), ''));
  perform public.event_log('listing_reported', jsonb_build_object('item_ref', v_item.ref_code));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- staff desk
create or replace function public.staff_claim_queue()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then return null; end if;
  return jsonb_build_object(
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ref', c.ref_code, 'status', c.status, 'createdAt', c.created_at,
        'answerMatched', c.answer_matched,
        'itemRef', i.ref_code, 'itemTitle', i.title, 'itemStatus', i.status,
        'claimant', coalesce(p.full_name, p.email, 'Signed-in user'),
        'claimantEmail', p.email
      ) order by c.created_at)
      from public.claims c
      join public.items i on i.id = c.item_id
      left join public.profiles p on p.id = c.claimant_id
      where c.status in ('submitted', 'under_review')
    ), '[]'::jsonb),
    'intake', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ref', i.ref_code, 'title', i.title, 'status', i.status,
        'type', i.type, 'createdAt', i.created_at, 'zone', z.name
      ) order by i.created_at)
      from public.items i
      left join public.campus_zones z on z.id = i.zone_id
      where i.status in ('pending_moderation', 'quarantined')
    ), '[]'::jsonb),
    'awaitingHandover', coalesce((
      select jsonb_agg(jsonb_build_object(
        'claimRef', c.ref_code, 'itemRef', i.ref_code, 'itemTitle', i.title,
        'approvedAt', c.decided_at, 'codeUsed', hc.used_at is not null
      ) order by c.decided_at)
      from public.claims c
      join public.items i on i.id = c.item_id
      left join public.handover_codes hc on hc.claim_id = c.id
      where c.status = 'approved' and i.status = 'claimed'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.staff_item_detail(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_item public.items;
  v_priv public.item_private;
  v_zone text;
begin
  if not public.is_staff() then return null; end if;
  select * into v_item from public.items where upper(ref_code) = upper(p_ref);
  if v_item.id is null then return null; end if;
  select * into v_priv from public.item_private where item_id = v_item.id;
  select name into v_zone from public.campus_zones where id = v_item.zone_id;

  return jsonb_build_object(
    'item', public.to_public_item(v_item, v_zone, null),
    'private', jsonb_build_object(
      'hasAnswer', v_priv.answer_hash is not null,
      'notes', v_priv.private_notes,
      'serial', v_priv.serial_number,
      'bin', v_priv.bin_code,
      'finderContact', v_priv.finder_contact
    ),
    'contactEmail', v_item.contact_email,
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ref', c.ref_code, 'status', c.status, 'createdAt', c.created_at,
        'answerMatched', c.answer_matched, 'proof', c.proof,
        'reason', c.decision_reason,
        'claimant', coalesce(p.full_name, p.email, 'Signed-in user'),
        'claimantEmail', p.email
      ) order by c.created_at)
      from public.claims c
      left join public.profiles p on p.id = c.claimant_id
      where c.item_id = v_item.id
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('action', a.action, 'at', a.created_at, 'detail', a.detail)
        order by a.created_at)
      from public.audit_logs a where a.resource_id = v_item.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.staff_decide_claim(p_claim_ref text, p_decision text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_claim public.claims;
  v_item public.items;
  v_status public.claim_status;
  v_code text;
begin
  if not public.is_staff() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if p_decision not in ('approve', 'reject', 'review') then
    return jsonb_build_object('ok', false, 'error', 'BAD_DECISION');
  end if;

  select * into v_claim from public.claims where upper(ref_code) = upper(p_claim_ref);
  if v_claim.id is null then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  select * into v_item from public.items where id = v_claim.item_id;

  if p_decision = 'review' then
    update public.claims set status = 'under_review' where id = v_claim.id;
    insert into public.claim_events (claim_id, status, note, actor_id)
    values (v_claim.id, 'under_review', nullif(btrim(coalesce(p_reason, '')), ''), v_uid);
    return jsonb_build_object('ok', true, 'status', 'under_review');
  end if;

  if v_claim.status in ('approved', 'rejected', 'withdrawn') then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_DECIDED');
  end if;

  if p_decision = 'reject' then
    v_status := 'rejected';
    update public.claims set status = v_status, decision_reason = p_reason,
      decided_by = v_uid, decided_at = now() where id = v_claim.id;
    insert into public.claim_events (claim_id, status, note, actor_id)
    values (v_claim.id, v_status, nullif(btrim(coalesce(p_reason, '')), ''), v_uid);
    insert into public.notifications (user_id, kind, title, body, link)
    values (v_claim.claimant_id, 'claim_update', 'Claim not approved',
      'Reference ' || v_claim.ref_code || '. ' ||
      coalesce(nullif(btrim(p_reason), ''), 'The desk could not verify ownership for this claim.') ||
      ' You can reply to the desk if you have more proof.',
      '/claims/' || v_claim.ref_code);
    insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail, severity)
    values (v_uid, 'claim_decided', 'claim', v_claim.id,
      jsonb_build_object('decision', 'reject', 'reason', p_reason), 'warn');
    perform public.event_log('claim_decided', jsonb_build_object('decision', 'reject'));
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;

  -- approve: issue a one-time handover code
  v_status := 'approved';
  update public.claims set status = v_status, decision_reason = p_reason,
    decided_by = v_uid, decided_at = now() where id = v_claim.id;
  update public.items set status = 'claimed' where id = v_item.id;

  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
           (floor(random() * 32) + 1)::int, 1), '')
  into v_code from generate_series(1, 6);

  insert into public.handover_codes (claim_id, code_hash, code_plain)
  values (v_claim.id, encode(digest(v_code, 'sha256'), 'hex'), v_code)
  on conflict (claim_id) do nothing;

  insert into public.claim_events (claim_id, status, note, actor_id)
  values (v_claim.id, v_status, nullif(btrim(coalesce(p_reason, '')), ''), v_uid);

  insert into public.notifications (user_id, kind, title, body, link)
  values (v_claim.claimant_id, 'handover', 'Claim approved — collect at the desk',
    'Reference ' || v_claim.ref_code || '. Show your handover code at ' ||
    coalesce(v_item.custody_label, 'the desk') || '. Do not share the code.',
    '/claims/' || v_claim.ref_code);

  insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail, severity)
  values (v_uid, 'claim_decided', 'claim', v_claim.id,
    jsonb_build_object('decision', 'approve', 'reason', p_reason), 'info');
  perform public.event_log('claim_decided', jsonb_build_object('decision', 'approve'));

  return jsonb_build_object('ok', true, 'status', 'approved');
end;
$$;

create or replace function public.staff_confirm_handover(p_item_ref text, p_code text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
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
  if v_item.status = 'recovered' then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_RECOVERED');
  end if;

  select * into v_claim from public.claims
    where item_id = v_item.id and status = 'approved'
    order by decided_at desc limit 1;
  if v_claim.id is null then return jsonb_build_object('ok', false, 'error', 'NO_APPROVED_CLAIM'); end if;

  select * into v_code from public.handover_codes where claim_id = v_claim.id;
  if p_code is not null and btrim(p_code) <> '' then
    if v_code.id is null
       or v_code.code_hash <> encode(digest(upper(btrim(p_code)), 'sha256'), 'hex') then
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

  update public.items set status = p_status::public.item_status,
    published_at = case when p_status = 'available' then coalesce(published_at, now()) else published_at end
  where id = v_item.id;

  insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail, severity)
  values (v_uid, 'item_status_changed', 'item', v_item.id,
    jsonb_build_object('from', v_item.status, 'to', p_status, 'note', p_note),
    case when p_status = 'quarantined' then 'warn' else 'info' end);

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

-- ---------------------------------------------------------------- admin
create or replace function public.admin_metrics()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_handed int;
  v_recovered int;
begin
  if not public.is_admin() then return null; end if;

  select count(*) into v_handed from public.items
    where type = 'found' and is_sample = false and created_at > now() - interval '60 days';
  select count(*) into v_recovered from public.items
    where type = 'found' and status = 'recovered' and is_sample = false
      and created_at > now() - interval '60 days';

  return jsonb_build_object(
    'itemsByStatus', coalesce((
      select jsonb_object_agg(status, n) from (
        select status::text as status, count(*) n from public.items where is_sample = false group by status
      ) s), '{}'::jsonb),
    'claimsByStatus', coalesce((
      select jsonb_object_agg(status, n) from (
        select status::text as status, count(*) n from public.claims group by status
      ) s), '{}'::jsonb),
    'cohort60d', jsonb_build_object('handedIn', v_handed, 'recovered', v_recovered,
      'rate', case when v_handed = 0 then null else round((v_recovered::numeric / v_handed) * 100, 1) end),
    'medianDays', (select median_days_to_recovery from public.public_stats),
    'openReports', (select count(*) from public.abuse_reports where status = 'open'),
    'users', (select count(*) from public.profiles),
    'staff', (select count(*) from public.user_roles where role in ('staff', 'admin')),
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object('zone', z.name, 'found', count(i.id)) order by count(i.id) desc)
      from public.campus_zones z
      left join public.items i on i.zone_id = z.id and i.type = 'found' and i.is_sample = false
      group by z.name), '[]'::jsonb),
    'topSearches', '[]'::jsonb
  );
end;
$$;

create or replace function public.admin_list_users()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'email', p.email, 'name', p.full_name,
      'roles', coalesce((select jsonb_agg(r.role) from public.user_roles r where r.user_id = p.id), '[]'::jsonb),
      'createdAt', p.created_at
    ) order by p.created_at desc)
    from public.profiles p
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_set_role(p_email text, p_role text, p_grant boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if p_role not in ('admin', 'staff', 'member') then
    return jsonb_build_object('ok', false, 'error', 'BAD_ROLE');
  end if;
  select id into v_target from public.profiles where lower(email) = lower(btrim(p_email));
  if v_target is null then return jsonb_build_object('ok', false, 'error', 'NO_SUCH_USER'); end if;
  if v_target = v_uid and not p_grant then
    return jsonb_build_object('ok', false, 'error', 'CANNOT_DEMOTE_SELF');
  end if;

  if p_grant then
    insert into public.user_roles (user_id, role, granted_by)
    values (v_target, p_role::public.app_role, v_uid) on conflict do nothing;
  else
    delete from public.user_roles where user_id = v_target and role = p_role::public.app_role;
  end if;

  insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail, severity)
  values (v_uid, 'role_changed', 'user', v_target,
    jsonb_build_object('role', p_role, 'granted', p_grant), 'warn');

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_audit_log(p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'action', a.action, 'resourceType', a.resource_type,
      'resourceId', a.resource_id, 'detail', a.detail,
      'severity', a.severity, 'at', a.created_at,
      'actor', coalesce(p.email, a.actor_id::text, 'system')
    ) order by a.created_at desc)
    from (select * from public.audit_logs order by created_at desc limit least(greatest(p_limit, 1), 300)) a
    left join public.profiles p on p.id = a.actor_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_open_reports()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'reason', r.reason, 'details', r.details, 'status', r.status,
      'at', r.created_at, 'itemRef', i.ref_code, 'itemTitle', i.title
    ) order by r.created_at desc)
    from public.abuse_reports r
    left join public.items i on i.id = r.item_id
    where r.status <> 'closed'
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_close_report(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  update public.abuse_reports set status = 'closed' where id = p_id;
  insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail)
  values (auth.uid(), 'report_closed', 'abuse_report', p_id, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_purge_samples()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  delete from public.items where is_sample = true;
  get diagnostics v_n = row_count;
  insert into public.audit_logs (actor_id, action, resource_type, detail, severity)
  values (auth.uid(), 'samples_purged', 'item', jsonb_build_object('count', v_n), 'warn');
  return jsonb_build_object('ok', true, 'deleted', v_n);
end;
$$;

-- ---------------------------------------------------------------- housekeeping
create or replace function public.housekeeping()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_expired int;
  v_purged int;
  v_notifs int;
  v_audit int;
  v_reports int;
  v_paths jsonb;
begin
  -- 1. listings past their window stop being claimable
  with upd as (
    update public.items set status = 'expired'
    where status in ('available', 'claimed') and expires_at < now()
    returning id
  ) select count(*) into v_expired from upd;

  -- 2. retention: 30 days after expiry the listing and its photos go
  select coalesce(jsonb_agg(im.storage_path), '[]'::jsonb) into v_paths
  from public.item_images im
  join public.items i on i.id = im.item_id
  where i.status = 'expired' and i.expires_at < now() - interval '30 days';

  with del as (
    delete from public.items
    where status = 'expired' and expires_at < now() - interval '30 days'
    returning id
  ) select count(*) into v_purged from del;

  -- 3. notification and audit retention
  with d as (delete from public.notifications where created_at < now() - interval '180 days' returning id)
  select count(*) into v_notifs from d;
  with d as (delete from public.audit_logs where created_at < now() - interval '365 days' returning id)
  select count(*) into v_audit from d;
  with d as (delete from public.abuse_reports where status = 'closed' and created_at < now() - interval '180 days' returning id)
  select count(*) into v_reports from d;
  delete from public.rate_limits where window_start < now() - interval '2 days';

  -- 4. nudges: items about to expire get one last push to their reporter
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

  perform public.event_log('housekeeping_run', jsonb_build_object(
    'expired', v_expired, 'purged', v_purged, 'photos', jsonb_array_length(v_paths)));

  return jsonb_build_object(
    'expired', v_expired, 'purged', v_purged, 'photoPaths', v_paths,
    'notificationsDeleted', v_notifs, 'auditDeleted', v_audit, 'reportsDeleted', v_reports
  );
end;
$$;

revoke all on function public.housekeeping() from public, anon, authenticated;
grant execute on function public.housekeeping() to service_role;

-- ---------------------------------------------------------------- grants
grant execute on function
  public.search_items(jsonb), public.get_public_item(text), public.board_stats(),
  public.my_claims(), public.my_claim(text), public.submit_claim(text, text, text),
  public.submit_report(text, text, text), public.create_item(text, text, text, text, text, text, date, text, text, text, boolean, text, text, text),
  public.staff_claim_queue(), public.staff_item_detail(text), public.staff_decide_claim(text, text, text),
  public.staff_confirm_handover(text, text, text), public.staff_update_item(text, text, text),
  public.admin_metrics(), public.admin_list_users(), public.admin_set_role(text, text, boolean),
  public.admin_audit_log(int), public.admin_open_reports(), public.admin_close_report(uuid),
  public.admin_purge_samples(), public.refresh_matches(uuid), public.to_public_item(public.items, text, text)
to anon, authenticated, service_role;

notify pgrst, 'reload schema';
