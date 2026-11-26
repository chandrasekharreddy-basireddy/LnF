-- L&F :: 0010 email outbox
--
-- Until now an email that Brevo rejected was simply lost: the in-app row stayed,
-- the message did not. Every send now falls back to a queued row that the daily
-- cron retries, with a dedupe key so a retry cannot become a second email.

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  event_type text not null check (event_type in (
    'item_published', 'claim_received', 'claim_decided', 'finder_thanks', 'match_alert'
  )),
  recipient_email text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts int not null default 0,
  last_error text,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index email_outbox_pending_idx on public.email_outbox (status, created_at)
  where status in ('pending', 'sending');

alter table public.email_outbox enable row level security;
-- no policies: service role only, reached through the functions below

revoke all on public.email_outbox from anon, authenticated;

-- ---------------------------------------------------------------- queue a retry
-- A member may only queue mail to their own address; staff may queue to the
-- finder address they are writing to. That keeps this from becoming a relay.
create or replace function public.queue_email_retry(
  p_dedupe_key text,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb,
  p_to text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_self text;
  v_email text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); end if;

  select email into v_self from public.profiles where id = v_uid;
  v_email := coalesce(nullif(btrim(coalesce(p_to, '')), ''), v_self);

  if v_email is null then return jsonb_build_object('ok', false, 'error', 'NO_ADDRESS'); end if;
  if v_email <> coalesce(v_self, '') and not public.is_staff() then
    v_email := v_self;
  end if;

  insert into public.email_outbox (dedupe_key, event_type, recipient_email, payload)
  values (left(p_dedupe_key, 200), p_event_type, v_email, coalesce(p_payload, '{}'::jsonb))
  on conflict (dedupe_key) do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- claim a batch
create or replace function public.claim_email_batch(p_limit int default 25)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_rows jsonb;
begin
  with picked as (
    select id from public.email_outbox
     where status = 'pending'
       and attempts < 3
       and (locked_until is null or locked_until < now())
     order by created_at
     limit v_limit
     for update skip locked
  ),
  claimed as (
    update public.email_outbox o
       set status = 'sending',
           attempts = o.attempts + 1,
           locked_until = now() + interval '5 minutes'
      from picked
     where o.id = picked.id
    returning jsonb_build_object(
      'id', o.id, 'dedupeKey', o.dedupe_key, 'eventType', o.event_type,
      'to', o.recipient_email, 'payload', o.payload, 'attempts', o.attempts
    ) as row
  )
  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_rows from claimed;

  return v_rows;
end;
$$;

create or replace function public.finish_email(p_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_ok then
    update public.email_outbox
       set status = 'sent', sent_at = now(), last_error = null, locked_until = null
     where id = p_id;
  else
    update public.email_outbox
       set status = case when attempts >= 3 then 'failed' else 'pending' end,
           last_error = left(coalesce(p_error, 'unknown'), 500),
           locked_until = null
     where id = p_id;
  end if;
end;
$$;

-- housekeeping also clears rows that gave up long ago
create or replace function public.housekeeping() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_expired int; v_purged int; v_notifs int; v_audit int; v_reports int;
  v_paths jsonb; v_outbox int;
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

  perform public.event_log('housekeeping_run', jsonb_build_object(
    'expired', v_expired, 'purged', v_purged, 'photos', jsonb_array_length(v_paths),
    'outboxDeleted', v_outbox));

  return jsonb_build_object(
    'expired', v_expired, 'purged', v_purged, 'photoPaths', v_paths,
    'notificationsDeleted', v_notifs, 'auditDeleted', v_audit,
    'reportsDeleted', v_reports, 'outboxDeleted', v_outbox
  );
end;
$$;

revoke all on function public.housekeeping() from public, anon, authenticated;
grant execute on function public.housekeeping() to service_role;

revoke all on function public.queue_email_retry(text, text, jsonb, text) from public, anon;
grant execute on function public.queue_email_retry(text, text, jsonb, text) to authenticated;

revoke all on function public.claim_email_batch(int) from public, anon, authenticated;
revoke all on function public.finish_email(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.claim_email_batch(int) to service_role;
grant execute on function public.finish_email(uuid, boolean, text) to service_role;

notify pgrst, 'reload schema';
