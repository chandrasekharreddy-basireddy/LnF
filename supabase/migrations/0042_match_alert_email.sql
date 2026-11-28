-- L&F :: 0042 the match email nobody was sending
--
-- templates.matchAlert has existed since the email layer was written, and the
-- outbox can rebuild it, but nothing ever queued one: a finder logging the right
-- item produced an in-app notification and silence everywhere else. This is the
-- missing link — a bounded, idempotent sweep the cron can call.
--
-- It is deliberately not inside refresh_matches(): that function runs per item
-- on every report and must stay cheap. The sweep reads the alerts that already
-- exist, queues one email per alert, and stamps notified_at so a re-run sends
-- nothing twice.

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
     where m.notified_at is null
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

revoke all on function public.queue_match_alerts(int) from public, anon, authenticated;
grant execute on function public.queue_match_alerts(int) to service_role;

-- notified_at was declared in 0001 and never written; give the sweep an index
create index if not exists match_alerts_unnotified_idx
  on public.match_alerts (created_at) where notified_at is null;

notify pgrst, 'reload schema';
