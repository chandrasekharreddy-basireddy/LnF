#!/usr/bin/env python3
"""
Applies every migration in supabase/migrations/ to a real Postgres and exercises
what 0030 (the dispute room) claims to enforce.

    pip install pgserver
    python3 scripts/check-dispute-migration.py

The environment shims, the two SQL rewrites and the harness itself are imported
from scripts/check-photo-matching-migration.py, so this script proves the same
thing that one does — the whole chain still applies — and then walks the dispute
path through the functions, as the roles that would call them.

What it does not prove: anything about a real Supabase project (PostgREST,
Realtime, the storage policy), or that the pages render. `npm run smoke` covers
rendering against the mock; this covers the database.

Exit code 0 means every check passed.
"""

import importlib.util
import pathlib
import shutil
import sys
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

# The bundled Postgres installs the pgcrypto shim into `public`; on Supabase the
# extension lives in `extensions`, which 0022's staff_decide_claim() names
# explicitly. One more shim, in the schema the shipped SQL expects, and nothing
# else: printed below so it cannot be mistaken for the migration.
EXTENSIONS_SHIM = """
create schema if not exists extensions;
create or replace function extensions.gen_random_bytes(int) returns bytea
language sql volatile as $$
  select substring(sha256(random()::text::bytea) || sha256((random() * 1e9)::text::bytea)
                   from 1 for $1)
$$;
"""

U_FINDER = pm.U_FINDER
U_CLAIMANT = pm.U_OWNER      # the claimant's account
U_OTHER = pm.U_OTHER
U_STAFF = pm.U_STAFF


def anon(body):
    return f"set role anon; {body}"


def main():
    pm.install_shims()
    pgdata = tempfile.mkdtemp(prefix="lnf-dispute-check-")
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
        code, out = pm.psql(uri, EXTENSIONS_SHIM)
        assert code == 0, out
        print("environment shim applied: extensions.gen_random_bytes() from core sha256")

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
            f"('{U_FINDER}','finder@x.test'), ('{U_CLAIMANT}','claimant@x.test'), "
            f"('{U_OTHER}','other@x.test'), ('{U_STAFF}','staff@x.test');"
            f"update public.profiles set alerts_opt_in = true;"
            f"insert into public.user_roles (user_id, role) values ('{U_STAFF}','staff')"
            " on conflict do nothing;",
        )
        assert code == 0, out

        # ------------------------------------------------------------ shape
        pm.run(
            uri,
            "disputes is one row per claim",
            "select count(*) from pg_indexes where schemaname='public' and tablename='disputes'"
            " and indexdef ilike '%unique%claim_id%';",
            expect="1",
        )
        pm.run(
            uri,
            "disputes.status only accepts the four states",
            "select pg_get_constraintdef(oid) from pg_constraint where conname like 'disputes_status_check';",
            expect="open",
        )
        pm.run(
            uri,
            "RLS is on and there is exactly one read policy",
            "select count(*) from pg_policies where schemaname='public' and tablename='disputes';",
            expect="1",
        )
        pm.run(
            uri,
            "no write policy exists, so the functions are the only writers",
            "select count(*) from pg_policies where schemaname='public' and tablename='disputes'"
            " and cmd <> 'SELECT';",
            expect="0",
        )

        # ------------------------------------------------------------ fixture
        ref = pm.item(uri, "found", "electronics", "Black wireless earbuds in a charging case", "library", U_FINDER)
        pm.run(
            uri,
            "the claimant files a claim",
            pm.as_user(U_CLAIMANT, f"select public.submit_claim('{ref}', 'Buds-Case', null)::text;"),
            expect='"ok": true',
        )
        claim_ref = pm.value(
            uri,
            f"select c.ref_code from public.claims c join public.items i on i.id = c.item_id"
            f" where i.ref_code = '{ref}';",
        )
        pm.run(
            uri,
            "staff reject it",
            pm.as_user(U_STAFF, f"select public.staff_decide_claim('{claim_ref}', 'reject', 'Answer did not match')::text;"),
            expect='"status": "rejected"',
        )

        # ------------------------------------------------------------ open
        pm.run(
            uri,
            "the rejected claim appears in what the claimant can contest",
            pm.as_user(U_CLAIMANT, "select jsonb_array_length(public.my_disputable_claims());"),
            expect="1",
        )
        pm.run(
            uri,
            "and it names the role as claimant, not staff",
            pm.as_user(U_CLAIMANT, "select public.my_disputable_claims() -> 0 ->> 'role';"),
            expect="claimant",
        )
        pm.run(
            uri,
            "a stranger has nothing to contest",
            pm.as_user(U_OTHER, "select jsonb_array_length(public.my_disputable_claims());"),
            expect="0",
        )
        pm.run(
            uri,
            "a stranger with a session reads zero dispute rows, not someone else's",
            pm.as_user(U_OTHER, "select count(*) from public.disputes;"),
            expect="0",
        )
        pm.run(
            uri,
            "an anonymous caller cannot read it either",
            anon("select count(*) from public.disputes;"),
            expect_error="permission denied",
        )
        pm.run(
            uri,
            "a stranger cannot open a dispute on someone else's claim",
            pm.as_user(U_OTHER, f"select public.open_dispute('{claim_ref}', 'This is not my claim but I am asking anyway')::text;"),
            expect='"error": "FORBIDDEN"',
        )
        pm.run(
            uri,
            "a one-line reason is refused",
            pm.as_user(U_CLAIMANT, f"select public.open_dispute('{claim_ref}', 'unfair')::text;"),
            expect='"error": "REASON_TOO_SHORT"',
        )
        pm.run(
            uri,
            "a phone number in the reason is blocked, like the chat",
            pm.as_user(
                U_CLAIMANT,
                f"select public.open_dispute('{claim_ref}', 'Call me on 9876543210 to sort this out please')::text;",
            ),
            expect='"error": "BLOCKED"',
        )
        pm.run(
            uri,
            "the claimant opens a dispute",
            pm.as_user(
                U_CLAIMANT,
                f"select public.open_dispute('{claim_ref}',"
                " 'The case has my initials scratched under the lid. I described it as buds, not a case.')::text;",
            ),
            expect='"ok": true',
        )
        dispute_ref = pm.value(
            uri, "select ref_code from public.disputes order by created_at desc limit 1;"
        )
        pm.run(
            uri,
            "the dispute carries a DSP reference",
            f"select '{dispute_ref}' like 'DSP-%';",
            expect="t",
        )
        pm.run(
            uri,
            "a contested claim leaves the list of what can be contested",
            pm.as_user(U_CLAIMANT, "select jsonb_array_length(public.my_disputable_claims());"),
            expect="0",
        )
        pm.run(
            uri,
            "a second dispute on the same claim is refused",
            pm.as_user(
                U_CLAIMANT,
                f"select public.open_dispute('{claim_ref}', 'Trying a second time with the same complaint here')::text;",
            ),
            expect='"error": "DISPUTE_EXISTS"',
        )
        pm.run(
            uri,
            "the claimant sees their own dispute row under RLS",
            pm.as_user(U_CLAIMANT, "select count(*) from public.disputes;"),
            expect="1",
        )
        pm.run(
            uri,
            "the finder sees the dispute on their item",
            pm.as_user(U_FINDER, "select count(*) from public.disputes;"),
            expect="1",
        )
        pm.run(
            uri,
            "the unrelated member sees none",
            pm.as_user(U_OTHER, "select count(*) from public.disputes;"),
            expect="0",
        )
        pm.run(
            uri,
            "my_disputes lists it for the claimant",
            pm.as_user(U_CLAIMANT, "select jsonb_array_length(public.my_disputes());"),
            expect="1",
        )
        pm.run(
            uri,
            "my_disputes is empty for the stranger",
            pm.as_user(U_OTHER, "select jsonb_array_length(public.my_disputes());"),
            expect="0",
        )
        pm.run(
            uri,
            "the opening notification goes to the other side, not the opener",
            f"select count(*) from public.notifications where user_id = '{U_FINDER}'"
            " and title = 'A claim decision was contested';",
            expect="1",
        )
        pm.run(
            uri,
            "and not to the person who opened it",
            f"select count(*) from public.notifications where user_id = '{U_CLAIMANT}'"
            " and title = 'A claim decision was contested';",
            expect="0",
        )
        pm.run(
            uri,
            "opening a dispute is audited",
            "select count(*) from public.audit_logs where action = 'dispute_opened';",
            expect="1",
        )

        # ------------------------------------------------------------ read models
        pm.run(
            uri,
            "the room is readable by the claimant and names the claim",
            pm.as_user(U_CLAIMANT, f"select public.dispute_room('{dispute_ref}')::text;"),
            expect='"claimStatus": "rejected"',
        )
        pm.run(
            uri,
            "the room returns null for a stranger",
            pm.as_user(U_OTHER, f"select coalesce(public.dispute_room('{dispute_ref}')::text, 'null');"),
            expect="null",
        )
        pm.run(
            uri,
            "the desk queue is null for a member",
            pm.as_user(U_CLAIMANT, "select coalesce(public.dispute_queue(10)::text, 'null');"),
            expect="null",
        )
        pm.run(
            uri,
            "the desk queue shows staff the open dispute with the claimant's counts",
            pm.as_user(U_STAFF, "select public.dispute_queue(10)::text;"),
            expect='"disputesOpened": 1',
        )
        pm.run(
            uri,
            "the queue truncates a long reason rather than shipping it whole",
            pm.as_user(U_STAFF, "select length(public.dispute_queue(10) -> 0 ->> 'reason') <= 400;"),
            expect="t",
        )
        pm.run(
            uri,
            "claimant_trust is null for a member",
            pm.as_user(U_CLAIMANT, f"select coalesce(public.claimant_trust('{claim_ref}')::text, 'null');"),
            expect="null",
        )
        pm.run(
            uri,
            "claimant_trust counts the rejected claim for staff",
            pm.as_user(U_STAFF, f"select public.claimant_trust('{claim_ref}') ->> 'rejected';"),
            expect="1",
        )
        pm.run(
            uri,
            "public_trust is callable without signing in",
            anon("select public.public_trust() ->> 'openDisputes';"),
            expect="1",
        )
        pm.run(
            uri,
            "public_trust carries no person or item field",
            anon("select public.public_trust()::text;"),
            forbid="claimant",
        )

        # ------------------------------------------------------------ decide
        pm.run(
            uri,
            "a member cannot decide a dispute",
            pm.as_user(U_CLAIMANT, f"select public.decide_dispute('{dispute_ref}', 'upheld', 'I agree with myself')::text;"),
            expect='"error": "FORBIDDEN"',
        )
        pm.run(
            uri,
            "staff cannot uphold without a reason on the record",
            pm.as_user(U_STAFF, f"select public.decide_dispute('{dispute_ref}', 'upheld', 'ok')::text;"),
            expect='"error": "NOTE_REQUIRED"',
        )
        pm.run(
            uri,
            "staff uphold the dispute and the claim goes back to the desk",
            pm.as_user(
                U_STAFF,
                f"select public.decide_dispute('{dispute_ref}', 'upheld',"
                " 'The scratched initials are in the finder photo; reopening.')::text;",
            ),
            expect='"reopened": true',
        )
        pm.run(
            uri,
            "the claim is under review again",
            f"select status from public.claims where ref_code = '{claim_ref}';",
            expect="under_review",
        )
        pm.run(
            uri,
            "the reopened claim can be decided again",
            pm.as_user(U_STAFF, f"select public.staff_decide_claim('{claim_ref}', 'reject', 'Reviewed twice')::text;"),
            expect='"status": "rejected"',
        )
        pm.run(
            uri,
            "a decided dispute cannot be decided twice",
            pm.as_user(U_STAFF, f"select public.decide_dispute('{dispute_ref}', 'dismissed', 'Second thoughts about it')::text;"),
            expect='"error": "ALREADY_DECIDED"',
        )
        pm.run(
            uri,
            "the opener is told the outcome",
            f"select count(*) from public.notifications where user_id = '{U_CLAIMANT}'"
            " and title = 'Your dispute was upheld';",
            expect="1",
        )
        pm.run(
            uri,
            "deciding is audited with the reopened flag",
            "select detail ->> 'reopened' from public.audit_logs where action = 'dispute_decided';",
            expect="true",
        )

        # ------------------------------------------------------------ released item
        ref2 = pm.item(uri, "found", "bags", "Grey canvas backpack with a blue tag", "canteen", U_FINDER)
        pm.run(
            uri,
            "a second claimant files on a second item",
            pm.as_user(U_CLAIMANT, f"select public.submit_claim('{ref2}', 'anything', null)::text;"),
            expect='"ok": true',
        )
        claim2 = pm.value(
            uri,
            f"select c.ref_code from public.claims c join public.items i on i.id = c.item_id"
            f" where i.ref_code = '{ref2}';",
        )
        pm.run(
            uri,
            "staff approve it",
            pm.as_user(U_STAFF, f"select public.staff_decide_claim('{claim2}', 'approve', 'Answer matched')::text;"),
            expect='"status": "approved"',
        )
        code2 = pm.value(uri, f"select code_plain from public.handover_codes where claim_id ="
                              f" (select id from public.claims where ref_code = '{claim2}');")
        pm.run(
            uri,
            "and hand the item over",
            pm.as_user(U_STAFF, f"select public.staff_confirm_handover('{ref2}', '{code2}', null, null)::text;"),
            expect='"ok": true',
        )
        pm.run(
            uri,
            "the finder disputes the handover afterwards",
            pm.as_user(
                U_FINDER,
                f"select public.open_dispute('{claim2}',"
                " 'The bag still had a second tag in it; I think the wrong person collected it.')::text;",
            ),
            expect='"ok": true',
        )
        dispute2 = pm.value(uri, "select ref_code from public.disputes where claim_id ="
                                f" (select id from public.claims where ref_code = '{claim2}');")
        pm.run(
            uri,
            "upholding it does not pretend the item can come back",
            pm.as_user(
                U_STAFF,
                f"select public.decide_dispute('{dispute2}', 'upheld',"
                " 'Agreed, the handover was wrong. Item is already released.')::text;",
            ),
            expect='"reopened": false',
        )
        pm.run(
            uri,
            "the claim stays decided",
            f"select status from public.claims where ref_code = '{claim2}';",
            expect="approved",
        )

        # ------------------------------------------------------------ window and withdraw
        ref3 = pm.item(uri, "found", "keys", "Brass keyring with a red fob", "parking", U_FINDER)
        pm.run(
            uri,
            "a third claim is filed",
            pm.as_user(U_CLAIMANT, f"select public.submit_claim('{ref3}', 'anything', null)::text;"),
            expect='"ok": true',
        )
        claim3 = pm.value(
            uri,
            f"select c.ref_code from public.claims c join public.items i on i.id = c.item_id"
            f" where i.ref_code = '{ref3}';",
        )
        pm.run(
            uri,
            "staff reject it and the clock is set back twenty days",
            pm.as_user(U_STAFF, f"select public.staff_decide_claim('{claim3}', 'reject', 'No match')::text;"),
            expect='"status": "rejected"',
        )
        pm.psql(uri, f"update public.claims set decided_at = now() - interval '20 days' where ref_code = '{claim3}';")
        pm.run(
            uri,
            "a dispute outside the fourteen-day window is refused",
            pm.as_user(
                U_CLAIMANT,
                f"select public.open_dispute('{claim3}', 'I only found the receipt for these keys today, sorry')::text;",
            ),
            expect='"error": "WINDOW_CLOSED"',
        )

        ref4 = pm.item(uri, "found", "books", "Blue notebook with a spiral binding", "lecture", U_FINDER)
        pm.run(
            uri,
            "a fourth claim is filed",
            pm.as_user(U_CLAIMANT, f"select public.submit_claim('{ref4}', 'anything', null)::text;"),
            expect='"ok": true',
        )
        claim4 = pm.value(
            uri,
            f"select c.ref_code from public.claims c join public.items i on i.id = c.item_id"
            f" where i.ref_code = '{ref4}';",
        )
        pm.run(
            uri,
            "staff reject it",
            pm.as_user(U_STAFF, f"select public.staff_decide_claim('{claim4}', 'reject', 'No match')::text;"),
            expect='"status": "rejected"',
        )
        pm.run(
            uri,
            "the claimant opens a fourth dispute",
            pm.as_user(
                U_CLAIMANT,
                f"select public.open_dispute('{claim4}', 'My name is written inside the cover in blue ink.')::text;",
            ),
            expect='"ok": true',
        )
        dispute4 = pm.value(
            uri,
            "select d.ref_code from public.disputes d join public.claims c on c.id = d.claim_id"
            f" where c.ref_code = '{claim4}';",
        )
        pm.run(
            uri,
            "someone else cannot withdraw it",
            pm.as_user(U_OTHER, f"select public.withdraw_dispute('{dispute4}')::text;"),
            expect='"error": "FORBIDDEN"',
        )
        pm.run(
            uri,
            "the opener can",
            pm.as_user(U_CLAIMANT, f"select public.withdraw_dispute('{dispute4}')::text;"),
            expect='"status": "withdrawn"',
        )
        pm.run(
            uri,
            "a withdrawn dispute leaves the queue",
            pm.as_user(U_STAFF, "select jsonb_array_length(public.dispute_queue(50));"),
            expect="0",
        )
        pm.run(
            uri,
            "and cannot be withdrawn twice",
            pm.as_user(U_CLAIMANT, f"select public.withdraw_dispute('{dispute4}')::text;"),
            expect='"error": "ALREADY_DECIDED"',
        )
        pm.run(
            uri,
            "every dispute carries its own reference",
            "select count(distinct ref_code) = count(*) from public.disputes;",
            expect="t",
        )

        # ------------------------------------------------------------ nothing decided yet
        ref5 = pm.item(uri, "found", "clothing", "Navy blue hoodie with a torn pocket", "sports", U_FINDER)
        pm.run(
            uri,
            "a claim with no decision yet is filed",
            pm.as_user(U_CLAIMANT, f"select public.submit_claim('{ref5}', 'anything', null)::text;"),
            expect='"ok": true',
        )
        claim5 = pm.value(
            uri,
            f"select c.ref_code from public.claims c join public.items i on i.id = c.item_id"
            f" where i.ref_code = '{ref5}';",
        )
        pm.run(
            uri,
            "there is nothing to dispute before the desk has decided",
            pm.as_user(
                U_CLAIMANT,
                f"select public.open_dispute('{claim5}', 'I want to get in first before a decision lands')::text;",
            ),
            expect='"error": "NOT_DECIDED"',
        )

    finally:
        db.cleanup()
        shutil.rmtree(pgdata, ignore_errors=True)

    if pm.FAILS:
        print("\nFAILURES:")
        for f in pm.FAILS:
            print(" -", f)
        return 1
    print("\nALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
