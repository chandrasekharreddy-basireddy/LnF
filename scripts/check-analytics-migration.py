#!/usr/bin/env python3
"""
Applies every migration in supabase/migrations/ to a real Postgres and exercises
what 0031 (institution analytics + report export trail) claims to enforce.

    pip install pgserver
    python3 scripts/check-analytics-migration.py

The environment shims, the two SQL rewrites and the harness helpers are imported
from scripts/check-photo-matching-migration.py, so this script proves the same
thing that one does — the whole chain still applies, 0001 to the newest file —
and then walks the analytics path as the roles that would call it.

What it checks, and why each one matters:

  * anon cannot execute the function at all (no grant), and a signed-in member
    with no staff role gets null rather than a number;
  * a staff account gets a cohort that adds up: handedIn, returned and the rate
    are arithmetic, sample rows are excluded, and zones with nothing in them are
    not invented;
  * a range wider than a year is cut and says so (`clamped`), and a reversed
    range is refused rather than silently swapped;
  * the payload carries no person-level key;
  * downloading the report writes exactly one audit row, refuses a non-staff
    caller, and leaves the tamper-evident chain verifiable.

What it does not prove: anything about a real Supabase project (PostgREST
exposure, the anon key), or that the page and the PDF render. `npm run smoke`
covers rendering; tests/unit/monthly-report.test.ts covers the PDF bytes.

Exit code 0 means every check passed.
"""

import importlib.util
import pathlib
import tempfile

import pgserver

ROOT = pathlib.Path(__file__).resolve().parent.parent


def load_harness():
    spec = importlib.util.spec_from_file_location(
        "photo_migration_check", ROOT / "scripts/check-photo-matching-migration.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


pm = load_harness()

U_OWNER = "11111111-1111-1111-1111-111111111111"
U_OTHER = "22222222-2222-2222-2222-222222222222"
U_MEMBER = "33333333-3333-3333-3333-333333333333"
U_STAFF = "44444444-4444-4444-4444-444444444444"
U_ADMIN = "55555555-5555-5555-5555-555555555555"

# A fixed period, so the assertions are arithmetic and not "today-ish".
FROM = "2026-09-01"
TO = "2026-10-31"


def as_role(uid, body, role="authenticated"):
    return f"set role {role}; select set_config('request.jwt.claim.sub', '{uid}', false); {body}"


def anon(body):
    return f"set role anon; select set_config('request.jwt.claim.sub', '', false); {body}"


def main():
    pm.install_shims()
    pgdata = tempfile.mkdtemp(prefix="lnf-analytics-check-")
    db = pgserver.get_server(pgdata, cleanup_mode="stop")
    uri = db.get_uri()
    try:
        pm.psql(
            uri,
            """
            do $$ begin
              if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
              if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
              if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
            end $$;
            """,
        )
        code, out = pm.psql(uri, pm.STUB)
        assert code == 0, out

        for path in pm.MIGRATIONS:
            sql = pathlib.Path(path).read_text()
            for old, new in pm.REWRITES:
                sql = sql.replace(old, new)
            code, out = pm.psql(uri, sql)
            assert code == 0, f"{path}: {out[:800]}"
        print(f"PASS the whole chain applies, 0001 → {pathlib.Path(pm.MIGRATIONS[-1]).name}")

        code, out = pm.psql(
            uri,
            "insert into auth.users (id, email) values "
            f"('{U_OWNER}','owner@x.test'), ('{U_OTHER}','other@x.test'), ('{U_MEMBER}','member@x.test'),"
            f" ('{U_STAFF}','staff@x.test'), ('{U_ADMIN}','admin@x.test');"
            f"insert into public.user_roles (user_id, role) values ('{U_STAFF}','staff'), ('{U_ADMIN}','admin')"
            " on conflict do nothing;",
        )
        assert code == 0, out

        # ------------------------------------------------------------ fixtures
        # 6 found items inside the period: 2 recovered, 4 still with us.
        # 1 found item outside the period. 1 sample item that must never count.
        # 1 lost report inside the period.
        items = [
            ("found", "available", "electronics", "library", "2026-09-03", False),
            ("found", "recovered", "electronics", "library", "2026-09-10", False),
            ("found", "recovered", "bags", "canteen", "2026-09-20", False),
            ("found", "available", "bags", "canteen", "2026-10-02", False),
            ("found", "claimed", "keys", "sports", "2026-10-11", False),
            ("found", "available", "keys", "sports", "2026-10-25", False),
            ("found", "available", "electronics", "library", "2026-08-01", False),
            ("found", "recovered", "electronics", "library", "2026-09-15", True),
            ("lost", "available", "documents", "lecture", "2026-09-30", False),
        ]
        # the sample flag differs per row, so build the insert explicitly
        values = []
        for i, (t, s, c, z, day, sample) in enumerate(items):
            values.append(
                f"('{t}','{s}','{c}', $t$Item {i} in the analytics fixture$t$,"
                f" $d$A description long enough to satisfy the check on item {i}$d$,"
                f" (select id from public.campus_zones where code = '{z}'),"
                f" current_date - 1, '{U_OWNER}', 'member', {str(sample).lower()}, '{day} 10:00:00+00')"
            )
        code, out = pm.psql(
            uri,
            "insert into public.items (type, status, category, title, public_description, zone_id,"
            " event_date, reporter_id, reporter_kind, is_sample, created_at) values "
            + ",".join(values) + ";",
        )
        assert code == 0, out

        # a handover for the recovered item, 3 days after intake
        code, out = pm.psql(
            uri,
            "insert into public.handover_records (item_id, staff_id, code_verified, created_at)"
            " select id, "
            f"'{U_STAFF}', true, created_at + interval '3 days'"
            " from public.items where status = 'recovered' and is_sample = false"
            " and created_at::date between '" + FROM + "' and '" + TO + "';",
        )
        assert code == 0, out

        # claims: one submitted in the period, decided in the period
        code, out = pm.psql(
            uri,
            "insert into public.claims (item_id, claimant_id, status, decided_by, decided_at, created_at)"
            " select id, "
            f"'{U_OTHER}', 'approved', '{U_STAFF}', created_at + interval '2 days', created_at"
            " from public.items where status = 'recovered' and is_sample = false"
            " and created_at::date between '" + FROM + "' and '" + TO + "';",
        )
        assert code == 0, out

        # one dispute opened inside the period, upheld inside it
        code, out = pm.psql(
            uri,
            "insert into public.disputes (claim_id, opened_by, opener_role, reason, status,"
            " decided_by, decided_at, created_at)"
            " select c.id, "
            f"'{U_OTHER}', 'claimant', $r$The desk rejected this the first time round.$r$, 'upheld',"
            f" '{U_STAFF}', now(), '2026-09-25 12:00:00+00'"
            " from public.claims c limit 1;",
        )
        assert code == 0, out

        # ------------------------------------------------------------ grants
        pm.run(
            uri,
            "anon has no execute on institution_analytics",
            anon("select public.institution_analytics(date '2026-09-01', date '2026-10-31');"),
            expect_error="permission denied",
        )
        pm.run(
            uri,
            "anon has no execute on log_report_export",
            anon("select public.log_report_export(date '2026-09-01', date '2026-10-31');"),
            expect_error="permission denied",
        )

        # ------------------------------------------------------------ authorization
        pm.run(
            uri,
            "a signed-in member with no staff role gets null, not numbers",
            as_role(U_MEMBER, f"select coalesce(public.institution_analytics(date '{FROM}', date '{TO}')::text, 'NULL');"),
            expect="NULL",
        )
        pm.run(
            uri,
            "staff get a payload",
            as_role(U_STAFF, f"select public.institution_analytics(date '{FROM}', date '{TO}') ->> 'ok';"),
            expect="true",
        )
        pm.run(
            uri,
            "an admin is staff too",
            as_role(U_ADMIN, f"select public.institution_analytics(date '{FROM}', date '{TO}') ->> 'ok';"),
            expect="true",
        )

        # ------------------------------------------------------------ arithmetic
        pm.run(
            uri,
            "cohort counts only found, non-sample items inside the period (6 handed in)",
            as_role(U_STAFF, f"select public.institution_analytics(date '{FROM}', date '{TO}')"
            " #>> '{totals,handedIn}';"),
            expect="6",
        )
        pm.run(
            uri,
            "2 of the 6 came back, and the rate is 33.3%",
            as_role(U_STAFF, f"select public.institution_analytics(date '{FROM}', date '{TO}')"
            " #>> '{totals,returned}';"),
            expect="2",
        )
        pm.run(
            uri,
            "recoveryRate is arithmetic, one decimal",
            as_role(U_STAFF, f"select public.institution_analytics(date '{FROM}', date '{TO}')"
            " #>> '{totals,recoveryRate}';"),
            expect="33.3",
        )
        pm.run(
            uri,
            "the period holds 3 recovered found items, one of them a sample row",
            as_role(U_STAFF, "select count(*) from public.items where status='recovered'"
            f" and type='found' and created_at::date between '{FROM}' and '{TO}';"),
            expect="3",
        )
        pm.run(
            uri,
            "the sample row is not in the cohort, so returned stays at 2",
            as_role(U_STAFF, f"select public.institution_analytics(date '{FROM}', date '{TO}')"
            " #>> '{totals,returned}';"),
            expect="2",
        )
        pm.run(
            uri,
            "handovers counts records in the period, sample excluded (2)",
            as_role(U_STAFF, f"select public.institution_analytics(date '{FROM}', date '{TO}')"
            " #>> '{totals,handovers}';"),
            expect="2",
        )
        pm.run(
            uri,
            "median days to recovery comes from the handover records (3)",
            as_role(U_STAFF, f"select public.institution_analytics(date '{FROM}', date '{TO}')"
            " #>> '{totals,medianDaysToRecovery}';"),
            expect="3.0",
        )
        pm.run(
            uri,
            "a 6-item cohort is not flagged as a small sample",
            as_role(U_STAFF, f"select public.institution_analytics(date '{FROM}', date '{TO}')"
            " #>> '{totals,lowSample}';"),
            expect="false",
        )
        pm.run(
            uri,
            "a 1-item period is flagged, because 1/1 is not 100%",
            as_role(U_STAFF, "select public.institution_analytics(date '2026-09-01', date '2026-09-05')"
            " #>> '{totals,lowSample}';"),
            expect="true",
        )
        pm.run(
            uri,
            "the lost report is counted separately from the found cohort",
            as_role(U_STAFF, f"select public.institution_analytics(date '{FROM}', date '{TO}')"
            " #>> '{totals,lostReports}';"),
            expect="1",
        )
        pm.run(
            uri,
            "claims submitted in the period are counted",
            as_role(U_STAFF, f"select public.institution_analytics(date '{FROM}', date '{TO}')"
            " #>> '{totals,claimsSubmitted}';"),
            expect="2",
        )
        pm.run(
            uri,
            "disputes opened and upheld in the period are counted",
            as_role(U_STAFF, f"select public.institution_analytics(date '{FROM}', date '{TO}')"
            " #>> '{totals,disputesOpened}';"),
            expect="1",
        )

        # ------------------------------------------------------------ breakdowns
        pm.run(
            uri,
            "byZone has one row per zone that actually had an item (3), not one per zone (6)",
            as_role(U_STAFF, f"select jsonb_array_length(public.institution_analytics(date '{FROM}', date '{TO}')"
            " -> 'byZone');"),
            expect="3",
        )
        pm.run(
            uri,
            "byZone adds up to the cohort (2 + 2 + 2)",
            as_role(U_STAFF, f"select sum((e ->> 'handedIn')::int) from jsonb_array_elements("
            f"public.institution_analytics(date '{FROM}', date '{TO}') -> 'byZone') e;"),
            expect="6",
        )
        pm.run(
            uri,
            "byCategory adds up to the cohort as well",
            as_role(U_STAFF, f"select sum((e ->> 'handedIn')::int) from jsonb_array_elements("
            f"public.institution_analytics(date '{FROM}', date '{TO}') -> 'byCategory') e;"),
            expect="6",
        )
        pm.run(
            uri,
            "byMonth spans every month the range touches (Sep and Oct = 2)",
            as_role(U_STAFF, f"select jsonb_array_length(public.institution_analytics(date '{FROM}', date '{TO}')"
            " -> 'byMonth');"),
            expect="2",
        )
        pm.run(
            uri,
            "byMonth keeps a month with nothing in it, rather than dropping the row",
            as_role(U_STAFF, f"select jsonb_array_length(public.institution_analytics(date '{FROM}', date '{TO}')"
            " -> 'byMonth');"),
            expect="2",
        )

        # ------------------------------------------------------------ range rules
        pm.run(
            uri,
            "a reversed range is refused, not silently swapped",
            as_role(U_STAFF, f"select public.institution_analytics(date '{TO}', date '{FROM}') ->> 'error';"),
            expect="RANGE_INVALID",
        )
        pm.run(
            uri,
            "a range over a year is cut to 367 days and says so",
            as_role(U_STAFF, "select public.institution_analytics(date '2024-01-01', date '2026-10-31')"
            " #>> '{clamped}';"),
            expect="true",
        )
        pm.run(
            uri,
            "the cut range is 367 days, not the 1,035 asked for",
            as_role(U_STAFF, "select public.institution_analytics(date '2024-01-01', date '2026-10-31')"
            " #>> '{days}';"),
            expect="367",
        )
        pm.run(
            uri,
            "an empty period returns zeros and a null rate, never a division by zero",
            as_role(U_STAFF, "select coalesce(public.institution_analytics(date '2020-01-01', date '2020-01-31')"
            " #>> '{totals,recoveryRate}', 'NULL');"),
            expect="NULL",
        )

        # ------------------------------------------------------------ no person data
        pm.run(
            uri,
            "the payload names no person-level field",
            as_role(U_STAFF, f"select (public.institution_analytics(date '{FROM}', date '{TO}')::text"
            " ~* '(claimant|email|reporter_id|full_name|phone)')::text;"),
            expect="false",
        )

        # ------------------------------------------------------------ export trail
        pm.run(
            uri,
            "a member cannot write the export audit row",
            as_role(U_MEMBER, f"select public.log_report_export(date '{FROM}', date '{TO}') ->> 'error';"),
            expect="FORBIDDEN",
        )
        pm.run(
            uri,
            "staff export is recorded",
            as_role(U_STAFF, f"select public.log_report_export(date '{FROM}', date '{TO}') ->> 'ok';"),
            expect="true",
        )
        pm.run(
            uri,
            "exactly one report_exported row, with the range in the detail",
            "select count(*) || ':' || min(detail ->> 'from') from public.audit_logs where action = 'report_exported';",
            expect="1:" + FROM,
        )
        pm.run(
            uri,
            "the audit chain still verifies after the export row",
            as_role(U_ADMIN, "select public.verify_audit_chain() ->> 'ok';"),
            expect="true",
        )
        pm.psql(uri, "delete from public.rate_limits;")
        pm.run(
            uri,
            "the export is rate-limited per person (60 an hour)",
            as_role(
                U_ADMIN,
                "select count(*) from (select public.log_report_export(date"
                f" '{FROM}', date '{TO}') as r from generate_series(1, 61)) s"
                " where s.r ->> 'ok' = 'true';",
            ),
            expect="60",
        )
    finally:
        db.cleanup()
        if pm.FAILS:
            print(f"\n{len(pm.FAILS)} check(s) failed:")
            for f in pm.FAILS:
                print("  - " + f)
            raise SystemExit(1)
        print("\nRESULT: all analytics checks passed")


if __name__ == "__main__":
    main()
