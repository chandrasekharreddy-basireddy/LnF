import type { Metadata } from 'next';
import { RETENTION, RETENTION_ROWS } from '@/lib/retention';

export const metadata: Metadata = { title: 'Retention', description: 'How long L&F keeps each kind of record.' };

export default function RetentionPage() {
  return (
    <article className="section" style={{ marginTop: 8, maxWidth: 760 }}>
      <p className="eyebrow">Legal</p>
      <h1>Retention</h1>
      <p className="lede">
        Every window below is enforced by a scheduled job, not by good intentions. The numbers on this page are read
        from the same constants the job runs on, so they cannot drift apart.
      </p>

      <div className="panel" style={{ marginTop: 24 }}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Record</th>
                <th scope="col">Kept for</th>
                <th scope="col">Then</th>
              </tr>
            </thead>
            <tbody>
              {RETENTION_ROWS.map((row) => (
                <tr key={row.record}>
                  <td>{row.record}</td>
                  <td>{row.kept}</td>
                  <td className="muted">{row.then}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h2 style={{ marginTop: 32 }}>How the job runs</h2>
      <p>
        A daily job (Vercel cron, with a database-side fallback) does four things: expires listings past their window,
        deletes records {RETENTION.purgeAfterExpiryDays} days after expiry, clears old notifications and audit entries,
        and nudges the reporter of anything about to expire. Every run writes one event with counts and no personal
        data.
      </p>

      <h2>What survives a deletion</h2>
      <p>
        The handover record for a returned item keeps the item reference and the date, with no claimant details, so the
        recovery rate stays computable. Abuse reports that were closed are kept {RETENTION.closedReportDays} days, then
        deleted.
      </p>
    </article>
  );
}
