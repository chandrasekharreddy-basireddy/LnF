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
| Public pages can never see answers, contacts, serials, bins | `public_items` / `public_item_images` views + column-list projection function; base tables have no `anon` grant |
| Staff pages need a real role | `is_staff()` / `is_admin()` checked inside `SECURITY DEFINER` functions, not in the page |
| A claim cannot be double-released | partial unique index on open claims, handover code hashed and single-use, `handover_records` + audit row |
| Photos carry no location data | every upload re-encoded through `sharp` server-side; EXIF dropped |
| Retention happens | `public.housekeeping()` runs daily via `pg_cron` (and via Vercel cron when a service key is present) |
| A wrong claim answer teaches nothing | answer compared as a hash; the claimant never sees whether it matched |

## Routes

| Route | What it does |
| --- | --- |
| `/` | Search, two actions, live board counts, recent items |
| `/browse` | Filterable list; every filter lives in the URL |
| `/items/[ref]` | One item, its verification question, claim entry, report-a-listing |
| `/report/found`, `/report/lost` | Intake forms with photo privacy, consent notice, full error states |
| `/claims`, `/claims/[ref]` | Claim list and one-time handover code |
| `/account` | Profile, alerts opt-in, your listings, erasure request |
| `/staff`, `/staff/items/[ref]` | Desk queue, claim review, handover confirmation, listing controls |
| `/admin`, `/admin/users`, `/admin/audit` | Recovery metrics, roles, audit log, sample purge |
| `/legal/privacy`, `/legal/retention`, `/legal/terms`, `/safety`, `/how-it-works` | The written promises, generated from the same constants the code uses |
| `/api/health`, `/api/cron/housekeeping` | Liveness, and the daily job |

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
| `npm run smoke` | starts a local mock of the Supabase API, renders 21 routes, asserts content and privacy |
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

Feature-complete and building clean. Deployed with a real Supabase project; the pages were
verified against a local mock of the API (see `npm run smoke`). Two things are deliberately
left to a human: connecting Vercel, and pasting the service-role key if you want photo
cleanup in the Vercel cron. Neither blocks launch — `pg_cron` already runs retention.
