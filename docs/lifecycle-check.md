# The lifecycle check

The claim → approve → handover path was listed as unverified for most of this project's life.
On 28/11 it was run end to end against the live database with four temporary accounts, and it
found three defects that nothing else had caught. This is the record of both.

## How to run it

The harness needs a staff account, a witness, a reporter and a claimant, and it writes real rows.
It creates them, runs the loop, and deletes everything at the end:

1. Create `probe-owner`, `probe-staff`, `probe-staff2` (witness) and `probe-claimant` in
   `auth.users`, with `profiles` rows and `staff` roles for the two staff.
2. As the owner: `create_item(...)` → `pending_moderation` (first-time reporter).
3. As staff: `staff_update_item(ref, 'available')` → published.
4. As the claimant: `submit_claim(ref, answer, proof)` → claim reference.
5. As staff: `staff_decide_claim(claim_ref, 'approve', reason)` → item `claimed`, code issued.
6. As staff: `staff_confirm_handover(ref, code, note, witness)`.
7. Verify: item `recovered`, claim `approved`, one `handover_records` row with the witness,
   `code_plain` null, claim events written, notifications to claimant and finder.
8. Replay the same code → must be refused.
9. Delete the probe users and their rows.

Set `request.jwt.claims` and `set local role authenticated` before each step; passing references
as literals, because RLS means a claimant cannot read another user's item row to look one up.

## What it proved

The loop works: report → review → publish → claim → approve → witnessed handover → recovered,
with the right audit rows and notifications, and a spent code that cannot be replayed.

## What it broke, and what that tells you

| Failure | Cause | Fix |
| --- | --- | --- |
| `42883: function digest(text, unknown) does not exist` on the first report | `0022` re-created `create_item` from its `0018` body, which carried `set search_path = public`, undoing the `0017` fix | `0025` re-applies the sweep and adds `assert_write_paths_hashable()` as a probe |
| `42804: column "severity" is of type audit_severity but expression is of type text` | a `CASE` returns text; a bare literal coerces to the enum, a `CASE` does not | `0026` casts the two places that did it |
| `23502: null value in column "code_plain"` during the handover | `0022` nulls the code on use, but the column was `not null` — and the external patch's `drop not null` was the line I skipped | `0027` drops the constraint |

Every one of those sits on a write path a person only reaches mid-handover. Unit tests cannot see
them, the smoke gate renders pages rather than writing, and the read paths were always fine. The
lesson is in the order of testing: the flow, not the functions.
