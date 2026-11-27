# Deployment — free, fast, secure

Everything here runs on free tiers. Total monthly cost: ₹0.

| Layer | Service | Free allowance used |
| --- | --- | --- |
| Hosting + server actions | Vercel Hobby | 100 GB bandwidth, unlimited deploys |
| Database, storage, auth | Supabase Free | 500 MB DB, 1 GB storage, 50k MAU |
| Transactional email | Brevo Free | 300 emails/day |
| Scheduler | `pg_cron` inside Supabase | included |
| CI | GitHub Actions | 2,000 min/month |

Region chosen: **ap-south-1 (Mumbai)** — lowest latency for users in India.

---

## 1. Database (already done for this project)

Project ref: `<your-project-ref>` (Project Settings → General). The schema is applied in
seventeen migrations; this repository is deployed against a live project in `ap-south-1`, and
the values below are the ones that project uses — swap in yours.

| File | Contents |
| --- | --- |
| `0001_core.sql` | enums, tables, indexes, triggers, ref-code sequences, profile-on-signup |
| `0002_views_rls.sql` | public projection views, RLS policies, grants |
| `0003_functions.sql` | search, item detail, create/claim/staff/admin RPCs, housekeeping |
| `0004_storage_seed.sql` | private photo bucket + policies, 10 zones, sample rows |
| `0005_photo_policies.sql` | photo insert/delete for owners, public read of published photos |
| `0006_search_cover.sql` | browse results carry a cover path (one signed-URL call per page) |
| `0007_stats_truth.sql` | open counts describe the board; recovered counts only count real handovers |
| `0008_role_bootstrap.sql` | `bootstrap_role()` for the first admin |
| `0009_security_hardening.sql` | claim-approval lock, handover lockout, column-scoped profile writes, anon RPC revocations |
| `0010_email_outbox.sql` | outbox table plus queue/claim/finish functions |
| `0011_claim_messages.sql` | masked thread, the extortion/PII scanner, thread read model |
| `0012_saved_items_and_searches.sql` | saved items, saved searches, the nightly match job |
| `0013_retention_and_disposal.sql` | per-category retention, disposal queue, auditable dispositions |
| `0014_audit_fixes.sql` | quarantine stub, anon revocations, message RLS, handover locking, retention guard, the pg_cron schedule |
| `0015_audit_followups.sql` | approved-claim guards on status change and disposal, sequence revocation, seed dedupe |
| `0016_auth_layer.sql` | sign-in throttle, hash-only auth audit, `email_verified_at` |
| `0017_pgcrypto_search_path.sql` | makes `digest()` reachable inside the definer functions — without it, reporting, claiming, approving and handover all fail at runtime |

To rebuild from scratch on a new project, paste each file into the SQL editor in order, or:

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

## 2. Supabase Auth — email codes through Brevo

Sign-in emails are sent by the app itself (see `docs/auth-architecture.md`): the code is
minted with the admin API and delivered through Brevo with our template. **If you set
`SUPABASE_SERVICE_ROLE_KEY`, the SMTP settings below are only needed for the fallback path.**
If you skip the service key, configure them — Supabase sends the mail instead.

1. **Brevo → SMTP & API → SMTP.** Create an SMTP key. Note host `smtp-relay.brevo.com`,
   port `587`, login `your-brevo-login`, and the key as password.
2. **Supabase → Project Settings → Authentication → SMTP Settings.** Enable custom SMTP and
   paste host, port 587, the Brevo login, and the key. Sender: the address you verified in
   Brevo (e.g. `no-reply@yourdomain`).
3. **Authentication → Sign In / Providers → Email.** Turn **off** "Confirm email" only if you
   want instant sign-in; leave it on and the 6-digit code path still works. Set **Email OTP
   expiry** to 600 seconds.
4. **Authentication → Emails → Magic Link.** Replace the template body with
   `supabase/email-templates/magic-link.html`. It must contain `{{ .Token }}` — that is the
   six digits the sign-in screen asks for. Without it, users only get a link.
5. **Authentication → URL Configuration.** Site URL: your Vercel domain. Redirect URLs:
   `https://your-domain/auth/confirm` and `http://localhost:3000/auth/confirm`.
6. **Project Settings → API.** Copy the URL and the publishable (`sb_publishable_…`) key.
   The service-role key is optional — see step 5.

## 3. Vercel

1. **Add New → Project → Import** the GitHub repo. Framework is detected as Next.js; no
   build settings to change.
2. **Environment variables** (Production and Preview):

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<your-project-ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the publishable key |
   | `NEXT_PUBLIC_SITE_URL` | `https://your-domain` |
   | `NEXT_PUBLIC_CAMPUS_NAME` | e.g. `Sai University` |
   | `NEXT_PUBLIC_DESK_LABEL` | e.g. `Main Gate & Security Desk` |
   | `NEXT_PUBLIC_SUPPORT_EMAIL` | a real inbox |
   | `BREVO_API_KEY` | Brevo **API** key (v3), not the SMTP key |
   | `BREVO_SENDER_EMAIL` | same verified sender as Supabase |
   | `BREVO_SENDER_NAME` | `L&F` |
   | `CRON_SECRET` | a long random string (`openssl rand -hex 24`) |
   | `SUPABASE_SERVICE_ROLE_KEY` | optional, see step 5 |
   | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | optional, web push — `npx web-push generate-vapid-keys` |
   | `VAPID_SUBJECT` | `mailto:` or `https:` contact for the push service |
   | `DESK_WHATSAPP_NUMBER` | optional, e.g. `+91 98765 43210`; no number, no button |

   `NEXT_PUBLIC_*` values are baked in at build time — changing one needs a redeploy.

3. Deploy, then open `/api/health`. It should return `{"status":"ok","database":"reachable"}`.
4. Add your domain in **Settings → Domains**, then update `NEXT_PUBLIC_SITE_URL` and the
   Supabase redirect URLs to match.

## 4. First admin

Sign in once with the email that will own the desk, then in the Supabase SQL editor:

```sql
select public.bootstrap_role('you@campus.edu', 'admin');
```

Reload `/admin`. Everyone else is granted `staff` from `/admin/users` — they must sign in
once first so a profile row exists.

## 5. Scheduler

Two independent schedules; keep both.

| Job | Where | What it covers |
| --- | --- | --- |
| `pg_cron` `lnf-housekeeping` at 02:15 UTC | Supabase, scheduled by migration `0014` | expiry, retention deletes, nudges — works with no secrets |
| `/api/cron/housekeeping` at 02:00 UTC | Vercel (`vercel.json`) | same job, **plus** photo deletion and **email retries** from `email_outbox` |

The Vercel run also drains `email_outbox`: any send that Brevo refused during the day is
retried up to three times, keyed so a retry can never become a second email.

Web push is a third, separate job: `/api/cron/push` (bearer `CRON_SECRET`, service role) drains
notifications queued for push. It is **not** in `vercel.json`, because Hobby crons run once a day
and a lock-screen alert a day late is not an alert. Point any 15-minute scheduler at it — see
[docs/notifications.md](notifications.md).

The Vercel job returns 503 with a clear message when `SUPABASE_SERVICE_ROLE_KEY` is absent —
that is expected, not an error. Add the key and photos get cleaned up too. Vercel sends
`Authorization: Bearer $CRON_SECRET` automatically.

Check the database job:

```sql
select jobname, schedule, active from cron.job;
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
```

## 6. What CI proves before you deploy

Two jobs run on every push. `verify`: `npm run lint` → `npm test` → `typecheck` → `build` → `smoke` → a
guardrail that fails if a private field name (`answer_hash`, `bin_code`, `finder_contact`)
appears in the client bundle or server render. `e2e`: builds against the local mock, then runs Playwright + axe at
360/768/1440 — search, filter persistence, the privacy assertions on item detail, 360px
overflow, the skip link, and zero critical or serious axe violations on five routes.

Playwright needs its own Chromium: `npx playwright install --with-deps chromium` (CI does this
for you). `npm run e2e` rebuilds with the mock URL, so run `npm run build` again afterwards if
you want a production build in `.next`.

## 7. Launch checklist

- [ ] `/api/health` returns `ok` and `database: reachable`
- [ ] Sign in with a real address; the code email arrives within a minute
- [ ] Post a found item with a photo; confirm the photo shows and the listing appears on `/browse`
- [ ] Post a second account, claim the item, approve it at `/staff`, confirm the handover code
      appears once and that a second visit shows "code already shown"
- [ ] Confirm an expired listing disappears (`select public.housekeeping();` in SQL is safe to run manually)
- [ ] `/admin` shows a non-zero recovery rate after the first handover
- [ ] Print the desk card and zone posters, and seed the real backlog (see `docs/operations.md`)
- [ ] Delete the sample rows: `/admin` → *Remove sample listings*

## Costs and limits to watch

| Limit | Free value | What happens at the limit |
| --- | --- | --- |
| Supabase DB | 500 MB | ~200k listings before it matters; photos live in Storage |
| Supabase Storage | 1 GB | ~2,500 photos at 400 KB after re-encode |
| Supabase projects | 2 active | pause an old project to free a slot |
| Brevo email | 300/day | auth codes stop; raise the plan or add a second sender |
| Vercel bandwidth | 100 GB | static assets are tiny; photos are served from Supabase |
| Supabase idle pause | 7 days | free projects pause after a week with no traffic; the first request after that is slow |

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Auth session missing` on every page | anon key missing or wrong in Vercel | re-check `NEXT_PUBLIC_SUPABASE_ANON_KEY`, redeploy |
| Sign-in email never arrives | Brevo SMTP not verified, or sender not verified | check Supabase Auth logs, then Brevo transactional log |
| `permission denied for table items` | a query reached a base table instead of a view | use `public_items` or the RPCs; base tables are intentionally not granted |
| Photos 400/403 | bucket policy or expired signed URL | signed URLs last 1 hour by design; reload the page |
| Cron returns 401 | `CRON_SECRET` missing in Vercel | set it, redeploy |
| Build fails on `sharp` | wrong platform binary in lockfile | delete `node_modules` and `package-lock.json`, reinstall on Linux |
