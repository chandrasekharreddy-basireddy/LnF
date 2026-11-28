-- L&F :: 0043 the erasure confirmation could never be queued
--
-- queue_email_retry() has an event whitelist and email_outbox has a matching
-- CHECK. Neither included 'erasure_confirmed', which the erasure action queues
-- after it deletes the account. The RPC therefore returned
-- {ok:false, error:'BAD_EVENT_TYPE'} with HTTP 200 and no transport error, so
-- the caller believed the mail was queued and the erased person — who can no
-- longer sign in to see anything in-app — was never told.
--
-- Found by the auth/email audit, 28/11.

alter table public.email_outbox drop constraint if exists email_outbox_event_type_check;
alter table public.email_outbox add constraint email_outbox_event_type_check
  check (event_type in (
    'sign_in_code', 'claim_received', 'claim_decided', 'handover_ready',
    'item_published', 'finder_thanks', 'match_alert', 'welcome', 'erasure_confirmed'
  ));

create or replace function public.queue_email_retry(
  p_dedupe_key text,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb,
  p_to text default null
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null and not public.rate_limit('email_retry:' || v_uid::text, 10, interval '1 hour') then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;

  if p_event_type not in (
    'sign_in_code', 'claim_received', 'claim_decided', 'handover_ready',
    'item_published', 'finder_thanks', 'match_alert', 'welcome', 'erasure_confirmed'
  ) then
    return jsonb_build_object('ok', false, 'error', 'BAD_EVENT_TYPE');
  end if;

  insert into public.email_outbox (dedupe_key, event_type, recipient_email, payload)
  values (p_dedupe_key, p_event_type, lower(p_to), p_payload)
  on conflict (dedupe_key) do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.queue_email_retry(text, text, jsonb, text) from public, anon;
grant execute on function public.queue_email_retry(text, text, jsonb, text) to authenticated, service_role;

notify pgrst, 'reload schema';
