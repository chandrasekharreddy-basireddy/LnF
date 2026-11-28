-- L&F :: 0034 erasure deletes the right outbox column
--
-- admin_erase_user_data() was written in 0024 and never executed until now: it
-- referenced email_outbox.recipient_user_id, which does not exist. The table
-- addresses people by recipient_email. Found on the first real run, which is the
-- same lesson the lifecycle check taught — a function nobody has called is a
-- function nobody has tested.
--
-- The queue lookup also matches on the address before it is scrubbed, so the
-- person's pending mail is removed rather than sent to an erased profile.

create or replace function public.admin_erase_user_data(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_claims int := 0;
  v_messages int := 0;
  v_items int := 0;
  v_drafts int := 0;
  v_mail int := 0;
  v_paths jsonb := '[]'::jsonb;
  v_email text;
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'BAD_INPUT');
  end if;

  select email into v_email from public.profiles where id = p_user_id;

  with doomed as (
    select im.storage_path
    from public.item_images im
    join public.items i on i.id = im.item_id
    where i.reporter_id = p_user_id
  ), queued as (
    insert into public.storage_deletion_queue (storage_path)
    select storage_path from doomed
    on conflict (storage_path) do nothing
    returning storage_path
  )
  select coalesce(jsonb_agg(storage_path), '[]'::jsonb) into v_paths from queued;

  with gone as (delete from public.claims where claimant_id = p_user_id returning id)
  select count(*) into v_claims from gone;

  with gone as (delete from public.claim_messages where sender_id = p_user_id returning id)
  select count(*) into v_messages from gone;

  delete from public.claim_drafts where lower(email) = lower(coalesce(v_email, '###'));
  get diagnostics v_drafts = row_count;

  with touched as (
    update public.items
       set reporter_id = null, contact_email = null, finder_email = null
     where reporter_id = p_user_id
    returning id
  ) select count(*) into v_items from touched;

  -- pending mail addressed to this person is deleted, not delivered
  with gone as (
    delete from public.email_outbox
     where lower(recipient_email) = lower(coalesce(v_email, '###'))
    returning id
  ) select count(*) into v_mail from gone;

  delete from public.saved_items where user_id = p_user_id;
  delete from public.saved_searches where user_id = p_user_id;
  delete from public.notifications where user_id = p_user_id;
  delete from public.conversation_reads where user_id = p_user_id;
  update public.abuse_reports
     set reporter_email = null,
         details = case when reason = 'account_deletion' then details else 'Erased at the request of the reporter.' end
   where reporter_id = p_user_id;
  delete from public.user_roles where user_id = p_user_id;

  update public.profiles
     set full_name = null, phone = null,
         marketing_opt_in = false, alerts_opt_in = false,
         email = concat('erased+', left(p_user_id::text, 8), '@erased.invalid')
   where id = p_user_id;

  insert into public.audit_logs (actor_id, action, resource_type, resource_id, detail, severity)
  values (auth.uid(), 'user_data_erased', 'user', p_user_id,
    jsonb_build_object('claims', v_claims, 'messages', v_messages, 'items', v_items,
      'photos', jsonb_array_length(v_paths), 'drafts', v_drafts, 'mail', v_mail),
    'alert');

  return jsonb_build_object('ok', true, 'claims', v_claims, 'messages', v_messages,
    'items', v_items, 'photoPaths', v_paths, 'drafts', v_drafts, 'mailDeleted', v_mail,
    'note', 'The auth.users row still holds the address; delete it from the dashboard or the admin API.');
end;
$$;

revoke all on function public.admin_erase_user_data(uuid) from public, anon;
grant execute on function public.admin_erase_user_data(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
