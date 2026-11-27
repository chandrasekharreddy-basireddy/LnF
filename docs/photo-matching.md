# Photo-similarity matching

Item 4 of the queue. Text and category matching already existed; this adds the photo.

## What it is

A **difference hash (dHash)**: the photo is reduced to a 9×8 greyscale grid, and each of the 64
adjacent pairs records which neighbour is brighter. Two photos of the same object usually differ
in a handful of bits; two photos of different objects usually differ in about half.

```
distance = popcount(hash_a XOR hash_b)        0 … 64
photo    = max(0, 1 − distance / 24)          24 bits apart reads as unrelated
score    = min(1, base + 0.35 · photo)
base     = 0.55·title + 0.25·category + 0.10·zone + up to 0.10·date
```

Why this and not an embedding service: it needs no model, no network call, no per-image cost, and
no vector index, and it can be explained to a claimant in one sentence. It is also deliberately
weak — a photo match is a *lead for the desk*, never a decision. The claim answer and the handover
code still decide who collects.

## Where each piece lives

| Piece | Where |
| --- | --- |
| The arithmetic (pure, unit-tested) | `src/lib/phash.ts` |
| Sharp → 9×8 grid → hash | `src/lib/phash-image.ts` |
| Hashing at upload, then re-scoring | `src/lib/photos.ts` (`processAndUploadPhotos`) |
| Storage, distance, scoring, queue | `supabase/migrations/0029_photo_matching.sql` |
| Desk view | `/staff/matches`, `src/app/staff/matches/page.tsx` |
| Database proof | `scripts/check-photo-matching-migration.py` |

## Authorization, in Postgres

- `item_images.phash` is a `bigint`, and the `INSERT` grant on the table is **column-level**:
  `(item_id, storage_path, alt_text, width, height, position)`. A browser cannot post its own hash;
  the ordinary photo insert path is unchanged.
- `set_item_photo_hash(path, hash)` is the only writer. It requires a session, a path whose first
  segment is the caller's uid (the same rule the storage policy uses), and a listing the caller
  reported — or a staff role. The hash travels as text so a 64-bit pattern never rounds through a
  float; it is range-checked and cast inside a `begin … exception` block.
- `refresh_matches()` stays executable by `service_role` only (as it has been since `0014`).
  `recompute_item_matches(ref)` is the client-facing door: it checks the reporter or staff, is
  capped at 30 calls an hour per user, and refuses a listing that is not published.
- `match_queue()` returns `null` — not an empty list — for anyone who is not staff.
- `photo_distance()` and `item_photo_distance()` are not executable by `anon` or `authenticated`.

## What changed in the scorer

The old function had two nearly identical loops, one per direction, and only the found-item branch
applied the date term — so the same pair scored differently depending on which listing was filed
last. `0029` replaces both with one candidate list and one formula, and the score is now the same
in both directions.

The other deliberate change: **the owner of a lost report is now told when their report matches a
found item that was already on the board.** Before, only the reverse direction sent a notification.
The notification text gains one sentence when the photos are within 12 bits — "The photo looks very
similar too" — and nothing more; it never claims a match.

Existing alerts keep their row. When a photo arrives later, `recompute_item_matches()` updates the
stored score and photo distance in place and does **not** send a second notification.

## Limits, stated plainly

- A dHash is not rotation-, crop- or watermark-invariant. A photo of the same object taken from a
  very different angle can be 20–30 bits away and will not match.
- Two identical products (two black 65 W chargers) hash almost identically. The queue will show
  them; the verification answer is what separates them.
- Hashes are only computed for photos uploaded through the app's own path. A listing with no photo,
  or a photo whose hash failed, simply falls back to text, category, zone and date.
- The candidate window is still 45 days. A photo match across a longer gap is not surfaced.

## Verification

`scripts/check-photo-matching-migration.py` stands up a throwaway Postgres, applies **every**
migration 0001 → 0029 in order, and then asserts, among ~45 checks:

- the chain applies, and `refresh_matches` keeps its signature and grants;
- `photo_distance` is an XOR popcount, including for negative (bit-63) patterns;
- a browser cannot insert `phash` directly, but the ordinary insert still works;
- `set_item_photo_hash` refuses the wrong uploader, the wrong reporter, a bad hash and anon;
- an identical photo adds exactly **0.35** to a pair's score, and a pair with nothing in common
  but the photo crosses the 0.35 alert line;
- unrelated photos and unrelated text produce no alert;
- the closest of several photos is the one that counts;
- one notification, not two, when a listing is re-scored;
- the queue is staff-only, capped, and free of sample rows;
- and the claim → approve → handover loop from `docs/lifecycle-check.md` still runs end to end with
  the new matching code in place (witness, code, `code_plain` nulled, replayed code refused).

The script needs `pip install pgserver` and is not part of `npm test`, for the same reason
`check-push-migration.py` is not: CI installs neither Python nor a Postgres.

Two environment shims are applied to the shipped SQL by that script and are printed at the top of
it: `pg_trgm`/`pgcrypto` are stubbed (the bundled Postgres has no contrib), and the GIN trigram
index plus the enum-typed seed `INSERT` are rewritten. Assertions never depend on the value of
`similarity()` — they use identical strings and measure the photo term as a delta.
