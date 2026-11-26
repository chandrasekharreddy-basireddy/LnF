import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminMetrics, currentUser, isAdmin, openReports } from '@/lib/data';
import { RoleForm, PurgeSamples } from '@/components/admin-role-form';
import { CloseReportForm } from '@/components/staff-actions';
import { Banner } from '@/components/banner';
import { formatDateTime } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/admin');
  if (!isAdmin(user)) {
    return (
      <div className="section" style={{ maxWidth: 520 }}>
        <h1>Admin only</h1>
        <p className="lede">Your account does not have the admin role.</p>
        <Link className="btn" href="/">
          Back to the board
        </Link>
      </div>
    );
  }

  const [metrics, reports] = await Promise.all([adminMetrics(), openReports()]);
  const rate = metrics?.cohort60d.rate;

  return (
    <div className="section" style={{ marginTop: 8 }}>
      <div className="section-head">
        <div>
          <p className="eyebrow">Admin</p>
          <h1 style={{ marginBottom: 4 }}>Recovery, not traffic</h1>
          <p className="muted small">One number matters: items handed in that went back to their owner.</p>
        </div>
        <div className="row">
          <Link className="btn btn-secondary btn-sm" href="/admin/users">
            Users
          </Link>
          <Link className="btn btn-secondary btn-sm" href="/admin/audit">
            Audit log
          </Link>
        </div>
      </div>

      <div className="stat-strip" style={{ marginBottom: 24 }}>
        <div className="stat">
          <b>{rate == null ? '—' : `${rate}%`}</b>
          <span>60-day recovery rate</span>
        </div>
        <div className="stat">
          <b>{metrics?.cohort60d.recovered ?? 0}</b>
          <span>Returned in 60 days</span>
        </div>
        <div className="stat">
          <b>{metrics?.medianDays != null ? `${metrics.medianDays}d` : '—'}</b>
          <span>Median days to return</span>
        </div>
        <div className="stat">
          <b>{metrics?.openReports ?? 0}</b>
          <span>Open reports</span>
        </div>
      </div>

      <div className="split">
        <div className="stack-lg">
          <section className="panel">
            <div className="panel-head">
              <strong>Listings by status</strong>
            </div>
            <div className="panel-body">
              <div className="pill-row">
                {Object.entries(metrics?.itemsByStatus ?? {}).map(([status, count]) => (
                  <span key={status} className="chip chip-quiet">
                    {status.replace(/_/g, ' ')}: {count}
                  </span>
                ))}
                {Object.keys(metrics?.itemsByStatus ?? {}).length === 0 ? (
                  <span className="small muted">No listings yet.</span>
                ) : null}
              </div>
              <hr className="divider" />
              <div className="pill-row">
                {Object.entries(metrics?.claimsByStatus ?? {}).map(([status, count]) => (
                  <span key={status} className="chip chip-quiet">
                    claims {status.replace(/_/g, ' ')}: {count}
                  </span>
                ))}
                {Object.keys(metrics?.claimsByStatus ?? {}).length === 0 ? (
                  <span className="small muted">No claims yet.</span>
                ) : null}
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <strong>Where things are found</strong>
            </div>
            <div className="panel-body">
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Zone</th>
                      <th scope="col">Found items</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(metrics?.zones ?? []).map((z) => (
                      <tr key={z.zone}>
                        <td>{z.zone}</td>
                        <td>{z.found}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <strong>Reports and erasure requests</strong>
            </div>
            <div className="panel-body stack">
              {reports.length ? (
                reports.map((r) => (
                  <div key={r.id} className="card card-tight">
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <strong className="small">{r.reason.replace(/_/g, ' ')}</strong>
                      <span className="small muted">{formatDateTime(r.at)}</span>
                    </div>
                    {r.details ? <p className="small">{r.details}</p> : null}
                    {r.itemRef ? (
                      <p className="small muted">
                        Listing {r.itemRef} — {r.itemTitle}
                      </p>
                    ) : null}
                    <CloseReportForm reportId={r.id} />
                  </div>
                ))
              ) : (
                <p className="small muted">Nothing open.</p>
              )}
            </div>
          </section>
        </div>

        <aside className="stack">
          <div className="panel">
            <div className="panel-head">
              <strong>Grant a role</strong>
            </div>
            <div className="panel-body">
              <RoleForm />
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <strong>Sample data</strong>
            </div>
            <div className="panel-body">
              <PurgeSamples />
            </div>
          </div>

          <Banner tone="info" title="Retention runs daily">
            Expired listings are hidden at 90 days and deleted 30 days later. The published retention page reads the
            same constants as the cleanup job.
          </Banner>
        </aside>
      </div>
    </div>
  );
}
