#!/usr/bin/env python3
"""
Applies every migration in supabase/migrations/ to a real Postgres and exercises
what 0032 (the custody timeline) claims to enforce.

    pip install pgserver
    python3 scripts/check-custody-timeline-migration.py

The environment shims, the two SQL rewrites and the harness itself are imported
from scripts/check-photo-matching-migration.py, so this proves the same thing
that one does — the whole chain still applies — and then walks the custody
timeline through the function, as the roles that would call it.

Two things are proved that a page cannot prove:
  * who is allowed to read it, and that a refused read is indistinguishable from
    a reference that does not exist;
  * that no claimant identity, answer, proof, decision reason, code or staff
    note appears anywhere in the payload.

What it does not prove: anything about a real Supabase project (PostgREST, the
session cookie) or that the page renders. `npm run smoke` covers the route's
guard against the mock; this covers the database.

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

# The bundled Postgres installs the pgcrypto shim into `public`; 0022's
# staff_decide_claim() names `extensions` explicitly. One more shim, in the
# schema the shipped SQL expects, and nothing else.
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


def no_session(body):
    """authenticated role, no JWT subject: the shape of an expired session."""
    return f"set role authenticated; select set_config('request.jwt.claim.sub', '', false); {body}"


def payload(uri, uid, ref):
    """The whole jsonb as text, for the leak checks."""
    return pm.value(uri, pm.as_user(uid, f"select public.item_custody_timeline('{ref}')::text;"))


def main():
    pm.install_shims()
    pgdata = tempfile.mkdtemp(prefix="lnf-custody-check-")
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
            f"insert into public.user_roles (user_id, role) values ('{U_STAFF}','staff')"
            " on conflict do nothing;",
        )
        assert code == 0, out

        # ---------------------------------------------------------------- shape
        pm.run(
            uri,
            "the timeline is a definer function, so RLS on items cannot hide the reporter's own row",
            "select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace"
            " where n.nspname = 'public' and p.proname = 'item_custody_timeline';",
            expect="t",
        )
        pm.run(
            uri,
            "anon has no execute grant",
            "select has_function_privilege('anon', 'public.item_custody_timeline(text)', 'execute');",
            expect="f",
        )
        pm.run(
            uri,
            "authenticated does",
            "select has_function_privilege('authenticated', 'public.item_custody_timeline(text)', 'execute');",
            expect="t",
        )
        pm.run(
            uri,
            "an anonymous caller cannot even reach it",
            anon("select public.item_custody_timeline('LF-2026-0001');"),
            expect_error="permission denied",
        )

        # ---------------------------------------------------------------- fixture
        # a found item handed in by the finder, claimed, approved and released.
        # accessories: no witness needed, so the handover is one call.
        ref = pm.item(uri, "found", "accessories", "Brown leather belt, brass buckle", "library", U_FINDER)
        pm.run(
            uri,
            "the claimant files a claim with proof text",
            pm.as_user(U_CLAIMANT, f"select public.submit_claim('{ref}', 'Brass-Buckle-2026', 'photo of the buckle')::text;"),
            expect='"ok": true',
        )
        claim_ref = pm.value(
            uri,
            f"select c.ref_code from public.claims c join public.items i on i.id = c.item_id"
            f" where i.ref_code = '{ref}';",
        )
        pm.run(
            uri,
            "staff approve it, with a reason that must never reach the owner",
            pm.as_user(
                U_STAFF,
                f"select public.staff_decide_claim('{claim_ref}', 'approve',"
                " 'Verified with the claimant Ananya Rao on the phone')::text;",
            ),
            expect='"status": "approved"',
        )
        code_plain = pm.value(
            uri,
            f"select hc.code_plain from public.handover_codes hc join public.claims c on c.id = hc.claim_id"
            f" join public.items i on i.id = c.item_id where i.ref_code = '{ref}';",
        )
        pm.run(
            uri,
            "the desk hands it over against that code, with a note that must not reach the owner",
            pm.as_user(
                U_STAFF,
                f"select public.staff_confirm_handover('{ref}', '{code_plain}',"
                " 'Handed to Ananya Rao at the desk, seen by Priya')::text;",
            ),
            expect='"ok": true',
        )

        # ---------------------------------------------------------------- refusals
        pm.run(
            uri,
            "a session with no subject is refused",
            no_session(f"select public.item_custody_timeline('{ref}')::text;"),
            expect='"error": "AUTH_REQUIRED"',
        )
        pm.run(
            uri,
            "an unknown reference is NOT_FOUND",
            pm.as_user(U_FINDER, "select public.item_custody_timeline('LF-9999-0000')::text;"),
            expect='"error": "NOT_FOUND"',
        )
        pm.run(
            uri,
            "someone else's item answers NOT_FOUND, not FORBIDDEN",
            pm.as_user(U_OTHER, f"select public.item_custody_timeline('{ref}')::text;"),
            expect='"error": "NOT_FOUND"',
        )
        pm.run(
            uri,
            "and that answer is identical to the unknown reference",
            "set role authenticated;"
            f" select set_config('request.jwt.claim.sub', '{U_OTHER}', false);"
            f" select public.item_custody_timeline('LF-9999-0000') is not distinct from"
            f" public.item_custody_timeline('{ref}');",
            expect="t",
        )

        # ---------------------------------------------------------------- the owner
        pm.run(
            uri,
            "the finder can read their own item's timeline",
            pm.as_user(U_FINDER, f"select public.item_custody_timeline('{ref}') ->> 'ok';"),
            expect="true",
        )
        pm.run(
            uri,
            "and is labelled as the owner, not staff",
            pm.as_user(U_FINDER, f"select public.item_custody_timeline('{ref}') ->> 'access';"),
            expect="owner",
        )
        pm.run(
            uri,
            "the reference is matched case-insensitively",
            pm.as_user(U_FINDER, f"select public.item_custody_timeline(lower('{ref}')) ->> 'ok';"),
            expect="true",
        )
        pm.run(
            uri,
            "the chain has the hand-in, the publish, the claim, the decision and the release",
            pm.as_user(U_FINDER, f"select public.item_custody_timeline('{ref}') -> 'steps';"),
            expect='"handed_in"',
        )
        for key in ("published", "claim_received", "claim_approved", "code_issued", "handed_over"):
            pm.run(
                uri,
                f"the chain carries the {key} step",
                pm.as_user(
                    U_FINDER,
                    f"select exists (select 1 from public.item_custody_timeline('{ref}') t,"
                    f" jsonb_array_elements(t -> 'steps') s where s ->> 'key' = '{key}');",
                ),
                expect="t",
            )
        pm.run(
            uri,
            "the claim step is a count of one, with no reference beside it",
            pm.as_user(
                U_FINDER,
                f"select s ->> 'count' from public.item_custody_timeline('{ref}') t,"
                " jsonb_array_elements(t -> 'steps') s where s ->> 'key' = 'claim_received';",
            ),
            expect="1",
        )
        pm.run(
            uri,
            "the item shape carries status and the retention date",
            pm.as_user(U_FINDER, f"select public.item_custody_timeline('{ref}') -> 'item' ->> 'status';"),
            expect="recovered",
        )
        # ---------------------------------------------------------------- no leaks
        body = payload(uri, U_FINDER, ref)
        for label, needle in [
            ("the claimant's account id", U_CLAIMANT),
            ("the claimant's email", "claimant@x.test"),
            ("the claim reference", claim_ref),
            ("the answer the claimant typed", "Brass-Buckle-2026"),
            ("the proof text", "photo of the buckle"),
            ("the staff decision reason", "Ananya Rao"),
            ("the collection code", code_plain),
            ("the code hash", "code_hash"),
            ("the claim id", "claim_id"),
            ("the witness field", "witness"),
            ("the handover note", "Handed to Ananya Rao"),
        ]:
            if not needle:
                continue
            pm.run(
                uri,
                f"the payload does not carry {label}",
                f"select position('{needle}' in $t${body}$t$);",
                expect="0",
            )

        # ---------------------------------------------------------------- staff
        pm.run(
            uri,
            "staff read the same timeline, labelled staff",
            pm.as_user(U_STAFF, f"select public.item_custody_timeline('{ref}') ->> 'access';"),
            expect="staff",
        )
        pm.run(
            uri,
            "and the owner reads it as owner, so the label is about the reader, not the row",
            "set role authenticated;"
            f" select set_config('request.jwt.claim.sub', '{U_FINDER}', false);"
            f" select public.item_custody_timeline('{ref}') ->> 'access';",
            expect="owner",
        )

        # ---------------------------------------------------------------- quarantine
        q_ref = pm.value(
            uri,
            pm.as_user(
                U_OTHER,
                "select public.create_item('found', 'documents', 'Aadhaar card in a plastic sleeve',"
                " 'Found near the library gate, name visible', 'library') ->> 'ref';",
            ),
        )
        pm.run(
            uri,
            "an identity document is quarantined at intake",
            f"select status from public.items where ref_code = '{q_ref}';",
            expect="quarantined",
        )
        pm.run(
            uri,
            "its owner sees a held step",
            pm.as_user(
                U_OTHER,
                f"select exists (select 1 from public.item_custody_timeline('{q_ref}') t,"
                " jsonb_array_elements(t -> 'steps') s where s ->> 'key' = 'held');",
            ),
            expect="t",
        )
        pm.run(
            uri,
            "and no published step, because it was never published",
            pm.as_user(
                U_OTHER,
                f"select exists (select 1 from public.item_custody_timeline('{q_ref}') t,"
                " jsonb_array_elements(t -> 'steps') s where s ->> 'key' = 'published');",
            ),
            expect="f",
        )

        # ---------------------------------------------------------------- lost
        lost_ref = pm.value(
            uri,
            pm.as_user(
                U_OTHER,
                "select public.create_item('lost', 'electronics', 'Grey laptop charger, 65W USB-C',"
                " 'Left in the reading room on Tuesday afternoon', 'library') ->> 'ref';",
            ),
        )
        pm.run(
            uri,
            "a lost report opens with the report itself",
            pm.as_user(
                U_OTHER,
                f"select (select s ->> 'key' from public.item_custody_timeline('{lost_ref}') t,"
                " jsonb_array_elements(t -> 'steps') s limit 1);",
            ),
            expect="reported",
        )

        # ---------------------------------------------------------------- dispute
        second = pm.item(uri, "found", "books", "Blue spiral notebook, first page missing", "canteen", U_FINDER)
        pm.run(
            uri,
            "a second claim is filed and rejected",
            pm.as_user(U_CLAIMANT, f"select public.submit_claim('{second}', 'wrong-answer', null)::text;"),
            expect='"ok": true',
        )
        second_claim = pm.value(
            uri,
            f"select c.ref_code from public.claims c join public.items i on i.id = c.item_id"
            f" where i.ref_code = '{second}';",
        )
        pm.run(
            uri,
            "staff reject it",
            pm.as_user(U_STAFF, f"select public.staff_decide_claim('{second_claim}', 'reject', 'Answer did not match')::text;"),
            expect='"status": "rejected"',
        )
        pm.run(
            uri,
            "the claimant asks for a second look",
            pm.as_user(
                U_CLAIMANT,
                f"select public.open_dispute('{second_claim}', 'The finder wrote a different answer on the sheet')::text;",
            ),
            expect='"ok": true',
        )
        pm.run(
            uri,
            "the finder sees that a second look exists, as a count",
            pm.as_user(
                U_FINDER,
                f"select s ->> 'count' from public.item_custody_timeline('{second}') t,"
                " jsonb_array_elements(t -> 'steps') s where s ->> 'key' = 'dispute_open';",
            ),
            expect="1",
        )
        second_body = payload(uri, U_FINDER, second)
        pm.run(
            uri,
            "and the dispute reason is not in it",
            f"select position('different answer on the sheet' in $t${second_body}$t$);",
            expect="0",
        )

        # ---------------------------------------------------------------- disposal
        third = pm.item(uri, "found", "clothing", "Navy blue umbrella with a broken rib", "sports", U_FINDER)
        pm.run(
            uri,
            "staff dispose of an unclaimed item",
            pm.as_user(U_STAFF, f"select public.dispose_item('{third}', 'donated', 'Unclaimed after 30 days')::text;"),
            expect='"ok": true',
        )
        pm.run(
            uri,
            "the finder sees what happened to it",
            pm.as_user(
                U_FINDER,
                f"select s ->> 'key' from public.item_custody_timeline('{third}') t,"
                " jsonb_array_elements(t -> 'steps') s where s ->> 'key' = 'disposed';",
            ),
            expect="disposed",
        )
        third_body = payload(uri, U_FINDER, third)
        pm.run(
            uri,
            "but not the staff note behind it",
            f"select position('Unclaimed after 30 days' in $t${third_body}$t$);",
            expect="0",
        )

        # ---------------------------------------------------------------- window
        fourth = pm.item(uri, "lost", "keys", "Two keys on a red carabiner", "sports", U_FINDER)
        pm.run(
            uri,
            "the window runs out",
            f"update public.items set status = 'expired', expires_at = now() - interval '1 day'"
            f" where ref_code = '{fourth}';",
        )
        pm.run(
            uri,
            "and the chain says so",
            pm.as_user(
                U_FINDER,
                f"select s ->> 'key' from public.item_custody_timeline('{fourth}') t,"
                " jsonb_array_elements(t -> 'steps') s where s ->> 'key' = 'window_closed';",
            ),
            expect="window_closed",
        )

        # ---------------------------------------------------------------- isolation
        pm.run(
            uri,
            "one reporter cannot read another reporter's timeline",
            pm.as_user(U_FINDER, f"select public.item_custody_timeline('{q_ref}') ->> 'error';"),
            expect="NOT_FOUND",
        )

        print()
        if pm.FAILS:
            print(f"{len(pm.FAILS)} CHECK(S) FAILED")
            for f in pm.FAILS:
                print(f"  - {f}")
            raise SystemExit(1)
        print("ALL CHECKS PASSED")
    finally:
        db.cleanup()


if __name__ == "__main__":
    main()
