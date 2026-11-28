# Final pre-launch audit — 28/11/2026

Four reviewers worked in parallel over the whole repository: database and authorisation, auth and
email, frontend and accessibility, launch readiness. Each reported file:line with the smallest
correct fix; every finding was checked against the code before anything changed. This is what was
fixed, what was rejected, and what is knowingly left.

## Fixed in this pass

### The sign-in code — the actual reason it did not work

Two independent defects, either of which alone blocked sign-in:

1. **The input refused the code.** `pattern="[0-9]{6}"` and `maxLength={6}` in the sign-in form
   blocked the eighth digit at the browser level, while the server accepted 6–8. Supabase issues
   eight digits by default on newer projects, so the code could never be typed in full. Both the
   sign-in and the accountless-claim inputs now accept 6–8.
2. **The link in the same email destroyed the code.** `generateLink`'s `action_link` points at
   Supabase's `/auth/v1/verify`, which consumes the token — and university mail scanners prefetch
   links, so the token was spent before the person typed anything. The email is now code-only: it
   cannot be spent by a robot reading it.

Also: verification tried only `type: 'email'`; it now tries `email` then `magiclink`; the sign-in
page finally reads `?error=` and explains an expired link.

### Database

| Finding | Fix |
| --- | --- |
| `register_push_subscription` wrote `failed_count`/`last_error`/`updated_at` — none exist, so push registration had **never** worked and the SSRF allowlist and device cap inside it never ran | `0045`, `0046`; verified by registering a subscription end to end |
| `search_items()` did not filter `is_sample`, so seeded demo listings were claimable from `/browse` while `board_stats()` excluded them | `0044` |
| `queue_email_retry` rejected `erasure_confirmed`, so the erasure email could never queue and the caller was told it had | `0043`; verified a row lands |
| `sendOrQueue` treated a 200 `{ok:false}` as queued | checks the payload now |

### Frontend

- **Home said "the board is new" when the board failed to load** — it now shows the same warning
  `/browse` uses, instead of telling a student nothing has been handed in.
- **The desk said "No claims waiting. Good." when the queue failed** — it now says the queue did
  not load.
- Success banners were silent to a screen reader (`role="status"` added).
- Dark-mode danger button on hover measured **2.00:1**; the offline sheet's muted text, table
  headers and eyebrow measured **2.64:1, 2.64:1, 1.99:1** — all fixed.
- Every board card announced its title twice (`alt=""` now); `EmptyState` skipped a heading level.
- Placeholder `@campus.edu` addresses replaced.
- `loading.tsx` added for `/messages` and `/messages/[ref]`.

### Configuration and CI

- `.env.example` no longer calls the service-role key optional — it is the only path into sign-in.
- The preflight now also refuses a **production** build with no `NEXT_PUBLIC_SITE_URL`, which would
  otherwise put `localhost:3000` inside every email.
- The client-bundle guardrail compared an unset `$count`, so it could never fail; it counts and
  scans the same list now.
- `docs/deployment.md` no longer pins a migration count that goes stale.

### Fake data

The six sample listings were purged from the live database (verified: 0 items), and the search path
that exposed them is closed so a fresh environment cannot leak them either.

## Rejected findings — and why

- **"Verify the OTP with `type: 'magiclink'`, not `email`."** Wrong. GoTrue's `verifyUserAndToken`
  checks both `confirmation_token` and `recovery_token` for an email OTP, and `generateLink`
  writes the recovery token, so `email` is accepted. The real blockers were the input length and
  the burning link.
- **"`claim_messages_read` RLS returns nothing for non-staff."** The policy admits the claimant and
  the item's reporter; an anonymous hand-in has no reporter, so only the claimant and staff can
  read it — which is correct. Rewriting a chat read policy without a session to test it is how a
  thread leaks.
- **"`React.cache` is missing on several reads."** It is on the four that matter; the rest are
  called once per request.

## Knowingly left

1. **Forms still lose their values when the server rejects them.** React 19 resets an uncontrolled
   form on submit, so a rejected report returns a blank form — and the verification answer, which
   is stored hashed and cannot be recovered, is gone. The fix is to return the submitted values in
   the action state and seed each field from them. It touches five forms and their five actions;
   it is the top item for the next session and the one thing in this list a user will notice.
2. **`/items/[ref]` and `/claims/[ref]` return a 404 on a network error**, telling the person the
   item may have been removed. Needs a distinct error state from the readers.
3. **Mobile 360px polish and the palette's focus restoration.** The first needs a browser to judge;
   the second needs one to test.
4. Low-severity database items: a shared anonymous throttle bucket in `submit_report`, `p_ip` still
   accepted by `check_signin_allowed`/`log_auth_event`, the witness rule satisfied by any staff
   UUID, `documents` exempt from it, and six functions left on default `PUBLIC` EXECUTE.
