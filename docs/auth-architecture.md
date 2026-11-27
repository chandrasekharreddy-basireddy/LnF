# Authentication architecture

Passwordless, email-first, and deliberately boring about the part that matters: we never
generate or store a session token ourselves.

## The split

| Layer | Owner | Why |
| --- | --- | --- |
| Token generation, session cookies, refresh rotation, single-use enforcement, code expiry | Supabase Auth | Getting this wrong is how accounts get taken over. It is the one part worth outsourcing. |
| Who can ask for a code, how often, from where | us (`check_signin_allowed`) | The provider's limits are per-project, not per-person. |
| The email: template, sender, footer, delivery | us (Brevo, `src/lib/auth/signin.ts`) | The sign-in email is the first thing a user sees. It should look like the product and carry the anti-scam line. |
| Proof that an address was verified | us (`profiles.email_verified_at`) | Needed for support, and for the welcome note. |
| The audit trail of sign-in attempts | us (`auth_events`, hash-only) | An address that keeps failing is a signal; storing it in the clear is a liability. |

## The flow

```
1. /sign-in            email entered
2. check_signin_allowed(email, ip)      → 5 per address / 20 per IP per 15 min
3. issueSignInCode(email)
     ├─ service key present:
     │    admin.generateLink({type:'magiclink'})
     │    ├─ no account → admin.createUser({email, email_confirm:false}) → retry
     │    └─ properties.email_otp  →  our Brevo template  →  user's inbox
     └─ no service key: signInWithOtp()  →  Supabase's own mailer (plainer email)
4. user enters the 6 digits
5. verifyOtp(email, token)              → session cookie set by Supabase
6. mark_email_verified()                → profiles.email_verified_at
7. first time?  → welcome email, once
8. redirect to `next`, or /account
```

Sign-up is not a separate flow. The same code creates the account and proves the address,
which removes the "already registered?" dead end and the enumeration it invites.

## Security decisions, and what each one costs

| Decision | Reason | Cost |
| --- | --- | --- |
| No passwords at all | Nothing to leak, nothing to reset, no reuse across sites | Sign-in depends on the mailbox. For staff, add MFA in Supabase Auth |
| Identical response for known and unknown addresses | The screen must not answer "does this person have an account" | A typo looks the same as a new address — acceptable |
| Throttle before generation | A public form is otherwise a mail cannon aimed at any address | 5 per address per 15 minutes; a determined attacker still costs you Brevo quota |
| Hash the address in the audit log | `auth_events` is read by admins, and admins are people | You cannot look up "who tried this email" without hashing the guess first |
| Six digits, ten minutes, single use | Supabase's own enforcement, unchanged | Six digits is 1-in-a-million per attempt, and attempts are throttled |
| Session cookies from Supabase | Rotating refresh tokens is the hard part | The cookie name embeds the project ref; changing projects invalidates sessions |

## Email templates

One shell in `src/lib/email.ts` (`wrap`) is shared by every message the product sends, so the
sign-in code, a claim decision and a finder thank-you look like the same organisation: paper
background, teal rule, the L&F wordmark, monospace references, and the same footer —
*never pay to get an item back; handovers happen at the desk*.

Templates in use:

| Template | Trigger |
| --- | --- |
| `signInCode` | a code was issued (this is the only one that contains a secret) |
| `welcome` | first successful verification |
| `itemPublished` | a report was posted |
| `claimReceived` | a claim was submitted |
| `claimDecided` | approved or rejected, with the desk's reason |
| `finderThanks` | the item went home |
| `matchAlert` | a lost report matched a found listing |

Every interpolated value goes through `esc()`. A unit test asserts that a hostile item title
cannot inject markup, and that the code appears exactly twice (visible block and hidden
preheader) and nowhere else.

## Failure behaviour

| Failure | What the user sees |
| --- | --- |
| Brevo rejects the code email | the code is re-issued through Supabase's mailer; the user still gets in |
| No service-role key configured | everything works, with Supabase's plainer template |
| Throttle RPC unreachable | the request proceeds; the provider's own limits still apply |
| Code wrong or expired | "that code is wrong or has expired" — never which |
| Welcome email fails | nothing; the sign-in already succeeded |

## A bug this layer exposed

Building it surfaced a real defect in the existing schema: `pgcrypto` lives in the
`extensions` schema on Supabase, while every `SECURITY DEFINER` function set
`search_path = public`. That hid `digest()`, so **reporting a found item, claiming one,
approving a claim and confirming a handover all failed at runtime** with
`42883: function digest(text, unknown) does not exist`.

It had never been caught because every check until then exercised the read paths — search,
item detail, stats — and none of the write paths. Migration `0017` appends `extensions` to
the search path of the seven affected functions (`extensions` is appended, not prepended, so
a function in `public` still wins), and `assert_digest_available()` now exists as a probe the
next migration can call.

## What to configure

| Setting | Needed for | Where |
| --- | --- | --- |
| `BREVO_API_KEY` | our branded code email and every product email | Vercel env |
| `SUPABASE_SERVICE_ROLE_KEY` | issuing codes ourselves; photo cleanup; email retries | Vercel env |
| Supabase SMTP (Brevo) | **only** the fallback path, and magic-link emails | Supabase → Auth → SMTP |
| Supabase Site URL + `/auth/confirm` redirect | the link in the email | Supabase → URL Configuration |
| Magic Link template with `{{ .Token }}` | only if you rely on the fallback | Supabase → Emails |

With the service key set, the sign-in email is ours end to end and Supabase's SMTP settings
become optional — worth knowing, because SMTP configuration inside Supabase is the step people
most often get wrong.
