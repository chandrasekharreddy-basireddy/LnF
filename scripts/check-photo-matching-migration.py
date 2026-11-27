#!/usr/bin/env python3
"""
Applies every migration in supabase/migrations/ to a real Postgres and exercises
what 0029 (photo-similarity matching) claims to enforce.

The repo's other database check (scripts/check-push-migration.py) stubs only the
tables its migration touches. This one applies the whole chain in order, 0001 to
0029, because 0029 replaces refresh_matches(), whose live body comes from 0003 and
is called by four later migrations: applying the chain is the only way to prove
the new body drops in without a signature or column conflict.

    pip install pgserver
    python3 scripts/check-photo-matching-migration.py

Two environment shims, and nothing else, are applied to the shipped SQL:

  1. the bundled Postgres has no contrib modules, so pg_trgm and pgcrypto are
     installed as shims (similarity() as exact trigram Jaccard, digest() on top of
     core sha256). Assertions never depend on the value of similarity(); they use
     identical strings, and check the photo term as a delta.
  2. the GIN trigram index in 0001 and the enum-typed seed INSERT in 0004 are
     rewritten to plain equivalents the shim can execute. Both rewrites are printed
     so they cannot be mistaken for the shipped text.

It needs no network and no Supabase project. Exit code 0 means every check passed.
It is not part of `npm test`: it needs Python and a bundled Postgres, neither of
which CI installs.
"""
import glob
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

import pgserver

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS = sorted(glob.glob(str(ROOT / "supabase/migrations/*.sql")))
SHARE = pathlib.Path(pgserver.__file__).parent / "pginstall/share/postgresql/extension"
PSQL = pathlib.Path(pgserver.__file__).parent / "pginstall/bin/psql"

TRGM_SHIM = r"""
create function similarity(text, text) returns real language sql immutable as $$
  with a as (
    select distinct t from (
      select substr(x, i, 3) as t
      from (select '  ' || regexp_replace(lower($1), '\s+', ' ', 'g') || '  ' as x) s,
           generate_series(1, greatest(length(s.x) - 2, 0)) i
    ) q where t is not null
  ), b as (
    select distinct t from (
      select substr(x, i, 3) as t
      from (select '  ' || regexp_replace(lower($2), '\s+', ' ', 'g') || '  ' as x) s,
           generate_series(1, greatest(length(s.x) - 2, 0)) i
    ) q where t is not null
  )
  select case when (select count(*) from a) + (select count(*) from b) = 0 then 0::real
    else ((select count(*) from (select t from a intersect select t from b) x)::real /
          (select count(*) from (select t from a union select t from b) x)::real) end
$$;
"""

CRYPTO_SHIM = r"""
create function digest(bytea, text) returns bytea language sql immutable as $$
  select case lower($2)
    when 'sha256' then sha256($1)
    when 'md5' then decode(md5(encode($1, 'hex')), 'hex')
    else null end
$$;
create function digest(text, text) returns bytea language sql immutable as $$
  select digest(convert_to($1, 'utf8'), $2)
$$;
create function gen_random_bytes(int) returns bytea language sql volatile as $$
  select substring(sha256(random()::text::bytea) || sha256((random() * 1e9)::text::bytea) from 1 for $1)
$$;
"""

STUB = r"""
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

create table auth.users (
  id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user)
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now()
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name, '/')
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
"""

# 0001 creates a GIN trigram index and 0004 seeds with an unaliased VALUES list;
# neither runs against the shim. Both are replaced with plain equivalents.
REWRITES = [
    ("using gin (title gin_trgm_ops)", "using btree (title)"),
    (
        "select *\nfrom (values",
        """select seed.type::public.item_type, seed.status::public.item_status, seed.category::text,
  seed.title::text, seed.public_description::text, seed.zone_id::uuid, seed.spot::text,
  seed.event_date::date, seed.custody_label::text, seed.verification_question::text,
  seed.reporter_id::uuid, seed.reporter_kind::text, seed.is_sample::boolean, seed.published_at::timestamptz
from (values""",
    ),
]

U_OWNER = "11111111-1111-1111-1111-111111111111"
U_FINDER = "22222222-2222-2222-2222-222222222222"
U_OTHER = "33333333-3333-3333-3333-333333333333"
U_STAFF = "44444444-4444-4444-4444-444444444444"
U_STAFF2 = "55555555-5555-5555-5555-555555555555"

FAILS = []


def psql(uri, sql):
    proc = subprocess.run(
        [str(PSQL), uri, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
        capture_output=True,
        text=True,
    )
    return proc.returncode, (proc.stdout + proc.stderr).strip()


def check(name, ok):
    if ok:
        print(f"PASS {name}")
    else:
        fail(f"{name}: assertion did not hold")


def fail(msg):
    FAILS.append(msg)
    print(f"FAIL {msg}")


TAG = re.compile(r"^(INSERT|UPDATE|DELETE|SELECT|SET|BEGIN|COMMIT|ROLLBACK)\b")


def meaningful(out):
    """psql -At still prints the command tag; compare against the value only."""
    return "\n".join(l for l in out.splitlines() if l.strip() and not TAG.match(l.strip()))


def run(uri, name, sql, expect=None, forbid=None, expect_error=None):
    code, out = psql(uri, sql)
    if expect_error is not None:
        if code == 0 or expect_error not in out:
            fail(f"{name}: expected error containing {expect_error!r}, got rc={code} {out[:300]!r}")
            return
        print(f"PASS {name}")
        return
    if code != 0:
        fail(f"{name}: sql failed: {out[:300]!r}")
        return
    out = meaningful(out)
    if expect is not None and expect not in out:
        fail(f"{name}: expected {expect!r} in {out[:300]!r}")
        return
    if forbid is not None and forbid in out:
        fail(f"{name}: output contained {forbid!r}: {out[:300]!r}")
        return
    print(f"PASS {name}")


def as_user(uid, body):
    return f"set role authenticated; select set_config('request.jwt.claim.sub', '{uid}', false); {body}"


def value(uri, sql):
    code, out = psql(uri, sql)
    if code != 0:
        return ""
    lines = meaningful(out).splitlines()
    return lines[-1].strip() if lines else ""


def install_shims():
    SHARE.mkdir(parents=True, exist_ok=True)
    (SHARE / "pg_trgm.control").write_text(
        "comment = 'trigram shim: similarity() only, for the local schema check'\n"
        "default_version = '1.6'\nrelocatable = true\n"
    )
    (SHARE / "pg_trgm--1.6.sql").write_text(TRGM_SHIM)
    (SHARE / "pgcrypto.control").write_text(
        "comment = 'crypto shim: digest() and gen_random_bytes() on core sha256'\n"
        "default_version = '1.3'\nrelocatable = true\n"
    )
    (SHARE / "pgcrypto--1.3.sql").write_text(CRYPTO_SHIM)


def item(uri, kind, category, title, zone, reporter, days_ago=0):
    sql = (
        "insert into public.items (type, status, category, title, public_description, zone_id,"
        " event_date, reporter_id, reporter_kind, published_at) values ("
        f"'{kind}', 'available', '{category}', $t${title}$t$,"
        f" $d$A description long enough to satisfy the check on {title}$d$,"
        f" (select id from public.campus_zones where code = '{zone}'),"
        f" current_date - {days_ago}, '{reporter}', 'member', now()) returning ref_code;"
    )
    return value(uri, sql)


def add_image(uri, ref, path, phash=None):
    sql = (
        "insert into public.item_images (item_id, storage_path, alt_text, position) "
        f"select id, '{path}', 'a photo of the item', 0 from public.items where ref_code = '{ref}';"
    )
    code, out = psql(uri, sql)
    assert code == 0, out
    if phash is not None:
        code, out = psql(uri, f"update public.item_images set phash = {phash} where storage_path = '{path}';")
        assert code == 0, out


def main():
    install_shims()
    print("environment rewrites applied to the shipped SQL:")
    for old, new in REWRITES:
        print(f"  - {old.splitlines()[0][:60]!r} -> {new.splitlines()[0][:60]!r}")
    pgdata = tempfile.mkdtemp(prefix="lnf-photo-check-")
    db = pgserver.get_server(pgdata, cleanup_mode="stop")
    uri = db.get_uri()
    try:
        psql(
            uri,
            """
            do $$ begin
              if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
              if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
              if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
            end $$;
            """,
        )
        code, out = psql(uri, STUB)
        assert code == 0, out

        for path in MIGRATIONS:
            sql = pathlib.Path(path).read_text()
            for old, new in REWRITES:
                sql = sql.replace(old, new)
            code, out = psql(uri, sql)
            assert code == 0, f"{path}: {out[:800]}"
        print(f"PASS the whole chain applies, 0001 → {pathlib.Path(MIGRATIONS[-1]).name}")

        code, out = psql(
            uri,
            "insert into auth.users (id, email) values "
            f"('{U_OWNER}','owner@x.test'), ('{U_FINDER}','finder@x.test'), "
            f"('{U_OTHER}','other@x.test'), ('{U_STAFF}','staff@x.test'), ('{U_STAFF2}','staff2@x.test');"
            f"update public.profiles set alerts_opt_in = true where id = '{U_OWNER}';"
            f"insert into public.user_roles (user_id, role) values ('{U_STAFF}','staff'), ('{U_STAFF2}','staff')"
            " on conflict do nothing;",
        )
        assert code == 0, out

        # ---------------------------------------------------------------- shape
        run(
            uri,
            "item_images.phash exists as a nullable bigint",
            "select data_type || ':' || is_nullable from information_schema.columns"
            " where table_schema='public' and table_name='item_images' and column_name='phash';",
            expect="bigint:YES",
        )
        run(
            uri,
            "match_alerts carries the explanation columns",
            "select count(*) from information_schema.columns where table_schema='public'"
            " and table_name='match_alerts' and column_name in ('title_score','photo_score','photo_distance','updated_at');",
            expect="4",
        )
        run(uri, "photo_distance(0, 0) is 0", "select public.photo_distance(0, 0);", expect="0")
        run(uri, "photo_distance counts every differing bit", "select public.photo_distance(0, -1);", expect="64")
        run(
            uri,
            "photo_distance is a plain XOR popcount on the signed pattern",
            "select public.photo_distance(x'00000000000000ff'::bit(64)::bigint, 0);",
            expect="8",
        )

        # ---------------------------------------------------------------- hashes
        # a listing reported by U_OWNER, with one photo uploaded under their own folder
        ref_a = item(uri, "found", "electronics", "Black wireless earbuds in a charging case", "library", U_OWNER)
        path_own = f"{U_OWNER}/{ref_a}/1700000000-0.webp"
        add_image(uri, ref_a, path_own)
        # and one reported by someone else, to prove the reporter check bites
        ref_other = item(uri, "found", "accessories", "Brown leather belt, brass buckle", "library", U_FINDER)

        run(
            uri,
            "the uploader's own path is refused for someone else",
            as_user(U_OTHER, f"select public.set_item_photo_hash('{path_own}', '42')::text;"),
            expect="FORBIDDEN",
        )
        run(
            uri,
            "the listing owner cannot hash a photo in someone else's folder",
            as_user(U_OWNER, f"select public.set_item_photo_hash('{U_FINDER}/{ref_other}/1.webp', '42')::text;"),
            expect="NOT_FOUND",
        )
        run(
            uri,
            "an unknown path is refused",
            as_user(U_OWNER, f"select public.set_item_photo_hash('{U_OWNER}/none/1.webp', '42')::text;"),
            expect="NOT_FOUND",
        )
        run(
            uri,
            "a hash that is not a 64-bit pattern is refused",
            as_user(U_OWNER, f"select public.set_item_photo_hash('{path_own}', 'not-a-hash')::text;"),
            expect="BAD_HASH",
        )
        run(
            uri,
            "an empty hash is refused",
            as_user(U_OWNER, f"select public.set_item_photo_hash('{path_own}', '')::text;"),
            expect="BAD_HASH",
        )
        run(
            uri,
            "an anonymous caller cannot write a hash",
            f"set role anon; select public.set_item_photo_hash('{path_own}', '42');",
            expect_error="permission denied for function set_item_photo_hash",
        )
        run(
            uri,
            "the listing owner can write a hash for their own upload",
            as_user(U_OWNER, f"select public.set_item_photo_hash('{path_own}', '1234567890123')::text;"),
            expect='"ok": true',
        )
        run(
            uri,
            "and it landed",
            f"select phash from public.item_images where storage_path = '{path_own}';",
            expect="1234567890123",
        )
        add_image(uri, ref_a, f"{U_OTHER}/{ref_a}/1700000000-9.webp")
        run(
            uri,
            "a caller cannot hash a photo attached to someone else's listing",
            as_user(U_OTHER, f"select public.set_item_photo_hash('{U_OTHER}/{ref_a}/1700000000-9.webp', '42')::text;"),
            expect="FORBIDDEN",
        )
        run(
            uri,
            "a negative pattern (bit 63 set) is accepted and round-trips",
            as_user(U_OWNER, f"select public.set_item_photo_hash('{path_own}', '-1')::text;"),
            expect='"ok": true',
        )
        run(
            uri,
            "and it is stored as the same 64 bits",
            f"select public.photo_distance(phash, -1) from public.item_images where storage_path = '{path_own}';",
            expect="0",
        )

        # ---------------------------------------------------------------- column grant
        run(
            uri,
            "a browser cannot post its own hash",
            as_user(
                U_OWNER,
                "insert into public.item_images (item_id, storage_path, alt_text, phash)"
                f" select id, '{U_OWNER}/x/9.webp', 'sneaky photo', 7 from public.items where ref_code = '{ref_a}';",
            ),
            expect_error="permission denied",
        )
        run(
            uri,
            "but the ordinary photo insert still works",
            as_user(
                U_OWNER,
                "insert into public.item_images (item_id, storage_path, alt_text, width, height, position)"
                f" select id, '{U_OWNER}/{ref_a}/1700000001-0.webp', 'a normal photo', 640, 480, 1"
                f" from public.items where ref_code = '{ref_a}' returning storage_path;",
            ),
            expect=f"{U_OWNER}/{ref_a}/1700000001-0.webp",
        )

        # ---------------------------------------------------------------- scoring
        # a pair that matches on text but has no photos at all
        lost_1 = item(uri, "lost", "other", "Grey canvas tote bag left in the canteen queue", "canteen", U_OWNER)
        found_1 = item(uri, "found", "other", "Blue denim jacket, size medium", "library", U_FINDER)
        psql(uri, f"select public.refresh_matches((select id from public.items where ref_code = '{lost_1}'));")
        base_1 = value(
            uri,
            "select score from public.match_alerts m join public.items l on l.id = m.lost_item_id"
            f" where l.ref_code = '{lost_1}';",
        )
        run(uri, "a text-only pair still scores", "select ('" + base_1 + "' <> '')::text;", expect="true")
        run(
            uri,
            "with no photos the photo columns stay null",
            "select coalesce(photo_distance::text, 'null') from public.match_alerts m"
            f" join public.items l on l.id = m.lost_item_id where l.ref_code = '{lost_1}';",
            expect="null",
        )

        # now give both listings the same photo
        add_image(uri, lost_1, f"{U_OWNER}/{lost_1}/1700000002-0.webp", phash=987654321)
        add_image(uri, found_1, f"{U_FINDER}/{found_1}/1700000002-0.webp", phash=987654321)
        run(
            uri,
            "the owner can re-score their own listing",
            as_user(U_OWNER, f"select public.recompute_item_matches('{lost_1}')::text;"),
            expect='"ok": true',
        )
        scored = value(
            uri,
            "select score || '|' || photo_distance || '|' || photo_score from public.match_alerts m"
            f" join public.items l on l.id = m.lost_item_id where l.ref_code = '{lost_1}';",
        )
        photo_dist, photo_score, total = scored.split("|")[1], scored.split("|")[2], scored.split("|")[0]
        delta = round(float(total) - float(base_1), 3)
        run(
            uri,
            f"an identical photo adds exactly the documented 0.35 (got {delta})",
            f"select ({delta} = 0.35)::text;",
            expect="true",
        )
        run(uri, "and the distance is recorded as 0", "select " + photo_dist + ";", expect="0")
        run(uri, "and photo_score is 1.000", "select " + photo_score + ";", expect="1.000")

        # a pair that shares nothing but the photo
        lost_2 = item(uri, "lost", "clothing", "Blue denim jacket, size medium", "library", U_OWNER)
        found_2 = item(uri, "found", "electronics", "Compact camera with a cracked screen", "parking", U_FINDER)
        add_image(uri, lost_2, f"{U_OWNER}/{lost_2}/1700000003-0.webp", phash=1099511627776)
        add_image(uri, found_2, f"{U_FINDER}/{found_2}/1700000003-0.webp", phash=1099511627776)
        psql(uri, f"select public.refresh_matches((select id from public.items where ref_code = '{found_2}'));")
        run(
            uri,
            "a photo-only pair is allowed past the category and title gate",
            "select count(*) from public.match_alerts m join public.items l on l.id = m.lost_item_id"
            f" join public.items f on f.id = m.found_item_id where l.ref_code = '{lost_2}' and f.ref_code = '{found_2}';",
            expect="1",
        )
        run(
            uri,
            "and it scores above the alert threshold",
            "select (score >= 0.35)::text from public.match_alerts m join public.items l on l.id = m.lost_item_id"
            f" where l.ref_code = '{lost_2}';",
            expect="true",
        )

        # a pair that shares nothing, including the photo
        lost_3 = item(uri, "lost", "clothing", "Navy woollen scarf with a frayed end", "library", U_OWNER)
        found_3 = item(uri, "found", "electronics", "USB-C charger brick, white", "parking", U_FINDER)
        add_image(uri, lost_3, f"{U_OWNER}/{lost_3}/1700000004-0.webp", phash=0)
        add_image(uri, found_3, f"{U_FINDER}/{found_3}/1700000004-0.webp", phash=(-1) & 0xFFFFFFFFFF)
        psql(uri, f"select public.refresh_matches((select id from public.items where ref_code = '{found_3}'));")
        run(
            uri,
            "unrelated photos and unrelated text produce no alert",
            "select count(*) from public.match_alerts m join public.items l on l.id = m.lost_item_id"
            f" where l.ref_code = '{lost_3}';",
            expect="0",
        )

        # best photo wins when a listing has several
        lost_4 = item(uri, "lost", "other", "A tote bag, grey canvas, canteen queue", "canteen", U_OWNER)
        found_4 = item(uri, "found", "other", "Tote bag, grey, left at the counter", "library", U_FINDER)
        add_image(uri, lost_4, f"{U_OWNER}/{lost_4}/1700000005-0.webp", phash=0)
        add_image(uri, lost_4, f"{U_OWNER}/{lost_4}/1700000005-1.webp", phash=255)
        add_image(uri, found_4, f"{U_FINDER}/{found_4}/1700000005-0.webp", phash=255)
        # a photo that was never hashed (an older listing, or a failed hash)
        found_5 = item(uri, "found", "accessories", "Blue umbrella, wooden handle", "library", U_FINDER)
        add_image(uri, found_5, f"{U_FINDER}/{found_5}/1700000006-0.webp")
        run(
            uri,
            "the closest pair of photos is the one that counts",
            f"select public.item_photo_distance("
            f"(select id from public.items where ref_code = '{lost_4}'),"
            f"(select id from public.items where ref_code = '{found_4}'));",
            expect="0",
        )
        run(
            uri,
            "and a listing whose photo has no hash has no distance",
            "select coalesce(public.item_photo_distance("
            f"(select id from public.items where ref_code = '{found_1}'),"
            f"(select id from public.items where ref_code = '{found_5}')"
            ")::text, 'none');",
            expect="none",
        )

        # ---------------------------------------------------------------- notification
        run(
            uri,
            "the lost reporter is notified once",
            f"select count(*) from public.notifications where user_id = '{U_OWNER}' and kind = 'match'"
            f" and link = '/items/{found_1}';",
            expect="1",
        )
        run(
            uri,
            "and the body says the photo looks similar",
            f"select count(*) from public.notifications where user_id = '{U_OWNER}' and kind = 'match'"
            f" and link = '/items/{found_2}' and body like '%photo looks very similar%';",
            expect="1",
        )
        run(
            uri,
            "re-scoring does not send the same notification twice",
            as_user(U_OWNER, f"select public.recompute_item_matches('{lost_1}')::text;"),
            expect='"ok": true',
        )
        run(
            uri,
            "still exactly one notification",
            f"select count(*) from public.notifications where user_id = '{U_OWNER}' and kind = 'match'"
            f" and link = '/items/{found_1}';",
            expect="1",
        )

        # ---------------------------------------------------------------- recompute authz
        run(
            uri,
            "a stranger cannot re-score someone else's listing",
            as_user(U_OTHER, f"select public.recompute_item_matches('{lost_1}')::text;"),
            expect="FORBIDDEN",
        )
        run(
            uri,
            "staff can",
            as_user(U_STAFF, f"select public.recompute_item_matches('{lost_1}')::text;"),
            expect='"ok": true',
        )
        run(
            uri,
            "an unknown reference is refused",
            as_user(U_OWNER, "select public.recompute_item_matches('LF-1999-0001')::text;"),
            expect="NOT_FOUND",
        )
        run(
            uri,
            "an anonymous caller cannot re-score anything",
            "set role anon; select public.recompute_item_matches('LF-2026-0001');",
            expect_error="permission denied for function recompute_item_matches",
        )
        run(
            uri,
            "a browser still cannot call refresh_matches directly",
            as_user(U_OWNER, "select public.refresh_matches(gen_random_uuid());"),
            expect_error="permission denied for function refresh_matches",
        )
        run(
            uri,
            "the photo helpers are not callable by a browser",
            as_user(U_OWNER, "select public.item_photo_distance(gen_random_uuid(), gen_random_uuid());"),
            expect_error="permission denied for function item_photo_distance",
        )
        # the per-user budget is 30 an hour
        for i in range(29):
            psql(uri, as_user(U_OWNER, f"select public.recompute_item_matches('{lost_1}');"))
        run(
            uri,
            "and it runs out after 30 in an hour",
            as_user(U_OWNER, f"select public.recompute_item_matches('{lost_1}')::text;"),
            expect="TOO_OFTEN",
        )

        # ---------------------------------------------------------------- the queue
        run(
            uri,
            "an anonymous caller cannot read the queue",
            "set role anon; select public.match_queue(10);",
            expect_error="permission denied for function match_queue",
        )
        run(
            uri,
            "a member gets null, not an empty list",
            as_user(U_OTHER, "select coalesce(public.match_queue(10)::text, 'null');"),
            expect="null",
        )
        run(
            uri,
            "staff get the pairs with their reasons",
            as_user(U_STAFF, "select public.match_queue(10)::text;"),
            expect='"photoDistance"',
        )
        run(
            uri,
            "the queue names both listings",
            as_user(U_STAFF, f"select public.match_queue(50)::text like '%{lost_2}%';"),
            expect="t",
        )
        run(
            uri,
            "the queue is capped",
            as_user(U_STAFF, "select jsonb_array_length(public.match_queue(1));"),
            expect="1",
        )
        run(
            uri,
            "sample rows never appear in it",
            as_user(U_STAFF, "select public.match_queue(200)::text like '%Black wireless earbuds in a charging case%';"),
            expect="f",
        )
        # ---------------------------------------------------------------- lifecycle
        # Standing rule: run the claim → handover loop after any change to a
        # notification path, and refresh_matches() now writes notifications. This
        # is the loop from docs/lifecycle-check.md, compressed: report → publish →
        # claim → approve → handover, with the new matching code in place.
        psql(
            uri,
            """
            create extension if not exists pgcrypto;
            create or replace function extensions.digest(bytea, text) returns bytea
              language sql immutable as $$ select public.digest($1, $2) $$;
            create or replace function extensions.digest(text, text) returns bytea
              language sql immutable as $$ select public.digest($1, $2) $$;
            create or replace function extensions.gen_random_bytes(int) returns bytea
              language sql volatile as $$ select public.gen_random_bytes($1) $$;
            """,
        )

        code, out = psql(
            uri,
            as_user(
                U_OTHER,
                "select public.create_item('found','electronics','Orange power bank, 10000mAh',"
                "'A power bank with a short braided cable, left at the reading desk.',"
                "'library', null, current_date, null, 'What colour is the cable?', 'orange',"
                " false, null, null, 'member')::text;",
            ),
        )
        assert code == 0, out
        ref_life = re.search(r'"ref": "(LF-[0-9]{4}-[0-9]{4})"', out).group(1)
        check("a first listing from a new reporter waits for review", '"status": "pending_moderation"' in out)
        run(
            uri,
            "staff publish it",
            as_user(U_STAFF, f"select public.staff_update_item('{ref_life}', 'available')::text;"),
            expect='"ok": true',
        )
        code, out = psql(uri, as_user(U_OWNER, f"select public.submit_claim('{ref_life}', 'orange', 'I have the receipt')::text;"))
        assert code == 0, out
        claim_ref = re.search(r'"(CLM-[0-9]{4}-[0-9]{4})"', out).group(1)
        check("the claimant files a claim", '"ok": true' in out)
        run(
            uri,
            "staff approve it",
            as_user(U_STAFF, f"select public.staff_decide_claim('{claim_ref}', 'approve', 'answer matched')::text;"),
            expect='"ok": true',
        )
        code_plain = value(
            uri,
            "select h.code_plain from public.handover_codes h join public.claims c on c.id = h.claim_id"
            f" where c.ref_code = '{claim_ref}';",
        )
        run(uri, "approving issues a six-character code", f"select ({len(code_plain)} = 6)::text;", expect="true")
        run(
            uri,
            "the handover is confirmed with that code",
            as_user(
                U_STAFF,
                f"select public.staff_confirm_handover('{ref_life}', '{code_plain}', 'handed over at the desk', '{U_STAFF2}')::text;",
            ),
            expect='"ok": true',
        )
        run(
            uri,
            "the item is recovered",
            f"select status from public.items where ref_code = '{ref_life}';",
            expect="recovered",
        )
        run(
            uri,
            "and the spent code is gone from its row",
            "select coalesce(h.code_plain, 'null') from public.handover_codes h"
            f" join public.claims c on c.id = h.claim_id where c.ref_code = '{claim_ref}';",
            expect="null",
        )
        run(
            uri,
            "the claimant is told the claim was approved",
            f"select count(*) from public.notifications where user_id = '{U_OWNER}' and kind = 'claim_update';",
            expect="1",
        )
        run(
            uri,
            "a replayed code is refused",
            as_user(U_STAFF, f"select public.staff_confirm_handover('{ref_life}', '{code_plain}', null, null)::text;"),
            expect='"ok": false',
        )

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
