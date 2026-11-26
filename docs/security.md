# Security

## Threat model, in one line

The item is worth stealing, the claimant is a stranger, and the only thing standing between
them is a question and a counter. Everything below exists to keep that true.

## Authorization

| Actor | Can | Cannot |
| --- | --- | --- |
| Anonymous | browse, search, read public item detail, read the verification question | see photos of sensitive items, see any contact or answer, claim |
| Member | everything above + report, claim, see own claims and own listings | see another person's claim, see private detail |
| Staff | + desk queue, claim detail, approve/reject, handover, listing status | change roles, read the audit log |
| Admin | + roles, audit log, metrics, purge samples | read a claimant's verification answer (it is a hash) |

Enforcement points:

- `is_staff()` / `is_admin()` are `SECURITY DEFINER` and read `user_roles`, which has **no**
  insert/update/delete policy for any client. A user cannot promote themselves.
- Every staff and admin RPC starts with `if not public.is_staff() then return …`.
- RLS policies are the second line, not the first: the first is that the page never asks for
  a column it should not have.

## The verification answer

Stored as `encode(digest(lower(btrim(answer)), 'sha256'), 'hex')`. Consequences:

- Nobody can read it back, including admins and database dumps.
- A claim is recorded with `answer_matched boolean`, computed server-side. The claimant's UI
  never says "wrong answer" — that would turn the form into an oracle. The desk sees the flag
  and decides.
- A weak answer (a colour, a brand) is guessable. The intake form pushes for something only
  the owner would know; the desk can reject a claim whose answer is trivial.

## Handover codes

- Generated at approval from a 32-character alphabet without `I`, `O`, `0`, `1` — six
  characters, ~1.07 billion combinations, valid 14 days.
- Only `sha256(code)` is stored for verification; the plaintext is kept in one column so the
  claimant can read it once, and `revealed_at` is set the first time it is served.
- A second visit shows "code already shown", not the code.
- A mismatch writes an `alert`-severity audit row — that is the signal for a social-engineering
  attempt at the counter.
- One code per claim (`unique (claim_id)`), one open claim per claimant per item (partial
  unique index).

## Abuse and rate limits

`public.rate_limit(bucket, limit, window)` uses a fixed window in `rate_limits`:

| Bucket | Limit |
| --- | --- |
| `create_item:<uid>` | 12 / hour |
| `claim:<uid>` | 8 / hour |
| `report:<uid or anon>` | 6 / hour |

Exceeding a limit returns a friendly message, not an exception.

## Content screening

Titles and descriptions are scanned for identity-document terms (`aadhaar`, `passport`,
`pan card`, `driving licence`, `voter id`, `id card`, `atm/debit/credit card`). A found item
matching one is created as `quarantined`: it never appears on the public board, and the
poster is told to bring it to the desk. That is the rule "an ID document is never photographed
or listed", implemented rather than promised.

## Photos

- Bucket is private. No public URL exists.
- Uploads are re-encoded by `sharp` (`.rotate()` then `.resize()` then `.webp()`), which drops
  all EXIF, GPS and camera metadata because nothing is carried over unless asked for.
- Reads go through `createSignedUrls` with a 1-hour expiry, and the storage policy only signs
  paths that belong to a *published, non-sensitive* listing.
- `sensitive_hidden_photo` removes the photo from the public page, the cards and the
  share preview — the description stands alone.

## Response headers

`src/proxy.ts` sets, per request: `default-src 'self'`, a nonce'd `script-src` with
`strict-dynamic`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
`frame-ancestors 'none'`, and `connect-src`/`img-src` limited to the app plus the one Supabase
origin. `style-src` allows inline styles because the UI uses `style` attributes; that is the
one concession, and it cannot execute script.

## Email

Every send goes through `sendOrQueue`. A refused send becomes an `email_outbox` row with a
dedupe key (`claim_decided:CLM-2026-0001`), a 3-attempt cap and a 5-minute lease taken with
`FOR UPDATE SKIP LOCKED`, so two cron runs cannot send the same message twice. A member may
only queue mail to their own address; staff may queue to the finder address they are writing
to. That keeps the outbox from becoming an open relay.

## Logging

- `audit_logs` records actor, action, resource and a small JSON detail: `item_created`,
  `claim_submitted`, `claim_decided`, `handover_confirmed`, `handover_code_mismatch`,
  `item_status_changed`, `role_changed`, `samples_purged`. Admin-readable, 365-day retention.
- `events` records product counters with no personal data: `claim_submitted`,
  `claim_decided`, `handover_confirmed`, `listing_reported`, `housekeeping_run`.
- Raw search strings are **never** logged — people type their phone numbers into search boxes.
- `error.tsx` logs the digest only.

## Known limits (deliberate, documented)

1. Email OTP is only as strong as the email account. For a high-value venue, add MFA for staff
   accounts in Supabase Auth.
2. There is no CAPTCHA on the public forms. Rate limits plus the verified-email requirement
   cover the realistic abuse; add Turnstile if a board gets targeted.
3. The staff desk is a web page. Anyone with a staff session can act as the desk; that is why
   role changes are admin-only and audited.
4. `answer_hash` uses SHA-256 without a salt, which is right for equality checks and weak
   against an offline dictionary of short answers. Do not store anything else that way.
