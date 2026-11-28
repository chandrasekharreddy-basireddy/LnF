import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, isStaff, openReports, staffQueue } from '@/lib/data';
import { StatusChip } from '@/components/status-chip';
import { Banner } from '@/components/banner';
import { CloseReportForm } from '@/components/staff-actions';
import { formatDateTime } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Desk', robots: { index: false, follow: false } };

export default async function StaffPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/staff');
  if (!isStaff(user)) {
    if (user.roleCheckFailed) {
      return (
        <div className="section" style={{ maxWidth: 520 }}>
          <h1>We could not check your access</h1>
          <p className="lede">
            The role lookup failed, so this is not a refusal — your staff access may well be fine. Reload in a moment.
          </p>
          <Link className="btn" href="/staff">
            Try again
          </Link>
        </div>
      );
    }
    return (
      <div className="section" style={{ maxWidth: 520 }}>
        <h1>Desk access only</h1>
        <p className="lede">This area is for staff accounts. Ask an admin to grant your email the staff role.</p>
        <Link className="btn" href="/">
          Back to the board
        </Link>
      </div>
    );
  }

  const [queue, reports] = await Promise.all([staffQueue(), openReports()]);

  return (
    <div className="section" style={{ marginTop: 8 }}>
      <div className="section-head">
        <div>
          <p className="eyebrow">Staff desk</p>
          <h1 style={{ marginBottom: 4 }}>Today at the counter</h1>
          <p className="muted small">Every action here writes an audit entry.</p>
        </div>
        <div className="row">
          <Link className="btn btn-secondary btn-sm" href="/staff/scan">
            Scan a tag
          </Link>
          <Link className="btn btn-secondary btn-sm" href="/staff/matches">
            Possible matches
          </Link>
          <Link className="btn btn-secondary btn-sm" href="/staff/disputes">
            Disputes
          </Link>
          <Link className="btn btn-secondary btn-sm" href="/staff/analytics">
            Analytics
          </Link>
          <Link className="btn btn-secondary btn-sm" href="/staff/desk">
            Desk sheet
          </Link>
          <Link className="btn btn-secondary btn-sm" href="/staff/disposal">
            Disposal queue
          </Link>
          <Link className="btn btn-sm" href="/report/found">
            Log an item
          </Link>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 24 }}>
        <div className="stat">
          <b>{queue?.claims.length ?? 0}</b>
          <span>Claims to review</span>
        </div>
        <div className="stat">
          <b>{queue?.awaitingHandover.length ?? 0}</b>
          <span>Approved, awaiting collection</span>
        </div>
        <div className="stat">
          <b>{queue?.intake.length ?? 0}</b>
          <span>Held for review</span>
        </div>
      </div>

      <section className="panel" style={{ marginBottom: 24 }}>
        <div className="panel-head">
          <strong>Claims waiting on a decision</strong>
        </div>
        <div className="panel-body">
          {queue?.claims.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Claim</th>
                    <th scope="col">Item</th>
                    <th scope="col">Claimant</th>
                    <th scope="col">Answer</th>
                    <th scope="col">Submitted</th>
                    <th scope="col">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {queue.claims.map((c) => (
                    <tr key={c.ref}>
                      <td className="mono">{c.ref}</td>
                      <td>
                        <div>{c.itemTitle}</div>
                        <div className="item-ref">{c.itemRef}</div>
                      </td>
                      <td>
                        <div>{c.claimant}</div>
                        <div className="small muted">{c.claimantEmail}</div>
                      </td>
                      <td>
                        <span className={`chip ${c.answerMatched ? 'chip-ok' : 'chip-warn'}`}>
                          {c.answerMatched ? 'Matched' : 'Check manually'}
                        </span>
                      </td>
                      <td>{formatDateTime(c.createdAt)}</td>
                      <td>
                        <Link className="btn btn-secondary btn-sm" href={`/staff/items/${c.itemRef}`}>
                          Review
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="small muted">No claims waiting. Good.</p>
          )}
        </div>
      </section>

      <div className="split">
        <section className="panel">
          <div className="panel-head">
            <strong>Approved — waiting to be collected</strong>
          </div>
          <div className="panel-body">
            {queue?.awaitingHandover.length ? (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">Claim</th>
                      <th scope="col">Approved</th>
                      <th scope="col">Code</th>
                      <th scope="col">
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.awaitingHandover.map((h) => (
                      <tr key={h.claimRef}>
                        <td>
                          <div>{h.itemTitle}</div>
                          <div className="item-ref">{h.itemRef}</div>
                        </td>
                        <td className="mono">{h.claimRef}</td>
                        <td>{formatDateTime(h.approvedAt)}</td>
                        <td>{h.codeUsed ? 'Used' : 'Issued'}</td>
                        <td>
                          <Link className="btn btn-secondary btn-sm" href={`/staff/items/${h.itemRef}`}>
                            Hand over
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="small muted">Nothing waiting at the counter.</p>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <strong>Held for review</strong>
          </div>
          <div className="panel-body">
            {queue?.intake.length ? (
              <div className="stack">
                {queue.intake.map((i) => (
                  <div key={i.ref} className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <div className="small">{i.title}</div>
                      <div className="item-ref">
                        {i.ref} · {i.zone ?? 'no zone'}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <StatusChip status={i.status} />
                      <Link className="btn btn-secondary btn-sm" href={`/staff/items/${i.ref}`}>
                        Open
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="small muted">Nothing held.</p>
            )}
          </div>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 24 }}>
        <div className="panel-head">
          <strong>Reports from the board</strong>
        </div>
        <div className="panel-body">
          {reports.length ? (
            <div className="stack">
              {reports.map((r) => (
                <div key={r.id} className="card card-tight">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <strong className="small">
                      {r.reason.replace('_', ' ')} · {r.itemRef ?? 'account request'}
                    </strong>
                    <span className="small muted">{formatDateTime(r.at)}</span>
                  </div>
                  {r.details ? <p className="small" style={{ marginTop: 6 }}>{r.details}</p> : null}
                  {r.itemTitle ? <p className="small muted">{r.itemTitle}</p> : null}
                  <CloseReportForm reportId={r.id} />
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted">No open reports.</p>
          )}
        </div>
      </section>

      <div style={{ marginTop: 24 }}>
        <Banner tone="info" title="Before you release anything">
          Check the code, check photo ID, and record the handover. Never release an item without an approved claim.
        </Banner>
      </div>
    </div>
  );
}
