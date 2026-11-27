-- L&F :: 0016 the sign-in layer's own state
--
-- The identity tokens stay with Supabase Auth. What lives here is the part we
-- own: how often a code can be requested, a record that an address was proved,
-- and an audit trail that never stores the address in the clear.

alter table public.profiles
  add column if not exists email_verified_at timestamptz;

create table if not exists public.auth_events (
  id bigserial primary key,
  kind text not null check (kind in ('code_requested', 'code_verified', 'code_failed', 'code_throttled')),
  email_hash text not null,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists auth_events_created_idx on public.auth_events (created_at desc);
create index if not exists auth_events_kind_idx on public.auth_events (kind, created_at desc);

alter table public.auth_events enable row level security;
-- admin-only read; writes come from the functions below
create policy auth_events_read on public.auth_events for select to authenticated
  using (public.is_admin());
grant select on public.auth_events to authenticated;
revoke all on public.auth_events from anon;

-- ---------------------------------------------------------------- throttle
-- Called before a code is generated, so a leaked form cannot be used to send
-- unlimited mail. Two buckets: one per address, one per caller.
create or replace function public.check_signin_allowed(p_email text, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email_hash text := encode(digest(lower(btrim(coalesce(p_email, ''))), 'sha256'), 'hex');
  v_ip_hash text := case when p_ip is null then null
                         else encode(digest(p_ip, 'sha256'), 'hex') end;
  v_ok boolean;
begin
  v_ok := public.rate_limit('signin:email:' || v_email_hash, 5, interval '15 minutes');
  if not v_ok then
    return jsonb_build_object('allowed', false, 'reason', 'email');
  end if;

  if v_ip_hash is not null then
    v_ok := public.rate_limit('signin:ip:' || v_ip_hash, 20, interval '15 minutes');
    if not v_ok then
      return jsonb_build_object('allowed', false, 'reason', 'ip');
    end if;
  end if;

  return jsonb_build_object('allowed', true);
end;
$$;

-- ---------------------------------------------------------------- audit
create or replace function public.log_auth_event(p_kind text, p_email text, p_ip text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('code_requested', 'code_verified', 'code_failed', 'code_throttled') then
    return;
  end if;
  insert into public.auth_events (kind, email_hash, ip_hash)
  values (
    p_kind,
    encode(digest(lower(btrim(coalesce(p_email, ''))), 'sha256'), 'hex'),
    case when p_ip is null then null else encode(digest(p_ip, 'sha256'), 'hex') end
  );
end;
$$;

-- ---------------------------------------------------------------- proof
create or replace function public.mark_email_verified()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); end if;
  update public.profiles
     set email_verified_at = coalesce(email_verified_at, now())
   where id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

-- an anonymous visitor must be able to ask for a code and be throttled; the
-- functions expose no data, only a boolean and a hash-only audit row
revoke all on function public.check_signin_allowed(text, text) from public, authenticated;
revoke all on function public.log_auth_event(text, text, text) from public, authenticated;
revoke all on function public.mark_email_verified() from public, anon;

grant execute on function public.check_signin_allowed(text, text) to anon, authenticated, service_role;
grant execute on function public.log_auth_event(text, text, text) to anon, authenticated, service_role;
grant execute on function public.mark_email_verified() to authenticated, service_role;

notify pgrst, 'reload schema';
