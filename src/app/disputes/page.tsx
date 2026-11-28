import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, myDisputableClaims, myDisputes } from '@/lib/data';
import { DisputeForm } from '@/components/dispute-form';
import { StatusChip } from '@/components/status-chip';
import { EmptyState } from '@/components/empty-state';
import { Banner } from '@/components/banner';
import { formatDate } from '@/lib/validation';
import { DISPUTE_STATUS_TEXT, DISPUTE_WINDOW_DAYS } from '@/lib/trust';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Disputes', robots: { index: false, follow: false } };

export default async function DisputesPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/disputes');

  const [open, contested] = await Promise.all([myDisputableClaims(), myDisputes()]);
  const nothing = open.length === 0 && contested.length === 0;

  return (
    <div className="section" style={{ marginTop: 8, maxWidth: 860 }}>
      <p className="eyebrow">Your account</p>
      <h1 style={{ marginBottom: 6 }}>Disputes</h1>
      <p className="lede" style={{ maxWidth: '68ch' }}>
        A claim decision is made by one staff member from an answer and whatever proof was on the claim. If that was
        wrong, this is where you ask for a second look. A dispute is a request, not an accusation — it is read by the
        desk, kept on the record, and answered with a reason.
      </p>

      <Banner tone="info" title={`You have ${DISPUTE_WINDOW_DAYS} days from the decision`}>
        After that the claim is closed for good and only the desk can reopen it. Disputes go to the desk in the order
        they arrive; most are answered within a week.
      </Banner>

      {nothing ? (
        <div style={{ marginTop: 20 }}>
          <EmptyState
            title="Nothing to dispute"
            body="When a claim of yours is decided — approved or not — it appears here for two weeks, with a box to ask for a second look."
            action={{ href: '/claims', label: 'See your claims' }}
          />
        </div>
      ) : null}

      {open.length ? (
        <section style={{ marginTop: 24 }}>
          <div className="section-head">
            <div>
              <h2 style={{ marginBottom: 4 }}>Decisions you can contest</h2>
              <p className="muted small">
                Contested as {open[0].role === 'finder' ? 'the person who handed the item in' : 'the claimant'}. One
                dispute per claim.
              </p>
            </div>
          </div>
          <div className="stack" style={{ marginTop: 12 }}>
            {open.map((claim) => (
              <div className="panel" key={claim.claimRef}>
                <div className="panel-head row" style={{ justifyContent: 'space-between', gap: 10 }}>
                  <div>
                    <strong>{claim.itemTitle}</strong>
                    <div className="item-ref">
                      <span className="mono">{claim.claimRef}</span> · item <span className="mono">{claim.itemRef}</span>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <StatusChip status={claim.claimStatus} />
                    <span className={`chip ${claim.daysLeft <= 3 ? 'chip-danger' : 'chip-quiet'}`}>
                      {claim.daysLeft === 0 ? 'last day' : `${claim.daysLeft} day${claim.daysLeft === 1 ? '' : 's'} left`}
                    </span>
                  </div>
                </div>
                <div className="panel-body">
                  <DisputeForm claimRef={claim.claimRef} daysLeft={claim.daysLeft} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {contested.length ? (
        <section style={{ marginTop: 28 }}>
          <h2 style={{ marginBottom: 10 }}>Your disputes</h2>
          <div className="panel">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Dispute</th>
                    <th scope="col">Item</th>
                    <th scope="col">Status</th>
                    <th scope="col">Raised</th>
                    <th scope="col">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {contested.map((d) => (
                    <tr key={d.ref}>
                      <td className="mono">{d.ref}</td>
                      <td>
                        <div>{d.itemTitle}</div>
                        <div className="item-ref">{d.claimRef}</div>
                      </td>
                      <td>
                        <span className={`chip ${d.status === 'upheld' ? 'chip-ok' : d.status === 'open' ? 'chip-warn' : 'chip-quiet'}`}>
                          {DISPUTE_STATUS_TEXT[d.status] ?? d.status}
                        </span>
                      </td>
                      <td>{formatDate(d.createdAt)}</td>
                      <td>
                        <Link className="small" href={`/disputes/${d.ref}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      <p className="small muted" style={{ marginTop: 24 }}>
        Wrong item on the board, or something that looks like a scam? <Link href="/safety">Report it from the listing</Link>{' '}
        instead — that goes to a different queue.
      </p>
    </div>
  );
}
