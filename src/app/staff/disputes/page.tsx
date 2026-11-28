import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, disputeQueue, isStaff } from '@/lib/data';
import { Banner } from '@/components/banner';
import { DisputeDecide } from '@/components/dispute-decide';
import { StatusChip } from '@/components/status-chip';
import { formatDateTime } from '@/lib/validation';
import { TRUST_LABEL_TEXT, trustLabel, trustSummary } from '@/lib/trust';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Disputes', robots: { index: false, follow: false } };

export default async function StaffDisputesPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/staff/disputes');
  if (!isStaff(user)) redirect('/');

  const rows = await disputeQueue(50);

  return (
    <div className="section" style={{ marginTop: 8 }}>
      <Link className="small" href="/staff">
        ← Desk
      </Link>
      <div className="section-head" style={{ marginTop: 8 }}>
        <div>
          <p className="eyebrow">Oversight</p>
          <h1 style={{ marginBottom: 4 }}>Disputes</h1>
          <p className="muted small">
            Claims someone asked us to look at again, oldest first. Each row carries the claimant&apos;s own history
            beside the reason they gave. Upholding puts a rejected claim back in the review queue while the item is
            still with us; after a handover it records the finding and nothing else.
          </p>
        </div>
        {rows ? <span className="chip chip-quiet">{rows.length} waiting</span> : null}
      </div>

      <div style={{ margin: '18px 0' }}>
        <Banner tone="info" title="A dispute is a request for a second look">
          It is not evidence that someone lied. One upheld dispute means the first decision was wrong — which is what
          this room is for — and the history column is a count of what happened, not a verdict.
        </Banner>
      </div>

      {rows === null ? (
        <div className="card text-center" style={{ padding: 32 }}>
          <h3>We could not load the queue</h3>
          <p className="muted small">
            The database refused the request, or this account is not staff. Reload in a moment; nothing was changed.
          </p>
          <Link className="btn" href="/staff/disputes">
            Try again
          </Link>
        </div>
      ) : rows.length === 0 ? (
        <div className="card text-center" style={{ padding: 32 }}>
          <h3>Nothing waiting</h3>
          <p className="muted small">
            A dispute appears here when a claimant or a finder contests a decision within 14 days of it.
          </p>
        </div>
      ) : (
        <div className="stack">
          {rows.map((row) => {
            const label = trustLabel(row.trust);
            return (
              <div className="panel" key={row.ref}>
                <div className="panel-head row" style={{ justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <strong>{row.itemTitle}</strong>
                    <div className="item-ref">
                      <span className="mono">{row.ref}</span> · claim <span className="mono">{row.claimRef}</span> ·
                      item <span className="mono">{row.itemRef}</span>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <StatusChip status={row.claimStatus} />
                    <span className={`chip ${row.ageDays >= 5 ? 'chip-danger' : row.ageDays >= 2 ? 'chip-warn' : 'chip-quiet'}`}>
                      {row.ageDays === 0 ? 'today' : `${row.ageDays}d old`}
                    </span>
                  </div>
                </div>
                <div className="panel-body">
                  <p className="small" style={{ whiteSpace: 'pre-wrap' }}>
                    <strong>{row.openerRole === 'finder' ? 'Finder' : 'Claimant'} wrote:</strong> {row.reason}
                  </p>

                  <div className="card card-tight" style={{ margin: '10px 0 14px' }}>
                    <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                      <strong className="small">{row.claimant}</strong>
                      <span className={`chip ${label === 'watch' ? 'chip-warn' : label === 'established' ? 'chip-ok' : 'chip-quiet'}`}>
                        {TRUST_LABEL_TEXT[label]}
                      </span>
                    </div>
                    <p className="small muted" style={{ margin: '6px 0 0' }}>
                      {trustSummary(row.trust)}
                      {row.claimantEmail ? ` · ${row.claimantEmail}` : ''}
                    </p>
                  </div>

                  <p className="small muted" style={{ marginBottom: 12 }}>
                    Opened {formatDateTime(row.createdAt)}
                    {row.itemStatus === 'recovered' ? ' · the item has already been handed over, so upholding records only' : ''}
                  </p>

                  <DisputeDecide disputeRef={row.ref} />

                  <div className="row" style={{ gap: 8, marginTop: 12 }}>
                    <Link className="btn btn-ghost btn-sm" href={`/disputes/${row.ref}`}>
                      Open the room
                    </Link>
                    <Link className="btn btn-ghost btn-sm" href={`/staff/items/${row.itemRef}`}>
                      Open the item
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
