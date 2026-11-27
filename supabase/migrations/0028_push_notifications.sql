-- L&F :: 0028 a notification that reaches a person, not a table
--
-- Until now every notification was written to public.notifications and waited
-- for the owner to open /account. This adds two delivery channels that do not
-- need a mail provider and do not need the platform to know a phone number:
--
--   1. Web push: a browser subscription is stored against the account. The
--      endpoint and its two keys are bearer secrets — whoever holds them can
--      send a push to that device — so they are never readable by another
--      account, never writable by a browser, and never returned by a page.
--      The daily/quarterly dispatcher is the only reader, and it is a
--      service-role function.
--   2. WhatsApp click-to-chat needs no schema at all: the desk's number is a
--      deployment constant and the link is built in src/lib/whatsapp.ts. The
--      platform never sends a WhatsApp message, so nothing here stores one.
--
-- Authorization lives in this file. A browser can call three functions —
-- register, unregister, set preference — and each one takes the identity from
-- auth.uid(), never from an argument.

-- ---------------------------------------------------------------- preferences
alter table public.profiles
  add column if not exists push_opt_in boolean not null default false;

-- ------------------------------------------------------- delivery bookkeeping
alter table public.notifications
  add column if not exists push_status text not null default 'none',
  add column if not exists push_attempts int not null default 0,
  add column if not exists push_locked_until timestamptz,
  add column if not exists pushed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notifications_push_status_check'
  ) then
    alter table public.notifications
      add constraint notifications_push_status_check
      check (push_status in ('none', 'pending', 'sending', 'sent', 'failed', 'skipped'));
  end if;
end $$;

-- the dispatcher's only query: rows waiting to go out
create index if not exists notifications_push_queue_idx
  on public.notifications (created_at)
  where push_status = 'pending';

-- ---------------------------------------------------------- push subscriptions
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- one device, one row: the endpoint is issued by the browser's push service
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  failures int not null default 0,
  disabled_at timestamptz,
  constraint push_endpoint_https check (endpoint like 'https://%' and char_length(endpoint) between 20 and 2000),
  constraint push_p256dh_shape check (char_length(p256dh) between 16 and 200),
  constraint push_auth_shape check (char_length(auth) between 8 and 100),
  constraint push_user_agent_shape check (user_agent is null or char_length(user_agent) <= 300)
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id)
  where disabled_at is null;

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_read_own on public.push_subscriptions;
create policy push_subscriptions_read_own on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

-- No insert, update or delete grant: a browser writes only through the
-- functions below, so it cannot attach a device to someone else's account, and
-- it cannot read another account's endpoint.
revoke all on public.push_subscriptions from anon, authenticated;
grant select on public.push_subscriptions to authenticated;

-- ------------------------------------------------------------------ functions

-- Register (or refresh) this browser. The endpoint is the identity of the
-- device; if another account already holds it, this refuses rather than
-- stealing it — and says nothing about who holds it.
create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_live int;
  v_id uuid;
  v_owner uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'SIGN_IN_REQUIRED');
  end if;

  if p_endpoint is null
     or p_endpoint !~ '^https://[^[:space:]]+$'
     or char_length(p_endpoint) < 20
     or char_length(p_endpoint) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'BAD_ENDPOINT');
  end if;
  if p_p256dh is null or char_length(p_p256dh) < 16 or char_length(p_p256dh) > 200
     or p_p256dh !~ '^[A-Za-z0-9_\-=]+$' then
    return jsonb_build_object('ok', false, 'error', 'BAD_KEY');
  end if;
  if p_auth is null or char_length(p_auth) < 8 or char_length(p_auth) > 100
     or p_auth !~ '^[A-Za-z0-9_\-=]+$' then
    return jsonb_build_object('ok', false, 'error', 'BAD_KEY');
  end if;

  select user_id into v_owner from public.push_subscriptions where endpoint = p_endpoint;
  if v_owner is not null and v_owner <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'DEVICE_IN_USE');
  end if;

  select count(*) into v_live
    from public.push_subscriptions
   where user_id = v_uid and disabled_at is null and endpoint <> p_endpoint;
  if v_live >= 5 then
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY_DEVICES', 'limit', 5);
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 300))
  on conflict (endpoint) do update
     set p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent,
         last_seen_at = now(),
         failures = 0,
         disabled_at = null
   where public.push_subscriptions.user_id = v_uid
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'DEVICE_IN_USE');
  end if;

  -- registering a device is the opt-in: the person just pressed the button
  update public.profiles set push_opt_in = true, updated_at = now() where id = v_uid;

  select count(*) into v_live
    from public.push_subscriptions
   where user_id = v_uid and disabled_at is null;

  return jsonb_build_object('ok', true, 'id', v_id, 'devices', v_live);
end $$;

-- Forget one device (the browser asked, or the account removed it).
create or replace function public.unregister_push_subscription(p_endpoint text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_removed int;
  v_live int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'SIGN_IN_REQUIRED');
  end if;

  delete from public.push_subscriptions
   where user_id = v_uid and endpoint = p_endpoint;
  get diagnostics v_removed = row_count;

  select count(*) into v_live
    from public.push_subscriptions
   where user_id = v_uid and disabled_at is null;

  return jsonb_build_object('ok', true, 'removed', v_removed, 'devices', v_live);
end $$;

-- The master switch. Off means off: every device row goes, so a stale
-- subscription cannot outlive the preference that justified it.
create or replace function public.set_push_opt_in(p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_removed int := 0;
  v_live int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'SIGN_IN_REQUIRED');
  end if;

  if p_on then
    update public.profiles set push_opt_in = true, updated_at = now() where id = v_uid;
  else
    delete from public.push_subscriptions where user_id = v_uid;
    get diagnostics v_removed = row_count;
    update public.profiles set push_opt_in = false, updated_at = now() where id = v_uid;
  end if;

  select count(*) into v_live
    from public.push_subscriptions
   where user_id = v_uid and disabled_at is null;

  insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail)
  values (
    v_uid,
    case when p_on then 'push_opt_in' else 'push_opt_out' end,
    'profile',
    v_uid,
    jsonb_build_object('devicesRemoved', v_removed, 'devicesLive', v_live)
  );

  return jsonb_build_object('ok', true, 'optIn', p_on, 'devices', v_live, 'removed', v_removed);
end $$;

-- What /account needs to render: the preference and the device count, never
-- an endpoint or a key.
create or replace function public.my_push_state()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'SIGN_IN_REQUIRED');
  end if;
  return jsonb_build_object(
    'ok', true,
    'optIn', coalesce((select push_opt_in from public.profiles where id = v_uid), false),
    'devices', (select count(*) from public.push_subscriptions where user_id = v_uid and disabled_at is null),
    'lastSeenAt', (select max(last_seen_at) from public.push_subscriptions where user_id = v_uid and disabled_at is null)
  );
end $$;

-- ------------------------------------------------------------- queue on write
-- A notification is queued for push only when the owner has opted in and has a
-- live device at the moment it is written. Nothing is rewritten: every existing
-- `insert into public.notifications` keeps working unchanged.
create or replace function public.queue_push_for_notification() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'system' then
    new.push_status := 'none';
    return new;
  end if;

  if exists (
       select 1 from public.profiles p
        where p.id = new.user_id and p.push_opt_in
     )
     and exists (
       select 1 from public.push_subscriptions s
        where s.user_id = new.user_id and s.disabled_at is null
     ) then
    new.push_status := 'pending';
  else
    new.push_status := 'skipped';
  end if;

  return new;
end $$;

drop trigger if exists notifications_queue_push on public.notifications;
create trigger notifications_queue_push before insert on public.notifications
  for each row execute function public.queue_push_for_notification();

-- --------------------------------------------------------------- dispatcher
-- Service-role only. Claims a batch, hands the dispatcher everything it needs
-- to encrypt one message per device, and leaves the row in 'sending' until
-- finish_push() records what happened. A crashed run is reclaimed after ten
-- minutes, the same way the email outbox is.
create or replace function public.claim_push_batch(p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_rows jsonb;
begin
  with picked as (
    select n.id
      from public.notifications n
     where n.push_attempts < 3
       and (
             n.push_status = 'pending'
          or (n.push_status = 'sending' and coalesce(n.push_locked_until, now()) < now())
       )
     order by n.created_at
     limit v_limit
     for update skip locked
  ),
  claimed as (
    update public.notifications n
       set push_status = 'sending',
           push_attempts = n.push_attempts + 1,
           push_locked_until = now() + interval '10 minutes'
      from picked
     where n.id = picked.id
    returning n.id, n.user_id, n.kind, n.title, n.body, n.link, n.push_attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'kind', c.kind,
           'title', c.title,
           'body', c.body,
           'link', c.link,
           'attempts', c.push_attempts,
           'subscriptions', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
               from public.push_subscriptions s
              where s.user_id = c.user_id and s.disabled_at is null
           ), '[]'::jsonb)
         )), '[]'::jsonb)
    into v_rows
    from claimed c;

  return v_rows;
end $$;

-- Record the outcome. An endpoint the push service has retired (404/410) is
-- disabled here, so the next batch does not try it again.
create or replace function public.finish_push(
  p_id uuid,
  p_status text,
  p_drop_endpoints text[] default '{}'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_dropped int := 0;
begin
  if p_status not in ('sent', 'failed', 'skipped') then
    return jsonb_build_object('ok', false, 'error', 'BAD_STATUS');
  end if;

  update public.notifications
     set push_status = p_status,
         push_locked_until = null,
         pushed_at = case when p_status = 'sent' then now() else pushed_at end
   where id = p_id and push_status = 'sending';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_CLAIMED');
  end if;

  if coalesce(array_length(p_drop_endpoints, 1), 0) > 0 then
    with d as (
      update public.push_subscriptions
         set disabled_at = now(), failures = failures + 1
       where endpoint = any (p_drop_endpoints) and disabled_at is null
      returning 1
    )
    select count(*) into v_dropped from d;
  end if;

  return jsonb_build_object('ok', true, 'dropped', v_dropped);
end $$;

-- -------------------------------------------------------------------- grants
revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.unregister_push_subscription(text) from public, anon;
revoke all on function public.set_push_opt_in(boolean) from public, anon;
revoke all on function public.my_push_state() from public, anon;
revoke all on function public.claim_push_batch(int) from public, anon, authenticated;
revoke all on function public.finish_push(uuid, text, text[]) from public, anon, authenticated;

grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.unregister_push_subscription(text) to authenticated;
grant execute on function public.set_push_opt_in(boolean) to authenticated;
grant execute on function public.my_push_state() to authenticated;
grant execute on function public.claim_push_batch(int) to service_role;
grant execute on function public.finish_push(uuid, text, text[]) to service_role;

-- The dispatcher reads subscriptions through claim_push_batch (definer), but
-- the service role also needs to look at the table to diagnose a stuck run.
grant select on public.push_subscriptions to service_role;

notify pgrst, 'reload schema';
