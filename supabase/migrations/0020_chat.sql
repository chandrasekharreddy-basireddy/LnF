-- L&F :: 0020 the desk has an inbox, not a table of rows
--
-- The masked thread already existed per claim. This turns it into a chat
-- product: a conversation list with unread counts, read receipts, live
-- delivery, and the same moderation rules on every message.
--
-- Nothing here introduces a new message table. One table, one moderation path,
-- one audit trail — a second chat system beside the first is how two products
-- end up disagreeing about who said what.

-- ---------------------------------------------------------------- state
create table if not exists public.conversation_reads (
  claim_id uuid not null references public.claims (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (claim_id, user_id)
);

alter table public.conversation_reads enable row level security;
create policy conversation_reads_own on public.conversation_reads
  for select to authenticated using (user_id = auth.uid());
grant select on public.conversation_reads to authenticated;

alter table public.claim_messages
  add column if not exists kind text not null default 'text'
  check (kind in ('text', 'system'));

create index if not exists claim_messages_claim_created_idx
  on public.claim_messages (claim_id, created_at desc);

-- ---------------------------------------------------------------- list
create or replace function public.my_conversations()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_staff boolean := public.is_staff();
begin
  if v_uid is null then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(payload order by last_at desc)
    from (
      select
        jsonb_build_object(
          'claimRef', c.ref_code,
          'claimId', c.id,
          'itemRef', i.ref_code,
          'itemTitle', i.title,
          'claimStatus', c.status,
          'itemStatus', i.status,
          'myRole', case
            when c.claimant_id = v_uid then 'claimant'
            when i.reporter_id = v_uid then 'finder'
            else 'staff' end,
          'lastMessage', (
            select left(m.body, 140) from public.claim_messages m
            where m.claim_id = c.id
              and (not m.quarantined or v_staff or m.sender_id = v_uid)
            order by m.created_at desc limit 1),
          'lastAt', coalesce(
            (select max(m.created_at) from public.claim_messages m where m.claim_id = c.id),
            c.created_at),
          'unread', (
            select count(*) from public.claim_messages m
            where m.claim_id = c.id
              and m.sender_id <> v_uid
              and not m.quarantined
              and m.created_at > coalesce(r.last_read_at, 'epoch'::timestamptz)),
          'locked', (c.status in ('rejected', 'withdrawn') or i.status = 'recovered')
        ) as payload,
        coalesce(
          (select max(m.created_at) from public.claim_messages m where m.claim_id = c.id),
          c.created_at) as last_at
      from public.claims c
      join public.items i on i.id = c.item_id
      left join public.conversation_reads r on r.claim_id = c.id and r.user_id = v_uid
      where v_staff or c.claimant_id = v_uid or i.reporter_id = v_uid
      order by last_at desc
      limit 100
    ) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated, service_role;

-- ---------------------------------------------------------------- read
create or replace function public.mark_thread_read(p_claim_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_claim public.claims;
  v_item public.items;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); end if;

  select * into v_claim from public.claims where upper(ref_code) = upper(p_claim_ref);
  if v_claim.id is null then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  select * into v_item from public.items where id = v_claim.item_id;

  if not (public.is_staff() or v_claim.claimant_id = v_uid or v_item.reporter_id = v_uid) then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  insert into public.conversation_reads (claim_id, user_id, last_read_at)
  values (v_claim.id, v_uid, now())
  on conflict (claim_id, user_id) do update set last_read_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.mark_thread_read(text) from public, anon;
grant execute on function public.mark_thread_read(text) to authenticated;

-- ---------------------------------------------------------------- thread
-- Same read model as 0011, plus what a chat needs: unread count, a label for
-- the other side, and whether the viewer may still post.
create or replace function public.claim_thread(p_claim_ref text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_claim public.claims;
  v_item public.items;
  v_role text;
  v_staff boolean := public.is_staff();
  v_locked boolean;
  v_last_read timestamptz;
begin
  if v_uid is null then return null; end if;

  select * into v_claim from public.claims where upper(ref_code) = upper(p_claim_ref);
  if v_claim.id is null then return null; end if;
  select * into v_item from public.items where id = v_claim.item_id;

  if v_staff then v_role := 'staff';
  elsif v_claim.claimant_id = v_uid then v_role := 'claimant';
  elsif v_item.reporter_id = v_uid then v_role := 'finder';
  else return null; end if;

  v_locked := v_claim.status in ('rejected', 'withdrawn') or v_item.status = 'recovered';
  select last_read_at into v_last_read from public.conversation_reads
   where claim_id = v_claim.id and user_id = v_uid;

  return jsonb_build_object(
    'claimRef', v_claim.ref_code,
    'claimId', v_claim.id,
    'itemRef', v_item.ref_code,
    'itemTitle', v_item.title,
    'itemStatus', v_item.status,
    'claimStatus', v_claim.status,
    'role', v_role,
    'locked', v_locked,
    'lockReason', case
      when v_item.status = 'recovered' then 'This item was handed over; the thread is read-only.'
      when v_claim.status = 'rejected' then 'This claim was closed; the thread is read-only.'
      when v_claim.status = 'withdrawn' then 'This claim was withdrawn; the thread is read-only.'
      else null end,
    'counterparty', case
      when v_role = 'claimant' then 'The finder and the desk'
      when v_role = 'finder' then 'The claimant and the desk'
      else 'Claimant and finder' end,
    'unread', (
      select count(*) from public.claim_messages m
      where m.claim_id = v_claim.id and m.sender_id <> v_uid and not m.quarantined
        and m.created_at > coalesce(v_last_read, 'epoch'::timestamptz)),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'body', m.body,
        'role', m.sender_role,
        'mine', m.sender_id = v_uid,
        'kind', m.kind,
        'quarantined', m.quarantined,
        'at', m.created_at
      ) order by m.created_at)
      from public.claim_messages m
      where m.claim_id = v_claim.id
        and (not m.quarantined or m.sender_id = v_uid or v_staff)
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------- live
-- Realtime respects RLS through the same policy, so a subscriber sees only the
-- threads it is allowed to read. Guarded: a project without the publication
-- still works, on the polling fallback.
do $$
begin
  alter publication supabase_realtime add table public.claim_messages;
exception
  when others then
    raise notice 'realtime publication not updated (%); the chat falls back to polling', sqlerrm;
end;
$$;

notify pgrst, 'reload schema';
