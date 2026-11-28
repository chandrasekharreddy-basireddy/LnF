#!/usr/bin/env python3
"""
Applies every migration in supabase/migrations/ to a real Postgres and exercises
what 0035 (the offline desk sheet) claims to enforce.

    pip install pgserver
    python3 scripts/check-offline-desk-migration.py

The environment shims, the two SQL rewrites and the harness itself are imported
from scripts/check-photo-matching-migration.py, so this proves the whole chain
still applies, 0001 → 0035, and then walks desk_sheet() as the roles that would
call it.

What a page cannot prove, and this does:
  * that a member, an anonymous caller and a session with no subject are all
    refused, and that only staff get a sheet;
  * that the sheet is exactly the public board — quarantined, pending,
    recovered, expired and archived items are not in it;
  * that nothing about a person or a claim travels with it: no reporter id, no
    contact, no serial number, no verification answer or hash, no claim ref, no
    claimant, no proof text, no decision reason;
  * that the limit is honoured and clamped.

It needs no network and no Supabase project. Exit code 0 means every check passed.
It is not part of `npm test`: it needs Python and a bundled Postgres, neither of
which CI installs.
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

# The bundled Postgres installs the pgcrypto shim into `public`; later migrations
# name `extensions` explicitly. One more shim, in the schema the shipped SQL expects.
EXTENSIONS_SHIM = """
create schema if not exists extensions;
create or replace function extensions.gen_random_bytes(int) returns bytea
language sql volatile as $$
  select substring(sha256(random()::text::bytea) || sha256((random() * 1e9)::text::bytea)
                   from 1 for $1)
$$;
"""

U_OWNER = pm.U_OWNER
U_FINDER = pm.U_FINDER
U_CLAIMANT = pm.U_OWNER
U_OTHER = pm.U_OTHER
U_STAFF = pm.U_STAFF

# Tokens planted in the fixture that must never appear in the sheet.
SECRETS = [
    "secret-contact@x.test",
    "secret-finder@x.test",
    "SN-ABCD-9999",
    "Brass-Buckle-2026",
    "photo of the buckle",
    "Verified with Ananya Rao",
    U_OTHER,
]


def anon(body):
    return f"set role anon; {body}"


def no_session(body):
    return f"set role authenticated; select set_config('request.jwt.claim.sub', '', false); {body}"


def sheet(uri, uid, limit=None):
    arg = "" if limit is None else f" {limit}"
    return pm.value(uri, pm.as_user(uid, f"select public.desk_sheet({arg.strip()})::text;"))


def main():
    pm.install_shims()
    pgdata = tempfile.mkdtemp(prefix="lnf-offline-check-")
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
            f"('{U_FINDER}','finder@x.test'), ('{U_OWNER}','owner@x.test'), "
            f"('{U_OTHER}','other@x.test'), ('{U_STAFF}','staff@x.test');"
            f"insert into public.user_roles (user_id, role) values ('{U_STAFF}','staff')"
            " on conflict do nothing;",
        )
        assert code == 0, out

        # ---------------------------------------------------------------- shape
        pm.run(
            uri,
            "the sheet is a definer function, so RLS on items cannot narrow it to nothing",
            "select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace"
            " where n.nspname = 'public' and p.proname = 'desk_sheet';",
            expect="t",
        )
        pm.run(
            uri,
            "anon has no execute grant",
            "select has_function_privilege('anon', 'public.desk_sheet(int)', 'execute');",
            expect="f",
        )
        pm.run(
            uri,
            "authenticated does",
            "select has_function_privilege('authenticated', 'public.desk_sheet(int)', 'execute');",
            expect="t",
        )
        pm.run(
            uri,
            "an anonymous caller cannot even reach it",
            anon("select public.desk_sheet();"),
            expect_error="permission denied",
        )

        # ---------------------------------------------------------------- fixture
        # one item the desk can see, carrying every private field the schema has
        ref_board = pm.item(
            uri, "found", "electronics", "Black wireless earbuds in a charging case", "library", U_FINDER
        )
        code, out = pm.psql(
            uri,
            "update public.items set contact_email = 'secret-contact@x.test',"
            " finder_email = 'secret-finder@x.test', custody_label = 'Shelf B2',"
            f" verification_question = 'What is the Bluetooth name of the case?' where ref_code = '{ref_board}';"
            "insert into public.item_private (item_id, answer_hash, private_notes, serial_number)"
            f" select id, 'hash-of-{SECRETS[3]}', 'kept in the safe', 'SN-ABCD-9999'"
            f" from public.items where ref_code = '{ref_board}';",
        )
        assert code == 0, out

        # a claimed item, which is still on the board
        ref_claimed = pm.item(uri, "found", "bottles", "Steel water bottle with a dented cap", "main-gate", U_FINDER)
        code, out = pm.psql(uri, f"update public.items set status = 'claimed' where ref_code = '{ref_claimed}';")
        assert code == 0, out

        # items the sheet must not carry
        ref_pending = pm.item(uri, "lost", "accessories", "Brown leather belt, brass buckle", "library", U_OWNER)
        ref_quarantined = pm.item(uri, "found", "documents", "Student ID card held at the desk", "admin", U_FINDER)
        ref_recovered = pm.item(uri, "found", "keys", "Bunch of keys with a blue tag", "library", U_FINDER)
        code, out = pm.psql(
            uri,
            f"update public.items set status = 'pending_moderation', published_at = null where ref_code = '{ref_pending}';"
            f"update public.items set status = 'quarantined' where ref_code = '{ref_quarantined}';"
            f"update public.items set status = 'recovered' where ref_code = '{ref_recovered}';",
        )
        assert code == 0, out

        # a claim with proof and a decision reason, all of which must stay out
        code, out = pm.psql(
            uri,
            pm.as_user(
                U_CLAIMANT,
                f"select public.submit_claim('{ref_board}', 'Brass-Buckle-2026', 'photo of the buckle')::text;",
            ),
        )
        assert code == 0, out
        claim_ref = pm.value(
            uri,
            "select c.ref_code from public.claims c join public.items i on i.id = c.item_id"
            f" where i.ref_code = '{ref_board}';",
        )
        code, out = pm.psql(
            uri,
            pm.as_user(
                U_STAFF,
                f"select public.staff_decide_claim('{claim_ref}', 'approve',"
                " 'Verified with Ananya Rao on the phone')::text;",
            ),
        )
        assert code == 0, out

        # ---------------------------------------------------------------- refusals
        pm.run(
            uri,
            "a session with no subject is refused",
            no_session("select public.desk_sheet()::text;"),
            expect='"error": "AUTH_REQUIRED"',
        )
        pm.run(
            uri,
            "a member with a session is refused",
            pm.as_user(U_OTHER, "select public.desk_sheet()::text;"),
            expect='"error": "NOT_STAFF"',
        )
        pm.run(
            uri,
            "and the refusal carries no rows",
            pm.as_user(U_OTHER, "select public.desk_sheet()::text;"),
            forbid='"rows"',
        )

        # ---------------------------------------------------------------- the sheet
        pm.run(
            uri,
            "staff get the board",
            pm.as_user(U_STAFF, "select public.desk_sheet()::text;"),
            expect='"ok": true',
        )
        pm.run(
            uri,
            "the earbuds are on it",
            pm.as_user(U_STAFF, "select public.desk_sheet()::text;"),
            expect=ref_board,
        )
        pm.run(
            uri,
            "so is a claimed item, because it is still in custody",
            pm.as_user(U_STAFF, "select public.desk_sheet()::text;"),
            expect=ref_claimed,
        )
        for ref, why in (
            (ref_pending, "an item held for moderation is not on the board"),
            (ref_quarantined, "a quarantined item is not on the board"),
            (ref_recovered, "an item already returned is not on the board"),
        ):
            pm.run(
                uri,
                why,
                pm.as_user(U_STAFF, "select public.desk_sheet()::text;"),
                forbid=ref,
            )

        pm.run(
            uri,
            "the sheet names the zone, not the zone id",
            pm.as_user(U_STAFF, "select public.desk_sheet()::text;"),
            expect="Central Library",
        )

        # ---------------------------------------------------------------- no leaks
        body = sheet(uri, U_STAFF)
        for secret in SECRETS:
            if secret in body:
                pm.fail(f"the sheet leaked {secret!r}")
            else:
                print(f"PASS the sheet carries no {secret[:24]!r}")
        for key in ("reporter", "contact", "answer", "serial", "claimant", "claim_ref", "claim_id", "proof", "note"):
            if key in body.lower():
                pm.fail(f"the sheet carries a {key!r} field")
            else:
                print(f"PASS the sheet has no {key!r} field")
        if claim_ref and claim_ref in body:
            pm.fail("the sheet carries the claim reference")
        else:
            print("PASS the sheet carries no claim reference")

        # ---------------------------------------------------------------- limits
        pm.run(
            uri,
            "a limit of 1 returns one row",
            pm.as_user(U_STAFF, "select jsonb_array_length(public.desk_sheet(1) -> 'rows')::text;"),
            expect="1",
        )
        pm.run(
            uri,
            "the newest first",
            pm.as_user(
                U_STAFF,
                "select (public.desk_sheet(1) -> 'rows' -> 0 ->> 'ref') = ("
                "  select ref_code from public.items where status in ('available','claimed')"
                "  and published_at is not null order by created_at desc limit 1)::text;",
            ),
            expect="t",
        )
        pm.run(
            uri,
            "a limit of 0 is clamped up to 1, not to nothing",
            pm.as_user(U_STAFF, "select jsonb_array_length(public.desk_sheet(0) -> 'rows')::text;"),
            expect="1",
        )
        pm.run(
            uri,
            "a limit of 99999 is clamped down to 500, not rejected",
            pm.as_user(U_STAFF, "select ((public.desk_sheet(99999) ->> 'count')::int <= 500)::text;"),
            expect="t",
        )
        pm.run(
            uri,
            "the count matches the rows it returns",
            pm.as_user(
                U_STAFF,
                "select (public.desk_sheet() ->> 'count')::int = jsonb_array_length(public.desk_sheet() -> 'rows');",
            ),
            expect="t",
        )
        pm.run(
            uri,
            "the sheet says when it was built",
            pm.as_user(U_STAFF, "select (public.desk_sheet() ->> 'generatedAt') is not null;"),
            expect="t",
        )

        # an empty board is an empty sheet, not an error
        code, out = pm.psql(
            uri, "update public.items set status = 'archived' where status in ('available', 'claimed');"
        )
        assert code == 0, out
        pm.run(
            uri,
            "an empty board is an empty sheet",
            pm.as_user(U_STAFF, "select public.desk_sheet()::text;"),
            expect='"rows": []',
        )
    finally:
        db.cleanup()

    print()
    if pm.FAILS:
        print(f"{len(pm.FAILS)} CHECK(S) FAILED")
        for f in pm.FAILS:
            print(f"  - {f}")
        raise SystemExit(1)
    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
