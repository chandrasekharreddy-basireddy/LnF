import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { claimThread, currentUser, disputeRoom } from '@/lib/data';
import { Banner } from '@/components/banner';
import { ClaimThreadPanel } from '@/components/claim-thread';
import { DisputeWithdraw } from '@/components/dispute-withdraw';
import { DisputeDecide } from '@/components/dispute-decide';
import { StatusChip } from '@/components/status-chip';
import { formatDateTime } from '@/lib/validation';
import { DISPUTE_STATUS_TEXT, outcomeExplanation } from '@/lib/trust';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Dispute', robots: { index: false, follow: false } };

export default async function DisputePage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const user = await currentUser();
  if (!user) redirect(`/sign-in?next=/disputes/${ref}`);

  const room = await disputeRoom(ref);
  if (!room) notFound();

  const thread = await claimThread(room.claimRef);
  const isStaff = room.role === 'staff';

  return (
    <div className="section" style={{ marginTop: 8, maxWidth: 820 }}>
      <p className="eyebrow">
        <Link href={isStaff ? '/staff/disputes' : '/disputes'}>{isStaff ? 'Disputes queue' : 'Disputes'}</Link> ·{' '}
        <span className="mono">{room.ref}</span>
      </p>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start', gap: 12, marginBottom: 8 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{room.itemTitle}</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Claim <Link className="mono" href={`/claims/${room.claimRef}`}>{room.claimRef}</Link> · item{' '}
            <Link className="mono" href={`/items/${room.itemRef}`}>{room.itemRef}</Link>
            {room.itemCustody ? ` · ${room.itemCustody}` : ''}
          </p>
        </div>
        <span
          className={`chip ${
            room.status === 'upheld' ? 'chip-ok' : room.status === 'open' ? 'chip-warn' : 'chip-quiet'
          }`}
        >
          {DISPUTE_STATUS_TEXT[room.status] ?? room.status}
        </span>
      </div>

      <Banner
        tone={room.status === 'upheld' ? 'ok' : room.status === 'open' ? 'info' : 'warn'}
        title={
          room.status === 'open'
            ? 'With the desk'
            : room.status === 'upheld'
              ? 'Upheld'
              : room.status === 'dismissed'
                ? 'Decision stands'
                : 'Withdrawn'
        }
      >
        {outcomeExplanation(room.status, room.reopened)}
      </Banner>

      <div className="split" style={{ marginTop: 20 }}>
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <strong>{room.openerRole === 'finder' ? 'What the finder raised' : 'What you raised'}</strong>
            </div>
            <div className="panel-body">
              <p className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                {room.reason}
              </p>
              <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
                Opened {formatDateTime(room.createdAt)}
                {room.decidedAt ? ` · answered ${formatDateTime(room.decidedAt)}` : ''}
              </p>
            </div>
          </section>

          {room.outcomeNote ? (
            <section className="panel">
              <div className="panel-head">
                <strong>The desk&apos;s answer</strong>
              </div>
              <div className="panel-body">
                <p className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                  {room.outcomeNote}
                </p>
              </div>
            </section>
          ) : null}

          {isStaff && room.status === 'open' ? (
            <section className="panel">
              <div className="panel-head">
                <strong>Record the outcome</strong>
              </div>
              <div className="panel-body">
                <DisputeDecide disputeRef={room.ref} />
              </div>
            </section>
          ) : null}

          {room.canWithdraw ? (
            <section className="panel">
              <div className="panel-head">
                <strong>Changed your mind?</strong>
              </div>
              <div className="panel-body">
                <DisputeWithdraw disputeRef={room.ref} />
              </div>
            </section>
          ) : null}
        </div>

        <aside className="stack">
          <div className="panel">
            <div className="panel-head">
              <strong>What was decided</strong>
            </div>
            <div className="panel-body small stack">
              <p style={{ margin: 0 }}>
                Claim <StatusChip status={room.claimStatus} />
              </p>
              {room.claimDecisionReason ? <p className="muted">Desk note: {room.claimDecisionReason}</p> : null}
              <p className="muted" style={{ margin: 0 }}>
                {room.reopened
                  ? 'The claim is back in the queue. Nothing has been handed over.'
                  : 'The claim decision stands as recorded. This dispute is on the record either way.'}
              </p>
            </div>
          </div>

          <div className="banner banner-safety">
            <div>
              <strong>What a dispute cannot do</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                <li className="small">It cannot release an item that has already been handed over.</li>
                <li className="small">It does not contact the other person directly — the desk does.</li>
                <li className="small">It is not a channel for payment or personal contact details.</li>
              </ul>
            </div>
          </div>
        </aside>
      </div>

      <div style={{ marginTop: 24 }}>
        <ClaimThreadPanel thread={thread} claimRef={room.claimRef} backTo={`/disputes/${room.ref}`} />
      </div>
    </div>
  );
}
