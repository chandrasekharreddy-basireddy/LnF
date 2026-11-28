#!/usr/bin/env bash
# Applies every migration to a throwaway Postgres, then runs the assertions.
# This is the gate that was missing: the search_path bug survived four passes
# because no migration was ever executed anywhere before production.
set -euo pipefail

: "${PGURL:?PGURL must point at a scratch database}"

psql "$PGURL" -v ON_ERROR_STOP=1 -q -f supabase/tests/00_bootstrap.sql

for f in $(ls supabase/migrations/*.sql | sort); do
  echo "  applying $(basename "$f")"
  psql "$PGURL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null
done

echo "  asserting"
psql "$PGURL" -v ON_ERROR_STOP=1 -q -f supabase/tests/99_assert.sql
echo "sql check: passed"
