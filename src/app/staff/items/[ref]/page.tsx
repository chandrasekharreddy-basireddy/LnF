import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { currentUser, isStaff, retentionPolicies, staffDirectory, staffItem } from '@/lib/data';
import { ClaimDecision, HandoverForm, ItemStatusForm } from '@/components/staff-actions';
import { MessageForm } from '@/components/message-form';
import { StatusChip } from '@/components/status-chip';
import { formatDateTime } from '@/lib/validation';
import { categoryLabel } from '@/lib/copy';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Desk · item', robots: { index: false, follow: false } };

export default async function StaffItemPage({ params }: { params: Promise<{ ref: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/staff');
  if (!isStaff(user)) redirect('/');

  const { ref } = await params;
  const detail = await staffItem(ref);
  if (!detail) notFound();

  const { item, private: priv, claims, history, contactEmail } = detail;

  const [policies, directory] = await Promise.all([retentionPolicies(), staffDirectory()]);
  const requiresWitness = Boolean(
    policies.find((policy) => policy.category === item.category)?.requires_photo_id,
  );

  return (
    <div className="section" style={{ marginTop: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <Link className="small" href="/staff">
          ← Desk
        </Link>
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn btn-ghost btn-sm" href={`/staff/items/${item.ref}/label`}>
            Print label
          </Link>
          <span className="mono small" style={{ background: 'var(--brand-soft)', padding: '4px 10px', borderRadius: 6 }}>
            {item.ref}
          </span>
        </div>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <StatusChip status={item.status} />
        <span className={`chip ${item.type === 'lost' ? 'chip-lost' : 'chip-found'}`}>
          {item.type === 'lost' ? 'Lost report' : 'Found item'}
        </span>
        {item.sensitiveHiddenPhoto ? <span className="chip chip-warn">Sensitive photo hidden</span> : null}
      </div>

      <h1>{item.title}</h1>
      <p className="muted small">
        {categoryLabel(item.category)} · {item.zoneLabel ?? 'no zone'} {item.spot ? `· ${item.spot}` : ''}
      </p>

      <div className="split" style={{ marginTop: 20 }}>
        <div className="stack-lg">
          <section className="panel">
            <div className="panel-head">
              <strong>Claims ({claims.length})</strong>
            </div>
            <div className="panel-body stack">
              {claims.length ? (
                claims.map((c) => (
                  <div key={c.ref} className="card card-tight">
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <strong className="small mono">{c.ref}</strong>
                      <StatusChip status={c.status} />
                    </div>
                    <p className="small" style={{ marginTop: 6 }}>
                      {c.claimant} · {c.claimantEmail ?? 'no email'}
                    </p>
                    <p className="small">
                      Answer check:{' '}
                      <span className={`chip ${c.answerMatched ? 'chip-ok' : 'chip-warn'}`}>
                        {c.answerMatched ? 'matches the finder\u2019s answer' : 'does not match'}
                      </span>
                    </p>
                    {c.proof ? <p className="small muted">Proof: {c.proof}</p> : null}
                    <div style={{ marginTop: 12 }}>
                      <ClaimDecision claimRef={c.ref} itemRef={item.ref} status={c.status} />
                    </div>
                    {['submitted', 'under_review', 'approved'].includes(c.status) ? (
                      <details style={{ marginTop: 12 }}>
                        <summary className="small" style={{ cursor: 'pointer' }}>
                          Reply to this thread
                        </summary>
                        <div style={{ marginTop: 10 }}>
                          <MessageForm claimRef={c.ref} backTo={`/staff/items/${item.ref}`} />
                        </div>
                      </details>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="small muted">No claims yet.</p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <strong>Confirm a handover</strong>
            </div>
            <div className="panel-body">
              {item.status === 'recovered' ? (
                <p className="small muted">This item is already recorded as returned.</p>
              ) : claims.some((c) => c.status === 'approved') ? (
                <HandoverForm itemRef={item.ref} requiresWitness={requiresWitness} staff={directory} />
              ) : (
                <p className="small muted">
                  Approve a claim first. An item is only released against an approved claim.
                </p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <strong>Listing controls</strong>
            </div>
            <div className="panel-body">
              <ItemStatusForm itemRef={item.ref} status={item.status} />
            </div>
          </section>
        </div>

        <aside className="stack">
          <div className="panel">
            <div className="panel-head">
              <strong>Private detail</strong>
            </div>
            <div className="panel-body">
              <dl className="kv">
                <div>
                  <dt>Answer on file</dt>
                  <dd style={{ margin: 0 }}>{priv.hasAnswer ? 'Yes (hashed)' : 'None'}</dd>
                </div>
                <div>
                  <dt>Serial</dt>
                  <dd style={{ margin: 0 }}>{priv.serial ?? '—'}</dd>
                </div>
                <div>
                  <dt>Bin</dt>
                  <dd style={{ margin: 0 }}>{priv.bin ?? '—'}</dd>
                </div>
                <div>
                  <dt>Finder contact</dt>
                  <dd style={{ margin: 0 }}>{priv.finderContact ?? '—'}</dd>
                </div>
                <div>
                  <dt>Reported by</dt>
                  <dd style={{ margin: 0 }}>{contactEmail ?? 'staff intake'}</dd>
                </div>
              </dl>
              <p className="small muted" style={{ marginTop: 12 }}>
                {item.description}
              </p>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <strong>History</strong>
            </div>
            <div className="panel-body">
              {history.length ? (
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                  {history.map((h, idx) => (
                    <li key={idx} style={{ marginBottom: 6 }}>
                      {h.action.replace(/_/g, ' ')} · {formatDateTime(h.at)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="small muted">No entries yet.</p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
