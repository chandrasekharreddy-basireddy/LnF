-- Bootstrap the first staff/admin account.
-- Run in the Supabase SQL editor after that person has signed in once.
--
--   select public.bootstrap_role('someone@campus.edu', 'admin');
--
-- Safe to re-run; it never removes a role.

create or replace function public.bootstrap_role(p_email text, p_role text default 'admin')
returns text language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if p_role not in ('admin', 'staff', 'member') then
    return 'role must be admin, staff or member';
  end if;
  select id into v_id from public.profiles where lower(email) = lower(btrim(p_email));
  if v_id is null then
    return 'no account with that email yet — they must sign in once first';
  end if;
  insert into public.user_roles (user_id, role) values (v_id, p_role::public.app_role)
  on conflict do nothing;
  insert into public.audit_logs (action, resource_type, resource_id, detail, severity)
  values ('role_bootstrapped', 'user', v_id, jsonb_build_object('role', p_role), 'warn');
  return 'granted ' || p_role || ' to ' || p_email;
end;
$$;

revoke all on function public.bootstrap_role(text, text) from public, anon, authenticated;
grant execute on function public.bootstrap_role(text, text) to service_role;
