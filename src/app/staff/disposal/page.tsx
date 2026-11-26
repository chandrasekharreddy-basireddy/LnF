import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, disposalQueue, isStaff } from '@/lib/data';
import { DisposalForm } from '@/components/disposal-form';
import { StatusChip } from '@/components/status-chip';
import { Banner } from '@/components/banner';
import { formatDate } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Disposal', robots: { index: false, follow: false } };

export default async function DisposalPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/staff/disposal');
  if (!isStaff(user)) redirect('/');

  const queue = await disposalQueue();

  return (
    <div className="section" style={{ marginTop: 8 }}>
      <Link className="small" href="/staff">
        ← Desk
      </Link>
      <div className="section-head" style={{ marginTop: 8 }}>
        <div>
          <p className="eyebrow">End of life</p>
          <h1 style={{ marginBottom: 4 }}>Disposal queue</h1>
          <p className="muted small">
            Everything expiring in the next seven days, plus anything already expired. One disposition per item, with
            a note that stays in the audit log.
          </p>
        </div>
        <span className="chip chip-quiet">{queue.length} waiting</span>
      </div>

      <div style={{ margin: '18px 0' }}>
        <Banner tone="info" title="Nothing is thrown away quietly">
          Records the outcome, who recorded it and when. A donated or disposed item is archived, not deleted, until the
          retention job removes it.
        </Banner>
      </div>

      {queue.length ? (
        <div className="stack">
          {queue.map((item) => (
            <div key={item.ref} className="panel">
              <div className="panel-head row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <strong>{item.title}</strong>
                  <div className="item-ref">
                    {item.ref} · {item.category} · {item.zone ?? 'no zone'}
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <StatusChip status={item.status} />
                  <span className={`chip ${item.daysLeft < 0 ? 'chip-danger' : 'chip-warn'}`}>
                    {item.daysLeft < 0 ? `${Math.abs(item.daysLeft)}d overdue` : `${item.daysLeft}d left`}
                  </span>
                </div>
              </div>
              <div className="panel-body">
                <p className="small muted" style={{ marginBottom: 12 }}>
                  Found {formatDate(item.eventDate)} · window closes {formatDate(item.expiresAt)}
                </p>
                <DisposalForm itemRef={item.ref} suggested={item.suggested} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card text-center" style={{ padding: 32 }}>
          <h3>Nothing to dispose of</h3>
          <p className="muted small">The queue fills when a listing is within a week of its retention window closing.</p>
        </div>
      )}
    </div>
  );
}
