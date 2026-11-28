import { NextResponse } from 'next/server';
import { currentUser, institutionAnalytics, isStaff, logReportExport } from '@/lib/data';
import { env } from '@/lib/env';
import { buildReportPdf, monthKey, monthRange, reportFilename } from '@/lib/monthly-report';

export const dynamic = 'force-dynamic';

function text(body: string, status: number) {
  return new NextResponse(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * The monthly report as a PDF.
 *
 * Deliberately not public: this is every zone, every category and the recovery
 * rate of the whole institution. Three gates, in this order, because each one
 * answers a different question:
 *
 *   1. the route — is anyone signed in? (401 if not)
 *   2. the route — does that session hold staff or admin? (403 if not)
 *   3. Postgres — `institution_analytics()` returns null to anyone else, so a
 *      mistake in this file still cannot produce a document.
 *
 * The download is written to the audit log as `report_exported`. If that write
 * fails the file is still served, and the failure is logged: refusing the
 * report would punish the reader for the desk's outage.
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return text('Sign in to download the institution report.', 401);
  if (!isStaff(user)) return text('This report is for the desk. Your account does not have staff access.', 403);

  const month = new URL(request.url).searchParams.get('month') ?? monthKey();
  const range = monthRange(month);
  if (!range) return text('Use ?month=YYYY-MM, for example ?month=2026-11.', 400);

  const result = await institutionAnalytics(range.from, range.to);
  if (!result.ok) {
    if (result.error === 'RANGE_INVALID') return text('That period is not valid.', 400);
    if (result.error === 'FORBIDDEN') return text('This report is for the desk.', 403);
    return text('The board could not answer just now. Nothing was changed; try again in a moment.', 503);
  }

  const logged = await logReportExport(range.from, range.to);
  if (!logged) console.error(`report export audit row not written for ${range.from}..${range.to}`);

  const pdf = buildReportPdf({ snapshot: result.snapshot, venue: env.campusName });

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${reportFilename(range.from, range.to)}"`,
      'cache-control': 'no-store',
    },
  });
}
