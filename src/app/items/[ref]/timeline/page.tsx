import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { custodyTimeline, currentUser, isStaff } from '@/lib/data';
import { buildCustodyTimeline, custodyOutlook, personShapedPaths } from '@/lib/custody';
import { StatusChip } from '@/components/status-chip';
import { formatDate, formatDateTime } from '@/lib/validation';
import { categoryLabel } from '@/lib/copy';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Custody timeline',
  robots: { index: false, follow: false },
};

/**
 * What happened to one item, for the person who reported it.
 *
 * The page holds no authorization of its own: `item_custody_timeline` answers
 * NOT_FOUND to anyone who is not the reporter or staff, and the session guard
 * below only decides where a signed-out visitor goes. Everything drawn here is
 * about the item — never about a claimant.
 */
export default async function CustodyTimelinePage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const user = await currentUser();
  if (!user) redirect(`/sign-in?next=/items/${encodeURIComponent(ref)}/timeline`);

  const payload = await custodyTimeline(ref);
  if (!payload) notFound();

  // Second lock. If the payload ever grows a field about a person, this page
  // stops rather than drawing it.
  if (personShapedPaths(payload).length) notFound();

  const timeline = buildCustodyTimeline(payload, new Date());
  if (!timeline) notFound();

  const { item, steps, summary } = timeline;
  const staff = isStaff(user);

  return (
    <div className="section" style={{ marginTop: 8, maxWidth: 780 }}>
      <p className="eyebrow">Your listing</p>
      <div className="row" style={{ gap: 10, marginBottom: 6 }}>
        <span className="item-ref">{item.ref}</span>
        <StatusChip status={item.status} />
        <span className={`chip ${item.type === 'lost' ? 'chip-lost' : 'chip-found'}`}>
          {item.type === 'lost' ? 'Lost report' : 'Found item'}
        </span>
      </div>
      <h1 style={{ marginBottom: 6 }}>{item.title}</h1>
      <p className="muted small" style={{ marginBottom: 20 }}>
        {categoryLabel(item.category)}
        {item.custodyLabel ? ` · ${item.custodyLabel}` : ''} · <Link href={`/items/${item.ref}`}>view listing</Link>
        {staff ? ' · you are reading this as staff' : ''}
      </p>

      <div className="stat-strip" style={{ marginTop: 0, marginBottom: 24 }}>
        <div className="stat">
          <b>{summary.daysInCustody}</b>
          <span>{summary.daysInCustody === 1 ? 'Day in the chain' : 'Days in the chain'}</span>
        </div>
        <div className="stat">
          <b>{summary.claims}</b>
          <span>{summary.claims === 1 ? 'Claim received' : 'Claims received'}</span>
        </div>
        <div className="stat">
          <b>{summary.approved}</b>
          <span>{summary.approved === 1 ? 'Claim approved' : 'Claims approved'}</span>
        </div>
        <div className="stat">
          <b>{summary.handovers}</b>
          <span>{summary.handovers === 1 ? 'Handover' : 'Handovers'}</span>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head">
          <strong>What happened, in order</strong>
        </div>
        <div className="panel-body">
          {steps.length ? (
            <ol className="timeline">
              {steps.map((step, index) => (
                <li
                  key={`${step.key}-${step.at}-${index}`}
                  className={step.tone === 'done' ? 'done' : index === steps.length - 1 ? 'current' : ''}
                >
                  <span className="node" aria-hidden="true">
                    {step.tone === 'done' ? '✓' : step.tone === 'warn' ? '!' : ''}
                  </span>
                  <div className="t-body">
                    <strong>{step.label}</strong>
                    <span>
                      <time dateTime={step.at}>{formatDateTime(step.at)}</time> — {step.detail}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="small muted">No steps recorded yet. The desk has your report.</p>
          )}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head">
          <strong>What this shows</strong>
        </div>
        <div className="panel-body stack">
          <p className="small">{custodyOutlook(timeline)}</p>
          {timeline.daysLeft !== null && timeline.daysLeft > 0 && item.expiresAt ? (
            <p className="small muted">
              Retention window closes on {formatDate(item.expiresAt)} — {timeline.daysLeft}{' '}
              {timeline.daysLeft === 1 ? 'day' : 'days'} from today.
            </p>
          ) : null}
          <p className="small muted">
            This timeline shows what happened to the item. It never shows who claimed it, what they answered, or the
            collection code — those belong to the claim, not to the listing. If a decision looks wrong, the person who
            claimed it can ask for a second look from their claim page.
          </p>
        </div>
      </div>

      <div className="row">
        <Link className="btn btn-secondary" href="/account">
          Back to your account
        </Link>
        <Link className="btn btn-secondary" href={`/items/${item.ref}`}>
          Open the listing
        </Link>
      </div>
    </div>
  );
}
