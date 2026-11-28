# The dispute room

A claim is decided by one staff member, from an answer hash and whatever proof was typed onto
the claim. Sometimes that decision is wrong. Before 0030 the only recourse was an email to the
desk, which left no record, had no deadline, and gave nobody a way to see whether the desk was
being fair.

This is the missing half of the claim: a bounded right of appeal, a room to have it in, and
counts that show how the desk handles them.

## What a dispute is

One row in `public.disputes`, tied to exactly one claim (`claim_id` is unique). It has a
reference (`DSP-2026-0001`), the person who opened it, the role they opened it in, the reason in
their own words, and a state:

| State | Means | Who moves it |
| --- | --- | --- |
| `open` | with the desk | — |
| `upheld` | the desk agreed; the first decision was changed or recorded as wrong | staff |
| `dismissed` | the desk looked again and the decision stands | staff |
| `withdrawn` | the person who raised it dropped it | the opener |

The conversation happens in the claim's existing thread (`claim_messages`, 0011/0020). There is
no second message table: one moderation path, one audit trail, and the same scan that blocks
payment requests, phone numbers and ID numbers. A dispute adds state and a deadline around that
thread, nothing more.

## The rules, and where each one lives

Every rule below is enforced in Postgres. The page repeats the ones a person can trip over so
the refusal arrives as a sentence instead of a round trip; when the two disagree, Postgres wins.

| Rule | Enforced by |
| --- | --- |
| Only the claimant or the finder may open a dispute | `open_dispute()` compares `auth.uid()` with `claims.claimant_id` and `items.reporter_id` |
| Staff decide, they do not contest | `open_dispute()` returns `FORBIDDEN` for anyone else; `decide_dispute()` requires `is_staff()` |
| There must be a decision to contest | `claim.status in ('rejected','approved')` or `item.status = 'recovered'` |
| 14 days from the decision, then closed | `now() - coalesce(decided_at, updated_at, created_at) > interval '14 days'` |
| One dispute per claim | unique index on `claim_id` |
| The reason is a real explanation | `char_length between 20 and 2000`, plus `scan_message()` |
| No payment requests, phone numbers or ID numbers | `scan_message()` — the same function the chat uses |
| Three disputes a day per account | `rate_limit('dispute:<uid>', 3, '24 hours')` |
| Only the opener may withdraw, only while open | `withdraw_dispute()` |
| A decision needs a reason on the record | `decide_dispute()` refuses a note under 10 characters |
| Two staff deciding at once cannot both win | `select ... for update` on the dispute, claim and item |
| Only parties and staff can read a dispute | RLS policy + `dispute_party()` |
| No client can write the table directly | no insert/update/delete grant or policy; the functions are the only writers |

`dispute_party()` exists because the RLS policy cannot use an inline join: the claimant cannot
read the item row under `items_read_own`, so an inline `exists (... join items ...)` would deny a
claimant their own dispute. The helper is `SECURITY DEFINER` and answers one question.

## What upholding actually does

Upholding **does not hand anything over**. It puts the claim back in the review queue — and only
when all of these hold:

- the claim is `rejected` (an approved claim has nothing to reopen),
- the item is still in custody (`available` or `claimed`),
- no `handover_records` row exists for the claim,
- the claimant has no other open claim on the same item (the `claims_one_open_per_item` index).

Otherwise the dispute records the finding, `reopened_claim` stays false, and the page says
plainly that the item has already left the desk and cannot be un-released. An item already in
someone's hands is not something a database row can take back, and a log that pretends otherwise
is worse than no log.

## Trust signals

Two different things, deliberately kept apart.

**`claimant_trust(claim_ref)` — staff only.** Counts about one account: claims, approved,
rejected, handovers collected, disputes opened, disputes upheld, account age. Rendered in
`/staff/disputes` next to the reason the person gave. It is a count, not a verdict.

**`public_trust()` — public, person-free.** Counts about the desk: disputes raised, answered,
upheld, still open, median days to answer, claims decided in the last 30 days. It carries no
claimant, finder, item or reference, and it is rendered on `/safety`. A public number that
identifies a person would turn asking for a second look into a punishment for asking.

The label ("New account", "Repeat disputes upheld", "Collected before", "No strong signal") is
computed in `src/lib/trust.ts`, not in SQL, so the rule can be unit tested. It needs **two**
upheld disputes to read as a pattern: one upheld dispute means the first decision was wrong,
which is the system working, not evidence about the person.

## Routes

| Route | Guard | Notes |
| --- | --- | --- |
| `/disputes` | session (`redirect('/sign-in?next=/disputes')`) | what you can contest, and your own disputes |
| `/disputes/[ref]` | session + `dispute_room()` returns null for non-parties → `notFound()` | the room: reason, answer, thread, withdraw |
| `/staff/disputes` | session + `isStaff()` | the queue, oldest first, with trust counts |

`/safety` is public and reads only `public_trust()`.

## What was verified, and what was not

**Verified.** `scripts/check-dispute-migration.py` applies the whole chain, `0001` → `0030`, to a
real Postgres and walks the path as each role: a stranger cannot open a dispute on someone else's
claim, a one-word reason is refused, a phone number in the reason is blocked, the window closes at
14 days, upholding reopens a claim that is still in custody and refuses to reopen one that was
already handed over, a decided dispute cannot be decided twice, the withdrawn dispute leaves the
queue, and `public_trust()` is readable without a session and carries no person. It also proves
`/staff/disputes`' data source returns null for a member rather than an empty list.

**Verified at the UI layer.** `npm run smoke` renders `/disputes` and `/disputes/[ref]` and
confirms both redirect to sign-in without rendering the room, and that `/safety` shows the
dispute record and no person-level field.

**Not verified.** Nothing has been run against the live Supabase project: the migration has not
been applied there, and Realtime, PostgREST and the storage policy are untested for this feature.
No browser walkthrough of the room has been done with two real accounts — the smoke gate renders
server output, it does not click. The 14-day window and the notification delivery were exercised
against the local Postgres only.

## Running the check

```bash
pip install pgserver
python3 scripts/check-dispute-migration.py
```

It needs no network and no Supabase project. It is not part of `npm test`: it needs Python and a
bundled Postgres, neither of which CI installs.
