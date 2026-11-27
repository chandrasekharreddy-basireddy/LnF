# L&F — lost and found

**Find it. Verify it. Collect it at the desk.**

A complete lost-and-found platform: public board with search, lost and found reports with
private verification, claims with a staffed review, one-time handover codes, a staff desk,
an admin console, and a retention job that actually deletes things. Built to run on free
tiers end to end — Supabase (database, storage, auth), Vercel (hosting), Brevo (email) —
and to be safe for a campus or an office where strangers meet strangers.

```
Next.js 16 (App Router) · TypeScript · Postgres/RLS · Supabase Storage · Brevo · Vercel
```

## What is actually enforced, and where

| Promise | Enforced by |
| --- | --- |
| A sign-in code is throttled, single-use, and never stored in the clear | `check_signin_allowed()` + Supabase Auth tokens + hash-only `auth_events` |
| Injected script has no way in | nonce-based CSP minted per request in `src/proxy.ts`, asserted by smoke |
| A failed email is retried, never lost | `email_outbox` + `sendOrQueue`, dispatched by the daily cron with a dedupe key |
| Public pages can never see answers, contacts, serials, bins | `public_items` / `public_item_images` views + column-list projection function; base tables have no `anon` grant |
| Staff pages need a real role | `is_staff()` / `is_admin()` checked inside `SECURITY DEFINER` functions, not in the page |
| A claim cannot be double-released | partial unique index on open claims, handover code hashed and single-use, `handover_records` + audit row |
| Photos carry no location data | every upload re-encoded through `sharp` server-side; EXIF dropped |
| Retention happens | `public.housekeeping()` runs daily via `pg_cron` (and via Vercel cron when a service key is present) |
| A wrong claim answer teaches nothing | answer compared as a hash; the claimant never sees whether it matched |
| A push subscription cannot be hijacked or read | `push_subscriptions` RLS + `register_push_subscription()` takes `auth.uid()`, never an argument; no write grant exists |

## Routes

| Route | What it does |
| --- | --- |
| `/` | Search, two actions, live board counts, recent items |
| `/browse` | Filterable list; every filter lives in the URL |
| `/items/[ref]` | One item, its verification question, claim entry, report-a-listing |
| `/report/found`, `/report/lost` | Intake forms with photo privacy, consent notice, full error states |
| `/claims`, `/claims/[ref]` | Claim list, one-time handover code, and a masked message thread |
| `/account` | Profile, alerts opt-in, your listings, erasure request |
| `/staff/import` | Paste a backlog spreadsheet: 500 rows a pass, same validation and quarantine as a single intake |
| `/staff`, `/staff/items/[ref]` | Desk queue, claim review, handover confirmation, listing controls |
| `/staff/scan`, `/staff/disposal`, `/staff/items/[ref]/label` | Counter scanner, disposal queue, printable 2×3in custody label |
| `/account/saved` | Saved items and saved searches |
| `/admin`, `/admin/users`, `/admin/audit` | Recovery metrics, roles, audit log, sample purge |
| `/legal/privacy`, `/legal/retention`, `/legal/terms`, `/safety`, `/how-it-works` | The written promises, generated from the same constants the code uses |
| `/api/health`, `/api/cron/housekeeping`, `/api/cron/push` | Liveness, the daily job, and the push dispatcher |
| `/api/push/config` | The VAPID public key, or `{enabled:false}` — public and safe |

## Quick start

```bash
cp .env.example .env.local     # fill in the two Supabase values
npm install
npm run dev                    # http://localhost:3000
```

Then follow **[docs/deployment.md](docs/deployment.md)** — it covers the database, the
Brevo SMTP settings inside Supabase, Vercel, the cron, and the first admin account.

## Roles

Roles are server-assigned only; there is no policy that lets a browser write `user_roles`.

```sql
-- after that person has signed in once
select public.bootstrap_role('someone@campus.edu', 'admin');
```

Admins grant the rest from `/admin/users`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | production build |
| `npm run lint` | ESLint 9 flat config: typescript-eslint, react-hooks, jsx-a11y, no `any` |
| `npm test` | 105 unit tests over the pure logic: path guard, antifraud scan, code extraction, email escaping, push payloads and WhatsApp links |
| `npm run smoke` | starts a local mock of the Supabase API, renders 26 routes, asserts content, privacy, CSP, the redirect guard, the push config and the WhatsApp link — and fails the build when a check fails |
| `npm run e2e` | builds against the mock, then runs Playwright + axe at 360/768/1440 (39 tests) |
| `npm run shots` | screenshots key pages (needs a browser that can reach localhost) |

The mock exists because CI and sandboxes usually cannot reach the live project. It mirrors
the real RPC response shapes in `supabase/migrations/0003_functions.sql`.

## Layout

```
src/app/            routes (public, staff, admin, api)
src/components/     UI, one file per pattern
src/lib/            data access, types, copy, validation, email, actions
supabase/migrations 0001..0008 — schema, RLS, functions, storage, seeds, stats, bootstrap
docs/               deployment, architecture, security, operations, privacy
```

## Status

Feature-complete, building clean, and gated by two CI jobs: `verify` (lint → typecheck →
build → client-bundle guardrail) and `e2e` (Playwright + axe, 37 passing, 2 viewport-specific
skips). Two things are deliberately left to a human: connecting Vercel, and pasting the
service-role key if you want photo cleanup and email retries driven by the Vercel cron.
Neither blocks launch — `pg_cron` already runs retention.
