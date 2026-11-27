# Submission report — what each chapter needs

Maps the college template to this repository. Anything marked **[you]** needs a human: a name, a
signature, a screenshot, or a formatting choice.

## Front matter

| Item | Status |
| --- | --- |
| Title, student name(s), roll number(s), section, faculty, department, college | **[you]** |
| Logo or application screenshot on the cover | **[you]** — use `/` at 1440×900 once deployed |
| Certificate, declaration, acknowledgement | **[you]** — signatures and dates |

## Abstract (150–250 words) — draft

> Campus lost-and-found runs on notice boards, group chats and a cardboard box behind the
> security desk. An owner has no way to prove an item is theirs, a finder has no way to hand it
> over safely, and nobody can say how many items ever go home. L&F is a web application that
> replaces that with a single board and a staffed handover. Anyone can report what they lost or
> found; a finder must record one question only the owner could answer, and the answer is stored
> as a one-way hash. An owner claims an item by answering that question, a staff member approves
> the claim, and the release happens against a one-time handover code at the desk. The system is
> built with Next.js 16 and TypeScript on the front end, PostgreSQL with row-level security on
> Supabase for data and file storage, Brevo for email, and Vercel for hosting, entirely on free
> tiers. It enforces its own promises in the database rather than the interface: private fields
> are unreachable by anonymous callers, photos are re-encoded to strip location data, every staff
> action is written to a tamper-evident audit log, and a scheduled job enforces the retention
> window per category. The result is a working platform with 28 routes, 38 unit tests and 55
> browser tests, and a recovery rate the desk can actually measure.

## Chapter 1 — Introduction

- **1.1 Overview**: a stranger-to-owner custody system. One board, one counter, no payments.
- **1.2 Problem**: no proof of ownership, no safe handover, no measurement. Cite the current
  process (notice board, WhatsApp, cardboard box).
- **1.3 Scope**: in — reporting, search, claims, handover, desk console, admin, retention.
  Out — payments, courier, chat outside the board, native apps, multi-campus tenancy.

## Chapter 2 — Objectives and scope

Six objectives, each measurable:

1. Let a finder log an item in under a minute, including a photo.
2. Let an owner prove ownership without publishing anything private.
3. Keep handovers at a staffed desk, with a one-time code and photo ID for valuables.
4. Give the desk a queue, a dispute view and an auditable trail.
5. Measure recovery rate and median days to return, not page views.
6. Run at zero cost on free tiers, with security enforced in the database.

**Intended users**: anonymous visitor, member (reporter/claimant), staff, admin.
**Features**: see the route table in `README.md` — 28 routes, all implemented.

## Chapter 3 — Requirements

- **Hardware**: any laptop with 8 GB RAM for development; a mid-range Android phone for testing.
  Server-side, nothing: the free tiers host it.
- **Software**: Node 22, npm, VS Code, Chrome, Supabase (PostgreSQL 17), Vercel, Brevo.
- **Functional**: report lost/found, search and filter, claim with verification, staff decision,
  handover code, messaging, saved searches, disposal, roles, audit.
- **Non-functional**: WCAG 2.2 AA (axe-verified at three viewports), LCP under 2.5 s on 4G, RLS on
  every table, retention enforced by a job, no secrets in the client bundle.

## Chapter 4 — Technologies

Frontend: Next.js 16 App Router, React 19, TypeScript, hand-written CSS with design tokens, no UI
framework. Backend: Next.js server actions and Postgres functions (`SECURITY DEFINER`), no
separate API service. Database: PostgreSQL 17 on Supabase, RLS, `pg_trgm`, `pg_cron`, private
Storage. Libraries: `@supabase/ssr`, `sharp`, `qrcode`, Brevo API, Vitest, Playwright, axe.

## Chapter 5 — System design (needs the three diagrams)

| Diagram | What to draw | Source material |
| --- | --- | --- |
| Architecture | browser → Vercel (server components + actions) → Supabase (PostgREST → Postgres, Storage) → Brevo | `docs/architecture.md` |
| Data flow | report → moderation → publish → match → claim → decision → handover code → recovery | `docs/architecture.md` "Request paths" |
| ER diagram | 20 tables; the spine is `items → claims → handover_codes/handover_records`, with `profiles`, `user_roles`, `campus_zones`, `item_private`, `item_images` around it | `supabase/migrations/0001..0013` |

**Modules**: sign-in, board, item detail, report (found/lost), claim, messaging, saved, account,
staff desk, disposal, admin, retention job.

## Chapter 6 — Implementation

- **6.1 Frontend**: 28 routes; server components render, client components only for forms, the
  gallery, the palette and the scanner. Mention the skeleton loaders and the CSP nonce.
- **6.2 Backend**: every mutation is one Postgres function with its authorization inside it; the
  page never holds a key that can bypass RLS. Show `submit_claim` as the example.
- **6.3 Connectivity**: `@supabase/ssr` on the server, cookies for the session, RPC for every
  write, signed URLs for photos.
- **6.4 Key functionality**: report → claim → decide → handover, with the code path named.

## Chapter 7 — Screenshots (needs the deployed app)

Capture, at 1440×900 unless noted: home, browse with filters, item detail, report form (mobile
360×800), claim status with handover code, staff queue, staff item with witness field, disposal
queue, admin oversight panel, printed custody label, and the sign-in email (from Brevo's log).
Caption each `Figure 7.n — <screen>`.

## Chapter 8 — Testing

Approach: unit tests for pure logic, browser tests for the public flows at three viewports, axe
for accessibility, a route smoke gate, and SQL checks for authorization.

Genuine test cases you can paste (all were run):

| ID | Test | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| TC-01 | Search "airpods" when the listing says "earbuds" | the earbuds listing appears | matched via synonym expansion | Pass |
| TC-02 | `/items/<ref>` opened while signed out | question shown, answer absent | question visible, no private field in HTML | Pass |
| TC-03 | Open redirect `next=//evil.com` | refused, lands on `/account` | refused | Pass |
| TC-04 | Item flagged sensitive | no photo anywhere | "No photo shown", no `<img>` | Pass |
| TC-05 | Wrong handover code, five times | locked 15 minutes | locked, audit row at `alert` | Pass |
| TC-06 | Claimant posts "pay me via UPI" | blocked and quarantined | blocked, desk sees it, other party does not | Pass |
| TC-07 | Disposal attempted with an approved claim | refused | `HAS_APPROVED_CLAIM` | Pass |
| TC-08 | Dark theme at 360 px | no serious axe violations | 0 critical, 0 serious | Pass |

## Chapter 9 — Conclusion and future scope

Conclusion: the objectives were met; the interesting part was moving the security boundary into
the database. Limitations: single campus, no native app, email delivery depends on Brevo's free
tier, staff MFA not enforced. Future: claim-proof attachments behind a product decision, offline
handover passes, multi-venue tenancy, SMS fallback.

## Chapter 10 — References

Next.js App Router docs; Supabase Auth/RLS/Storage docs; PostgreSQL 17 docs (`pg_trgm`, `pg_cron`,
row security policies); WCAG 2.2; OWASP ASVS; Brevo API v3; Vercel cron docs. Add access dates.

## Final checklist (from the template)

| Item | Status |
| --- | --- |
| Cover page with title and student details | **[you]** |
| Certificate, declaration, acknowledgement | **[you]** |
| Abstract and table of contents | draft above; TOC **[you]** |
| All chapters using the actual project | content ready in this repo |
| Architecture / workflow / database diagram | **not drawn yet** |
| Actual screenshots with captions | **needs the deployed app** |
| Test cases with genuine results | table above |
| References with URLs and dates | **[you]** |
| Spelling, page numbers, formatting | **[you]** — A4, Times New Roman 12 pt, 1.5 spacing |
| Exported as PDF | **[you]** |
