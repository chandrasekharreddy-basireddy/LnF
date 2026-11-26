# Privacy and retention

The published pages `/legal/privacy` and `/legal/retention` are the user-facing version. This
file is the engineering version: what is stored, where, and what deletes it.

## Data map

| Data | Table / bucket | Public? | Retention |
| --- | --- | --- | --- |
| Email, name, phone | `profiles` | no | life of account |
| Listing text, zone, date | `items` | yes, via `public_items` | 90 days, then +30 to delete |
| Photos (re-encoded, no EXIF) | `storage: item-photos` | signed URL only, 1 h | deleted with the listing |
| Verification answer | `item_private.answer_hash` | never | deleted with the listing |
| Serial, bin, finder contact | `item_private` | staff only | deleted with the listing |
| Claims and decisions | `claims`, `claim_events` | claimant + staff | life of account |
| Handover record | `handover_records` | staff only | kept for recovery metrics (no personal data) |
| Handover code | `handover_codes` | claimant, once | 14 days / until used |
| Notifications | `notifications` | own | 180 days |
| Audit log | `audit_logs` | admin | 365 days |
| Abuse reports | `abuse_reports` | staff | 180 days after closing |
| Product events | `events` | nobody | no PII, kept |

## What is never collected

Aadhaar/PAN numbers, ID scans, addresses, payment details, date of birth, photos of people.
A found ID document is quarantined at creation, not published.

## Consent points

1. The report form carries an unticked checkbox with the purpose and the deletion date inline —
   not a link to a policy.
2. Match alerts are a separate opt-in on `/account`, off by default.
3. Marketing is a second opt-in, also off by default.
4. Withdrawal is a toggle on `/account`, no email required.
5. Erasure is one button on `/account`; it files a request the desk completes within 7 days
   (the desk deletes the Supabase Auth user, which cascades).

## Enforcement

`public.housekeeping()` (migration `0003`, scheduled by `pg_cron` and optionally by Vercel cron):

```sql
-- 1. listings past their window stop being claimable
update items set status = 'expired' where status in ('available','claimed') and expires_at < now();

-- 2. thirty days later, the listing and its photos go
delete from items where status = 'expired' and expires_at < now() - interval '30 days';

-- 3. the smaller records
delete from notifications where created_at < now() - interval '180 days';
delete from audit_logs     where created_at < now() - interval '365 days';
delete from abuse_reports  where status = 'closed' and created_at < now() - interval '180 days';
delete from rate_limits    where window_start < now() - interval '2 days';
```

`lib/retention.ts` holds the same numbers as constants; `/legal/retention` renders them and
`/legal/privacy` interpolates them, so the published page cannot drift from the job. If you
change one, change both — the file has a comment saying so.

## Data subject requests

| Request | Path |
| --- | --- |
| See my data | `/account` shows profile, listings and claims |
| Correct it | `/account` |
| Withdraw consent | `/account` toggles |
| Erase | `/account` → request → staff deletes the auth user within 7 days |
| Export | ask the desk; a CSV of own listings and claims, delivered by email |

## Intermediary duties (India, IT Rules 2021)

The product is a listing surface for an institution, not a general-purpose intermediary, but
the safe posture is the same: publish the content policy (`/legal/terms`), provide a one-tap
report path on every listing, review reports within a day, keep an audit trail of removals, and
name a grievance contact (`NEXT_PUBLIC_SUPPORT_EMAIL`). This document is engineering guidance,
not legal advice — have the institution's counsel review the two legal pages before a public
launch.
