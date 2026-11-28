# Institution analytics, and the monthly report as a document

A lost-and-found is judged by one number: of the things people handed in, how many went back to
an owner. Everything else — page views, listings, claims — is a means to that end. This feature
is the answer to "what was our month?" in a form that can be printed, filed and forwarded, and
in a form that cannot be made to say something it does not know.

- migration `0031_institution_analytics.sql`
- page `/staff/analytics` (staff session)
- document `/api/staff/report/monthly?month=YYYY-MM` (staff session, `application/pdf`)
- pure logic `src/lib/monthly-report.ts`, tested by `tests/unit/monthly-report.test.ts`
  and `tests/unit/report-route.test.ts`
- database check `scripts/check-analytics-migration.py`

## What is counted

Two functions, both `SECURITY DEFINER`, both staff-only:

| Function | Returns | Who may call it |
| --- | --- | --- |
| `institution_analytics(p_from date, p_to date)` | one jsonb snapshot for the range | `is_staff()` only; `null` for anyone else; no `EXECUTE` grant to `anon` |
| `log_report_export(p_from date, p_to date)` | `{ok:true}` after one audit row | `is_staff()` only, rate-limited to 60 an hour per person |

The definitions are fixed in the SQL, not in the page, so the PDF and the screen cannot drift:

| Field | Definition |
| --- | --- |
| `handedIn` | found items, `is_sample = false`, `created_at::date` inside the range |
| `returned` | that same cohort, whose status is `recovered` now |
| `recoveryRate` | `returned / handedIn × 100`, one decimal, `null` when nothing was handed in |
| `lowSample` | `handedIn < 5` — 1 of 1 is 100% and means nothing |
| `handovers` | `handover_records` created inside the range (activity, not the cohort) |
| `medianDaysToRecovery` | median of `handover.created_at − item.created_at` for those records |
| `claimsSubmitted` | claims created inside the range |
| `claimsApproved` / `claimsRejected` | claims decided inside the range, by `decided_at` |
| `awaitingCollection` | found items in `claimed` right now |
| `openOnBoard` | found items in `available` right now |
| `lostReports` | lost items filed inside the range |
| `disputesOpened` / `disputesUpheld` | disputes created / upheld inside the range |

The cohort rule is the point. Counting "everything recovered this month" against "everything
handed in this month" produces rates above 100% and a number nobody can defend in a meeting. Here
the numerator is a subset of the denominator by construction, so the rate is a proportion.

`byZone`, `byCategory` and `byMonth` are the same arithmetic over the same cohort, and each
bucket carries its own `rate` and `lowSample`. `byMonth` is a `generate_series` of months, so a
month with nothing in it stays in the table as a zero row instead of vanishing — an empty month
is information.

Range rules: a reversed range returns `{ok:false,error:"RANGE_INVALID"}` rather than being
silently swapped; a range longer than a year is cut to 367 days and the payload says
`clamped: true`. Days are UTC days, because `created_at` is `timestamptz` and Supabase runs the
database in UTC. A report cut at a local midnight may differ by one day from the desk logbook;
the page and the PDF both say so.

No person-level field leaves the function. There is no claimant, no email, no reporter id —
counts and labels only. The check script asserts the payload text matches none of
`claimant|email|reporter_id|full_name|phone`.

## Authorization, in three places

1. **Postgres.** `institution_analytics()` returns `null` unless `is_staff()`; `EXECUTE` is
   revoked from `public` and `anon` and granted to `authenticated` and `service_role`. A page
   that forgot its check would get `null`, not numbers.
2. **The route.** `/api/staff/report/monthly` answers 401 without a session, 403 without a staff
   role, 400 for a month that is not `YYYY-MM`, 503 when the board cannot answer. It never
   renders an error page with numbers in it.
3. **The page.** `/staff/analytics` redirects to `/sign-in?next=/staff/analytics`, and shows
   "This report is for the desk" when the database refuses rather than an empty table.

The download is audited: one `report_exported` row per file, with the range in `detail`, written
through the existing hash-chained `audit_logs`. If that write fails the file is still served and
the failure is logged — refusing the report would punish the reader for the desk's outage.

## The PDF

There is no PDF library in this project. A report is four tables and a dozen figures, so
`src/lib/monthly-report.ts` writes PDF 1.4 directly:

- fixed object numbering (catalog, page tree, two Helvetica fonts, then a page and a content
  stream per page), a cross-reference table built from the byte offsets actually produced, and a
  `startxref` that points at it;
- A4, one column, left margin 56 pt, no images, no colour, no embedded fonts;
- every byte is ASCII: typographic punctuation is folded (`–` → `-`, `’` → `'`), anything else
  outside ASCII becomes `?`, and `(`, `)` and `\` are escaped. A report can be grepped;
- pagination keeps a heading with the three lines that follow it, repeats a table header when a
  table crosses a page, and puts the venue and `Page n of m` at the foot of every page;
- the numbers are the only input. The same snapshot produces byte-identical output, which the
  unit test asserts.

The report carries its own caveats, in the document rather than in a footnote: the cohort
definition, UTC days, sample rows excluded, what `(n=4)` means, and the sentence that no report
can see an item that was found and never handed in.

## What was verified, and what was not

Verified, in this repository:

- the whole migration chain applies to a real Postgres (0001 → 0031) and the functions enforce
  what they claim: `anon` has no execute, a member gets `null`, staff get the payload, the
  cohort adds up (6 handed in, 2 returned, 33.3%), the sample row is excluded, handovers and the
  median are arithmetic, `byZone`/`byCategory` sum to the cohort, a month with nothing in it is
  kept, a reversed range is refused, an over-long range is cut and flagged, the payload names no
  person, one export writes one audit row, the chain still verifies, and the 61st export in an
  hour is refused;
- the PDF opens in a real parser (PyMuPDF reports 2 pages and extracts the text), and its xref
  offsets point at the objects they claim;
- the route answers 401/403/400/503/200 with the right headers, serves `%PDF-1.4 … %%EOF`, names
  the file after the period, writes exactly one audit row, and contains no private field name;
- `npm run smoke` renders the page as a guarded route, checks it leaks no staff UI to a
  signed-out visitor, and checks the download answers 401 with text rather than a document.

Not verified:

- **the migration is not applied to the live Supabase project.** It is a file in the repo; the
  project owner applies it. Until then `/staff/analytics` shows "We could not load the numbers"
  in production and the download answers 503 — which is the honest state, not a broken one;
- the page rendering with a real signed-in staff session, in a browser. The route is unit-tested
  with a mocked session, and the page's guard is covered by smoke, but no automated test logs a
  real account in and reads the rendered tables;
- the PDF in Acrobat or a print pipeline. It was opened with PyMuPDF only;
- how the numbers look after a real month of use. The fixture data is synthetic.

## Running the checks

```bash
python3 scripts/check-analytics-migration.py   # needs: pip install pgserver; no network, no Supabase
npm test                                       # PDF bytes, route guards, month parsing
npm run build && npm run smoke                 # page guard, download refusal
```
