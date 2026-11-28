# PWA and the offline desk

Item 9 of the queue. The app was installable and had a service worker, but the worker did one thing —
push notifications — and cached nothing. So the person standing at the counter with a bag and a
phone showing "no signal" had no way to answer "is this mine?".

This item gives the desk one honest thing to carry: a saved sheet of what is on the board, and a
page that reads it with the network off. It also makes the install story explicit.

## What it is

```
/staff/desk          the board, as a list          [staff session]
   │  "Save for offline"
   ▼
localStorage  lnf-desk-sheet   { version, savedAt, generatedAt, rows[] }
   │
   ▼
/offline.html        what the worker serves when a navigation fails
   │  reads that key, searches it, says how old it is, hides it after 24h
   ▼
sw.js + sw-policy.js  what may be cached, and what may never be
```

## What the sheet holds

| Carried | Never carried |
| --- | --- |
| reference, title, category, type | who reported or handed it in |
| status (`available` / `claimed`) | any contact email or finder email |
| zone name, spot, event date, held since | the verification question or its answer hash |
| | any serial number, bin code or private note |
| | any claim, claimant, code or handover detail |

That is deliberate. The sheet is a copy of what `/browse` already shows, so a browser that outlives
a shift, or a shared desk machine someone forgets to clear, leaks nothing that was not public. What
it can get wrong is *staleness*, which is why the copy carries its own save time.

## Where each piece lives

| Piece | Where |
| --- | --- |
| Authorization and the public-safe payload | `supabase/migrations/0035_offline_desk_sheet.sql` (`desk_sheet(limit)`) |
| Shape, validation, age, lookup (pure, unit-tested) | `src/lib/offline.ts` |
| The one fetch | `src/lib/data.ts` (`deskSheet`) |
| The page (session-guarded) | `src/app/staff/desk/page.tsx` |
| "Save for offline" (client) | `src/components/desk-sheet.tsx` |
| The page served with no network | `public/offline.html` + `public/offline-sheet.js` |
| What may be cached (pure, unit-tested) | `public/sw-policy.js` |
| The worker | `public/sw.js` |
| Registration | `src/components/sw-register.tsx` |
| Install metadata | `src/app/manifest.ts` |
| Database proof | `scripts/check-offline-desk-migration.py` |
| Route and worker proof | `scripts/smoke.mjs` |

## Authorization, in Postgres

`desk_sheet(p_limit)` is a `security definer` function; the page decides nothing.

| Caller | Answer |
| --- | --- |
| no session | `{ ok: false, error: 'AUTH_REQUIRED' }` |
| `anon` (no grant at all) | `permission denied for function desk_sheet` |
| a member with a session | `{ ok: false, error: 'NOT_STAFF' }` |
| staff | the sheet, capped at 500 rows |

Only `status in ('available', 'claimed')` with a `published_at` is included. Quarantined, pending,
recovered, expired and archived items are not on the board, so they are not on the sheet.

## What the worker caches — and what it refuses to

The rule the whole item is built around: **a lost-and-found board cannot answer from a cache.**
"Available" an hour ago is not "available" now, and a person who reads a stale listing walks to the
desk for nothing. So:

| Request | Plan |
| --- | --- |
| anything but `GET`, or another origin | `bypass` — the worker does not intervene |
| `/api/*`, `/staff*`, `/account*`, `/messages*`, `/claims*`, `/disputes*`, `/admin*`, `/items/*`, `/hand-in`, `/report/*`, `/sign-in` | `bypass` — never read from or written to a cache |
| `/_next/static/*`, icons, `/offline.html`, `/offline-sheet.js` | `static` — cache-first, because a content-hashed file cannot go stale |
| a navigation | `navigation` — network only; on failure the offline page, never a cached page |

`public/sw-policy.js` holds those rules as plain functions and `tests/unit/offline.test.ts` asserts
every refusal, so a future edit that starts caching `/staff` fails a test rather than leaking a
stale page. `public/sw.js` only applies the plan.

## The two locks on the stored sheet

1. **`parseSheet` refuses rather than repairs.** Wrong version, bad JSON, a missing `savedAt`, or
   rows that are not board listings → `null`. A partial sheet is worse than none.
2. **Age is shown, and expiry is enforced.** Past 12 hours the page says the copy is old; past 24
   hours it shows no rows at all and says so. `sheetAge` reads a clock that jumped backwards as
   "just saved", never as negative.

The TypeScript module and `public/offline-sheet.js` implement the same parse. They cannot share code
— one is bundled by Next, the other is served to a worker-served page — so a unit test builds a
sheet with the TypeScript side and parses it with the browser script, row for row. If the two
drift, that test fails instead of the offline page quietly showing nothing.

## What was verified, and what was not

Verified:

- the whole migration chain applies, `0001` → `0035`, against a real Postgres
  (`scripts/check-offline-desk-migration.py`, 40 checks);
- an anonymous role is refused at the grant, a session with no subject gets `AUTH_REQUIRED`, and a
  member gets `NOT_STAFF` — with no `rows` key in the refusal;
- staff get the board: the earbuds and the claimed item are on it; a pending, quarantined and
  recovered item are not;
- the payload text contains none of: the contact email, the finder email, the serial number, the
  typed answer, the proof text, the decision reason, the claim reference, or any reporter uuid;
- the limit is honoured (`1` → one row), clamped up (`0` → one row) and down (`99999` → at most
  500), newest first, and `count` matches the rows returned; an empty board is `rows: []`, not an
  error;
- **the migration is applied to the live project** (`0035_offline_desk_sheet`, verified in
  `supabase_migrations.schema_migrations`), and on that project: `anon` is refused with
  `permission denied for function desk_sheet`, a session with no subject gets `AUTH_REQUIRED`, and a
  session for a user with no staff role gets `NOT_STAFF`. The live project has no staff account
  yet, so the *staff* branch is proved against a local Postgres only;
- `npm run lint`, `npm test` (258 tests, 33 of them new), `npm run typecheck`, `npm run build` and
  `node scripts/smoke.mjs` all pass, and the smoke gate now proves: `/offline.html` is public and
  carries its own strict CSP (not the nonce policy), it draws no listing data of its own, its only
  script is same-origin, `/sw.js` is served as JavaScript and loads `/sw-policy.js`, the policy keeps
  `/offline.html` and refuses `/staff` and `/api`, `/staff/desk` is guarded, and the manifest pins
  `id`/`scope` and offers three shortcuts.

Not verified:

- **a browser actually running the worker.** Nothing here starts a browser: the worker's plans are
  proved as functions, and the pages are proved over HTTP. Whether Chrome installs the app, whether
  `caches.put` succeeds, and whether the offline fallback is what a real navigation failure gets are
  all unproven. The Playwright suite (`npm run e2e`) could cover it; it does not yet.
- **the localStorage round trip in a real browser.** The write is a click handler and the read is
  `useSyncExternalStore`; both are exercised only by the shared-parse unit test, not by a browser.
- **`/staff/desk` rendered with a real session.** It is session-guarded, so the smoke gate can only
  prove a signed-out visitor is redirected and no staff UI is drawn. The same limitation as the
  custody timeline.
- **the `npm run build` in this environment.** The Turbopack build was run here and died in
  "Running TypeScript" with `memory allocation of 16777216 bytes failed` — this sandbox has 2 GB of
  RAM. The same tree builds clean with `next build --webpack`, and the smoke gate ran against that
  build. CI runs the Turbopack build on a GitHub runner; that is the run that counts.
- **the lifecycle check in `docs/lifecycle-check.md` was not re-run.** No claim, handover,
  notification or audit function was modified — this adds one read.
