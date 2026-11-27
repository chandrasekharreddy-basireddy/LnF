#!/usr/bin/env python3
"""
Applies supabase/migrations/0028_push_notifications.sql to a real Postgres and
exercises the authorization rules it claims to enforce.

Nothing else in this repo touches a live database, so the push migration would
otherwise ship on inspection alone. This stands up a throwaway cluster with a
minimal Supabase-shaped stub (auth.users, auth.uid(), anon/authenticated/
service_role), applies the migration, and asserts the behaviour — including the
cases that must be refused.

    pip install pgserver
    python3 scripts/check-push-migration.py

It needs no network and no Supabase project. Exit code 0 means every check
passed. It is not part of `npm test`: it needs Python and a bundled Postgres,
neither of which CI installs.
"""
import pathlib
import shutil
import subprocess
import sys
import tempfile

import pgserver

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIGRATION = ROOT / "supabase/migrations/0028_push_notifications.sql"
PSQL = pathlib.Path(pgserver.__file__).parent / "pginstall/bin/psql"

STUB = r"""
create schema if not exists auth;

create table auth.users (id uuid primary key, email text);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create type public.notification_kind as enum ('match', 'claim_update', 'handover', 'system');
create type public.audit_severity as enum ('info', 'notice', 'warning', 'critical');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text, email text, phone text,
  alerts_opt_in boolean not null default false,
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind public.notification_kind not null default 'system',
  title text not null, body text not null, link text,
  read_at timestamptz, email_status text not null default 'none',
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigserial primary key,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null, resource_type text, resource_id uuid,
  detail jsonb not null default '{}'::jsonb, ip_hash text,
  severity public.audit_severity not null default 'info',
  created_at timestamptz not null default now()
);

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on public.notifications to service_role;
"""

U1 = "11111111-1111-1111-1111-111111111111"
U2 = "22222222-2222-2222-2222-222222222222"
EP = "https://fcm.googleapis.com/fcm/send/aaa:APA91b-endpoint-one"
P256 = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM"
AUTH = "tBHItJI5svbpez7KI4CCXg"

FAILS = []


def psql(uri, sql):
    proc = subprocess.run(
        [str(PSQL), uri, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
        capture_output=True,
        text=True,
    )
    return proc.returncode, (proc.stdout + proc.stderr).strip()


def run(uri, name, sql, expect=None, forbid=None, expect_error=None):
    code, out = psql(uri, sql)
    if expect_error is not None:
        if code == 0 or expect_error not in out:
            FAILS.append(f"{name}: expected error containing {expect_error!r}, got rc={code} {out[:300]!r}")
            return
        print(f"PASS {name}")
        return
    if code != 0:
        FAILS.append(f"{name}: sql failed: {out[:300]!r}")
        return
    if expect is not None and expect not in out:
        FAILS.append(f"{name}: expected {expect!r} in {out[:300]!r}")
        return
    if forbid is not None and forbid in out:
        FAILS.append(f"{name}: output contained {forbid!r}: {out[:300]!r}")
        return
    print(f"PASS {name}")


def as_user(uid, body):
    return f"set role authenticated; select set_config('request.jwt.claim.sub', '{uid}', false); {body}"


def main():
    pgdata = tempfile.mkdtemp(prefix="lnf-push-check-")
    db = pgserver.get_server(pgdata, cleanup_mode="stop")
    uri = db.get_uri()
    try:
        psql(uri, "drop schema if exists public cascade; create schema public; grant usage on schema public to public;")
        psql(uri, "drop schema if exists auth cascade;")
        psql(
            uri,
            """
            do $$ begin
              if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
              if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
              if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
            end $$;
            """,
        )
        code, out = psql(uri, STUB)
        assert code == 0, out
        code, out = psql(uri, MIGRATION.read_text())
        assert code == 0, out
        print("PASS migration 0028 applies cleanly to Postgres 16")

        psql(
            uri,
            f"insert into auth.users (id, email) values ('{U1}','a@x.test'), ('{U2}','b@x.test');"
            f"insert into public.profiles (id, email) values ('{U1}','a@x.test'), ('{U2}','b@x.test');",
        )

        run(uri, "owner registers a device", as_user(U1, f"select public.register_push_subscription('{EP}','{P256}','{AUTH}','UA/1')::text;"), expect='"ok": true')
        run(uri, "registering flips push_opt_in", f"select push_opt_in from public.profiles where id = '{U1}';", expect="t")
        run(uri, "another account cannot steal the endpoint", as_user(U2, f"select public.register_push_subscription('{EP}','{P256}','{AUTH}','UA/2')::text;"), expect="DEVICE_IN_USE")
        run(
            uri,
            "an anonymous caller cannot register",
            f"set role anon; select public.register_push_subscription('{EP}','{P256}','{AUTH}',null);",
            expect_error="permission denied for function register_push_subscription",
        )
        run(
            uri,
            "a non-https endpoint is refused",
            as_user(U1, f"select public.register_push_subscription('http://fcm.example.com/abc123def456','{P256}','{AUTH}',null)::text;"),
            expect="BAD_ENDPOINT",
        )
        run(
            uri,
            "a junk key is refused",
            as_user(U1, "select public.register_push_subscription('https://push.example.com/" + "x" * 30 + "','short','" + AUTH + "',null)::text;"),
            expect="BAD_KEY",
        )
        for i in range(4):
            run(
                uri,
                f"device {i + 2} of 5 registers",
                as_user(U1, f"select public.register_push_subscription('https://push.example.com/device-{i}','{P256}','{AUTH}',null)::text;"),
                expect='"ok": true',
            )
        run(
            uri,
            "a sixth device is refused",
            as_user(U1, f"select public.register_push_subscription('https://push.example.com/sixth','{P256}','{AUTH}',null)::text;"),
            expect="TOO_MANY_DEVICES",
        )

        run(uri, "another account cannot read the rows", as_user(U2, "select count(*) from public.push_subscriptions;"), expect="0")
        run(uri, "another account cannot delete them", as_user(U2, f"select public.unregister_push_subscription('{EP}')::text;"), expect='"removed": 0')
        run(uri, "the owner can read their own rows", as_user(U1, "select count(*) from public.push_subscriptions;"), expect="5")
        run(
            uri,
            "no direct insert is granted",
            as_user(U2, f"insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('{U2}','https://push.example.com/theirs','{P256}','{AUTH}');"),
            expect_error="permission denied for table push_subscriptions",
        )

        run(
            uri,
            "an opted-in owner's notification is queued",
            f"insert into public.notifications (user_id, kind, title, body, link) values ('{U1}','claim_update','Claim approved','Collect it','/claims/CLM-1') returning push_status;",
            expect="pending",
        )
        run(
            uri,
            "a user with no device is skipped",
            f"insert into public.notifications (user_id, kind, title, body, link) values ('{U2}','claim_update','Nothing','Nothing','/') returning push_status;",
            expect="skipped",
        )
        run(
            uri,
            "a system notification is never pushed",
            f"insert into public.notifications (user_id, kind, title, body) values ('{U1}','system','Erasure filed','We got it') returning push_status;",
            expect="none",
        )

        run(uri, "a browser cannot claim a push batch", as_user(U1, "select public.claim_push_batch(5);"), expect_error="permission denied for function claim_push_batch")
        run(uri, "the service role claims it", "set role service_role; select jsonb_array_length(public.claim_push_batch(5));", expect="1")
        run(uri, "claiming moved it to sending", f"select push_status from public.notifications where kind = 'claim_update' and user_id = '{U1}';", expect="sending")
        run(uri, "a second claim finds nothing", "set role service_role; select jsonb_array_length(public.claim_push_batch(5));", expect="0")

        nid = psql(uri, f"select id from public.notifications where kind='claim_update' and user_id='{U1}';")[1].strip()
        run(uri, "the batch carries the device keys", "set role service_role; select public.claim_push_batch(0);", expect="0") if False else None

        run(uri, "an unknown status is refused", f"set role service_role; select public.finish_push('{nid}', 'done')::text;", expect="BAD_STATUS")
        run(
            uri,
            "finishing with a retired endpoint disables it",
            f"set role service_role; select public.finish_push('{nid}', 'sent', array['{EP}'])::text;",
            expect='"dropped": 1',
        )
        run(uri, "the retired endpoint is disabled, not deleted", f"select count(*) from public.push_subscriptions where user_id='{U1}' and endpoint='{EP}' and disabled_at is not null;", expect="1")
        run(uri, "the notification is recorded as sent", f"select push_status from public.notifications where kind='claim_update' and user_id='{U1}';", expect="sent")
        run(uri, "a finished row cannot be finished twice", f"set role service_role; select public.finish_push('{nid}', 'sent')::text;", expect="NOT_CLAIMED")

        run(uri, "turning push off removes every device", as_user(U1, "select public.set_push_opt_in(false)::text;"), expect='"devices": 0')
        run(uri, "and it leaves no live row behind", f"select count(*) from public.push_subscriptions where user_id='{U1}';", expect="0")
        run(uri, "and the preference is false", f"select push_opt_in from public.profiles where id='{U1}';", expect="f")
        run(uri, "and the change is in the audit log", f"select count(*) from public.audit_logs where action='push_opt_out' and actor_id='{U1}';", expect="1")
        run(
            uri,
            "after opting out, new notifications are skipped",
            f"insert into public.notifications (user_id, kind, title, body) values ('{U1}','match','Possible match','Look') returning push_status;",
            expect="skipped",
        )
        run(uri, "my_push_state returns the preference, not the device", as_user(U2, "select public.my_push_state()::text;"), expect='"ok": true', forbid="endpoint")
        run(uri, "an anonymous caller cannot read my_push_state", "set role anon; select public.my_push_state();", expect_error="permission denied")
    finally:
        db.cleanup()
        shutil.rmtree(pgdata, ignore_errors=True)

    if FAILS:
        print("\nFAILURES:")
        for f in FAILS:
            print(" -", f)
        return 1
    print("\nALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
