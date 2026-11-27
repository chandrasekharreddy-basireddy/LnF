# Notifications

Two channels, one promise: **the board tells you something changed, and it never tells anyone
else.** Email already exists (`email_outbox` + Brevo). This adds the two that need no mail
provider and no phone number on file.

| Channel | Who sends | Where the rule lives |
| --- | --- | --- |
| In-app | the platform | `notifications` + RLS (`notifications_read_own`) |
| Email | the platform, via Brevo | `sendOrQueue` → `email_outbox` → daily cron |
| **Web push** | the platform, via the browser's push service | `push_subscriptions` + `register_push_subscription()` + `claim_push_batch()` |
| **WhatsApp** | **the person**, from their own phone | `src/lib/whatsapp.ts` — a `wa.me` link, nothing else |

## Web push

### What is stored, and why it matters

A push subscription is three secrets: an `endpoint` URL and two keys (`p256dh`, `auth`).
Whoever holds them can send a notification to that device. They are therefore:

- readable only by their owner (`push_subscriptions_read_own`, `user_id = auth.uid()`);
- **not writable at all** by a browser — insert/update/delete are not granted; writes go through
  `register_push_subscription()` / `unregister_push_subscription()` / `set_push_opt_in()`, which
  take the identity from `auth.uid()` and never from an argument;
- never returned by a page. `/account` shows a device *count* (`my_push_state()`), not an endpoint;
- readable by the dispatcher only, through `claim_push_batch()`, which is granted to
  `service_role` alone.

### The flow

```
/account  ──► PushToggle (client)
                │  Notification.requestPermission()
                │  serviceWorker.register('/sw.js')
                │  pushManager.subscribe({ applicationServerKey: /api/push/config })
                ▼
            enablePush(subscription)          server action
                │  normaliseSubscription()    shape check before the database sees it
                ▼
            register_push_subscription()      SECURITY DEFINER, auth.uid()
                │  refuses: non-https endpoint, junk keys, a 6th device,
                │           an endpoint another account already holds
                ▼
            push_subscriptions  +  profiles.push_opt_in = true
```

A notification written later is queued by a trigger (`queue_push_for_notification`):
`push_status = 'pending'` when the owner has opted in **and** has a live device, `'skipped'`
otherwise, and `'none'` for `kind = 'system'`. No existing `insert into public.notifications`
had to change.

`/api/cron/push` (bearer `CRON_SECRET`, service role) then:

1. `claim_push_batch(20)` — marks rows `sending` with a 10-minute lease; a crashed run is
   reclaimed after the lease, exactly like `email_outbox`;
2. encrypts one payload per device with `web-push` (VAPID);
3. `finish_push(id, 'sent' | 'failed' | 'skipped', droppedEndpoints)` — and an endpoint the push
   service retired (404/410) is disabled in the same call, so it is never retried.

Three attempts per notification, then it stays `failed`. A failed push never fails the write
that created it: the in-app row is already there.

### Configuration

```bash
npx web-push generate-vapid-keys
```

| Variable | Notes |
| --- | --- |
| `VAPID_PUBLIC_KEY` | 65-byte point, base64url. Served by `/api/push/config` — public by design |
| `VAPID_PRIVATE_KEY` | 32-byte scalar. Server only. Never in a client bundle |
| `VAPID_SUBJECT` | `mailto:` or `https:` contact for the push service |
| `DESK_WHATSAPP_NUMBER` | international format, e.g. `+91 98765 43210` |

Without the VAPID pair, `/account` says push is off, `/api/push/config` returns
`{"enabled":false}`, and the dispatcher answers `503` with
`{"reason":"VAPID_KEYS_NOT_SET"}`. Nothing breaks; nothing pretends.

### Scheduling the dispatcher

`vercel.json` schedules only the daily housekeeping job. Vercel's free plan allows a limited
number of cron jobs and only daily frequency, so the push dispatcher is deliberately **not**
in `vercel.json` — a 15-minute schedule there would fail to deploy on Hobby. Point any scheduler
you already have at it:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/push
```

Good options: a GitHub Actions `schedule` workflow, a Supabase `pg_cron` job with `pg_net`, or
any uptime pinger that can send a header. Every 15 minutes is a sensible cadence.

## WhatsApp click-to-chat

The platform does **not** run WhatsApp Business, does not send messages, and does not store
anyone's number for this. It renders a `wa.me` link with a message already typed:

```
https://wa.me/<desk digits>?text=<url-encoded message>
```

The message names the reference and the public title (`itemEnquiryMessage`) or the claim
reference and its status (`claimEnquiryMessage`) — never the verification answer, the finder's
contact, or anything the page does not already show. The person reads and edits it before
pressing send, and the desk sees only what they chose to write.

The number is read server-side (`DESK_WHATSAPP_NUMBER`) and the link is built in a server
component, so it never reaches the client bundle. No number configured means no button — not a
button that goes nowhere.

Numbers are normalised to digits and must be 11–15 long: a bare 10-digit national number is
refused, because `wa.me` would read its first digits as a country code and open the wrong
conversation.

## What was verified, and how

- `npm test` — 36 unit tests over the pure logic: number normalisation, link building and
  message contents, subscription shape, payload trimming and link safety, VAPID key shape,
  404/410 handling, delivery summary.
- `scripts/check-push-migration.py` — applies `0028` to a real Postgres 16 with a
  Supabase-shaped stub and asserts 34 behaviours, including the refusals: another account cannot
  steal an endpoint, a sixth device is refused, a browser cannot read another account's rows,
  cannot insert directly, and cannot call `claim_push_batch`. Needs `pip install pgserver`; not
  part of CI.
- `scripts/smoke.mjs` — renders `/api/push/config` and asserts it is disabled and leaks no
  private key; asserts the cron answers 401 without a bearer and 503 with a named reason when
  VAPID is unset; asserts the WhatsApp link appears on an item page with the desk number and
  the reference, and carries no private data.

## What was not verified

- **Delivery to a real device.** That needs a browser, a push service, and a VAPID pair. The
  encryption path (`web-push`) is library code and untested here; the queue, the claim, the
  finish, and the disable-on-410 path are all tested.
- **A live Supabase project.** The migration was applied to Postgres 16 with a stub, not to the
  deployed database, and the real project's default grants for `service_role` were not exercised.
