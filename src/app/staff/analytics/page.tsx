import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, institutionAnalytics, isStaff } from '@/lib/data';
import { Banner } from '@/components/banner';
import {
  formatDays,
  formatPeriod,
  formatRate,
  formatRateCell,
  formatStamp,
  monthKey,
  monthRange,
  recentMonths,
  type ReportBucket,
} from '@/lib/monthly-report';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Analytics', robots: { index: false, follow: false } };

function Table({ head, rows }: { head: string[]; rows: { key: string; cells: string[] }[] }) {
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" style={i === 0 ? undefined : { textAlign: 'right' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {row.cells.map((cell, i) => (
                <td key={`${row.key}-${i}`} style={i === 0 ? undefined : { textAlign: 'right' }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function bucketRow(bucket: ReportBucket, withHandovers = false) {
  const cells = [
    bucket.label,
    String(bucket.handedIn),
    String(bucket.returned),
    ...(withHandovers ? [String(bucket.handovers ?? 0)] : []),
    formatRateCell(bucket.rate, bucket.lowSample, bucket.handedIn),
  ];
  return { key: bucket.key, cells };
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/staff/analytics');
  if (!isStaff(user)) redirect('/');

  const params = await searchParams;
  const months = recentMonths(12);
  const selected = monthRange(params.month) ?? monthRange(monthKey()) ?? months[0];
  const result = await institutionAnalytics(selected.from, selected.to);

  return (
    <div className="section" style={{ marginTop: 8 }}>
      <Link className="small" href="/staff">
        ← Desk
      </Link>
      <div className="section-head" style={{ marginTop: 8 }}>
        <div>
          <p className="eyebrow">Institution</p>
          <h1 style={{ marginBottom: 4 }}>What happened to the things we held</h1>
          <p className="muted small">
            One month at a time, from the desk&apos;s own records. The rate is the share of items handed in during the
            month that went back to an owner — not the share of page views, and not a guess.
          </p>
        </div>
        <form method="get" action="/staff/analytics" className="row" style={{ gap: 8, alignItems: 'end' }}>
          <label className="field" style={{ margin: 0 }}>
            <span className="small muted">Month</span>
            <select name="month" defaultValue={selected.key}>
              {months.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-secondary btn-sm" type="submit">
            Show
          </button>
        </form>
      </div>

      {!result.ok ? (
        <div className="card text-center" style={{ padding: 32 }}>
          <h3>
            {result.error === 'FORBIDDEN'
              ? 'This report is for the desk'
              : result.error === 'RANGE_INVALID'
                ? 'That month is not valid'
                : 'We could not load the numbers'}
          </h3>
          <p className="muted small">
            {result.error === 'FORBIDDEN'
              ? 'Your account does not have staff access. The database refused the request, not the page.'
              : result.error === 'RANGE_INVALID'
                ? 'Pick a month from the list. The report covers one calendar month at a time.'
                : 'The board did not answer. Nothing was changed; reload in a moment.'}
          </p>
          <Link className="btn" href="/staff/analytics">
            Try again
          </Link>
        </div>
      ) : (
        <>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, margin: '8px 0 16px' }}>
            <div>
              <p className="small muted" style={{ margin: 0 }}>
                {formatPeriod(result.snapshot.from, result.snapshot.to)} · generated {formatStamp(result.snapshot.generatedAt)}
              </p>
            </div>
            <Link
              className="btn btn-sm"
              href={`/api/staff/report/monthly?month=${selected.key}`}
              prefetch={false}
            >
              Download the PDF
            </Link>
          </div>

          {result.snapshot.clamped ? (
            <div style={{ marginBottom: 16 }}>
              <Banner tone="info" title="This report is capped at a year">
                A longer range was requested, so this covers the last 367 days of it. It is not a full history.
              </Banner>
            </div>
          ) : null}

          <div className="stat-strip" style={{ marginBottom: 24 }}>
            <div className="stat">
              <b>{result.snapshot.totals.handedIn}</b>
              <span>Handed in</span>
            </div>
            <div className="stat">
              <b>{result.snapshot.totals.returned}</b>
              <span>Returned to an owner</span>
            </div>
            <div className="stat">
              <b>{formatRate(result.snapshot.totals.recoveryRate, false)}</b>
              <span>Recovery rate</span>
            </div>
            <div className="stat">
              <b>{formatDays(result.snapshot.totals.medianDaysToRecovery)}</b>
              <span>Median time to return</span>
            </div>
          </div>

          {result.snapshot.totals.lowSample ? (
            <div style={{ marginBottom: 20 }}>
              <Banner tone="warn" title="Small sample">
                Only {result.snapshot.totals.handedIn} items were handed in this month. A rate on that few items is a
                description, not a trend — read it next to the counts, never on its own.
              </Banner>
            </div>
          ) : null}

          <div className="grid grid-3" style={{ marginBottom: 24 }}>
            <div className="stat">
              <b>{result.snapshot.totals.claimsSubmitted}</b>
              <span>Claims submitted</span>
            </div>
            <div className="stat">
              <b>{result.snapshot.totals.claimsApproved}</b>
              <span>Claims approved</span>
            </div>
            <div className="stat">
              <b>{result.snapshot.totals.awaitingCollection}</b>
              <span>Waiting to be collected</span>
            </div>
          </div>

          <section className="panel" style={{ marginBottom: 24 }}>
            <div className="panel-head">
              <strong>Where items were found</strong>
            </div>
            <div className="panel-body">
              {result.snapshot.byZone.length ? (
                <Table
                  head={['Zone', 'In', 'Returned', 'Rate']}
                  rows={result.snapshot.byZone.map((b) => bucketRow(b))}
                />
              ) : (
                <p className="small muted">Nothing was handed in during this month.</p>
              )}
            </div>
          </section>

          <section className="panel" style={{ marginBottom: 24 }}>
            <div className="panel-head">
              <strong>What kind of thing it was</strong>
            </div>
            <div className="panel-body">
              {result.snapshot.byCategory.length ? (
                <Table
                  head={['Category', 'In', 'Returned', 'Rate']}
                  rows={result.snapshot.byCategory.map((b) => bucketRow(b))}
                />
              ) : (
                <p className="small muted">Nothing was handed in during this month.</p>
              )}
            </div>
          </section>

          <section className="panel" style={{ marginBottom: 24 }}>
            <div className="panel-head">
              <strong>Month by month</strong>
            </div>
            <div className="panel-body">
              <Table
                head={['Month', 'In', 'Returned', 'Handovers', 'Rate']}
                rows={result.snapshot.byMonth.map((b) => bucketRow(b, true))}
              />
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <strong>How to read this</strong>
            </div>
            <div className="panel-body">
              <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
                <li>
                  The cohort is every found item taken in during the month, and &ldquo;returned&rdquo; counts that same
                  cohort. An item handed in earlier and collected this month appears under handovers, not in the rate.
                </li>
                <li>Days are UTC days, the clock the database keeps. A local midnight may differ by one day.</li>
                <li>Sample rows are excluded, so the demo board never inflates the numbers.</li>
                <li>
                  A rate followed by a count in brackets, such as (n=4), rests on fewer than 5 items: 1 of 1 is 100% and
                  means nothing.
                </li>
                <li>
                  These are counts of what the desk recorded. An item found and never handed in does not appear here.
                </li>
                <li>Every download of the PDF is written to the audit log.</li>
              </ul>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
