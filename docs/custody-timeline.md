# Custody timeline for the owner

Item 8 of the queue. A reporter could see one status word and nothing else, while the desk knew
the whole story. This is that story, for the person who reported the item — and for nobody else.

## What it is

One page, `/items/<ref>/timeline`, reached from **Your listings** on `/account`. It shows the chain
of custody for that one item, in order:

```
handed in → on the board → someone claimed it → claim approved → code issued → handed over
```

with the real dates, and a count wherever the step is about more than one thing ("3 people claimed
it"). For a lost report the first step is the report itself; for an identity document it is *held at
the desk, never published*; for an item nobody claimed it ends with *left the desk* and what became
of it.

## Where each piece lives

| Piece | Where |
| --- | --- |
| Authorization, the steps, the person-free payload | `supabase/migrations/0032_custody_timeline.sql` (`item_custody_timeline(ref)`) |
| Ordering, labels, day counts, the second lock (pure, unit-tested) | `src/lib/custody.ts` |
| The one fetch | `src/lib/data.ts` (`custodyTimeline`) |
| The page (session-guarded) | `src/app/items/[ref]/timeline/page.tsx` |
| Entry point | `/account` → the **Timeline** button on each listing |
| Database proof | `scripts/check-custody-timeline-migration.py` |
| Route proof | `scripts/smoke.mjs` |

## Nothing new is written

There is no new table, no new trigger and no new column. Every step is derived from a row the
existing functions already write: `items.created_at` / `published_at` / `expires_at` /
`disposed_at`, `claims` (count and decision dates), `handover_codes.created_at`,
`handover_records.created_at`, and `disputes` (count per outcome). That is deliberate: a timeline
fed by a second write path is a timeline that silently stops updating the first time someone
changes `staff_confirm_handover`.

## Authorization, in Postgres

`item_custody_timeline(p_ref)` is a `security definer` function. The page decides nothing.

| Caller | Answer |
| --- | --- |
| no session | `{ ok: false, error: 'AUTH_REQUIRED' }` |
| `anon` (no grant at all) | `permission denied` |
| unknown reference | `{ ok: false, error: 'NOT_FOUND' }` |
| a reference that is not yours, and you are not staff | `{ ok: false, error: 'NOT_FOUND' }` — byte-identical to the answer above |
| the reporter, or staff | the timeline, with `access` set to `owner` or `staff` |

The last two rows are the same on purpose. Answering `FORBIDDEN` for someone else's reference would
turn the function into an oracle for which references exist; a reference is a label, not a
capability.

## What it never returns

A claim appears as a count and a date. Nothing else about the person who filed it:

- no claimant id, name, email, account age or trust counts;
- no answer, `answer_hash`, proof text or `decision_reason`;
- no claim reference, so nothing to quote into a page that would refuse it anyway;
- no collection code or code hash;
- no staff free text — the handover note, the disposition note and the dispute reason are written
  for the record and can quote a person.

`src/lib/custody.ts` holds a second lock: `personShapedPaths()` walks the payload for keys matching
`claimant|email|phone|answer|proof|witness|reason|note|hash|secret|_id`, and the page renders its
neutral not-found state instead of drawing a payload that trips it. A future change that starts
returning one fails in the unit test and stops the page, rather than leaking quietly.

## What was verified, and what was not

Verified:

- the whole migration chain still applies, `0001` → `0032`, against a real Postgres
  (`scripts/check-custody-timeline-migration.py`, 51 checks);
- an anonymous caller cannot reach the function, and a session with no subject gets `AUTH_REQUIRED`;
- a stranger's reference and a missing reference produce the identical answer;
- the reporter and staff both read it, with the right `access` label, case-insensitively;
- the chain carries the hand-in, publish, claim, approval, code and handover steps, in that order,
  after a real `submit_claim` → `staff_decide_claim` → `staff_confirm_handover` run;
- a quarantined listing shows *held* and no *published* step; a lost report opens with *reported*;
  a dispute shows as a count; a disposal shows as the last step with no staff note; an expired
  window shows as *window closed*;
- the payload text contains none of: the claimant's id, email, claim reference, typed answer, proof
  text, decision reason, collection code, code hash, handover note;
- `npm run lint`, `npm test` (222 tests, 23 of them new), `npm run typecheck`, `npm run build` and
  `node scripts/smoke.mjs` all pass.

Not verified:

- **the page's rendered output with a real session.** `/items/[ref]/timeline` is session-guarded, so
  the smoke gate can only prove that a signed-out visitor is redirected and that nothing is drawn
  before the session is checked. The rendering itself rests on the unit-tested builder and the
  typechecker. A signed-in smoke pass (a mock session cookie) would close this; it is not built yet.
- **the migration is not applied to the live project.** Like `0030` and `0031`, `0032` is in the
  repository and proven against a local Postgres, not pushed to Supabase.
- **the lifecycle check in `docs/lifecycle-check.md` was not re-run.** No claim, handover,
  notification or audit function was modified — this adds one read — so the write path it walks is
  unchanged.
