import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { currentUser, myClaim } from '@/lib/data';
import { Timeline } from '@/components/timeline';
import { StatusChip } from '@/components/status-chip';
import { CopyCode } from '@/components/copy-code';
import { Banner } from '@/components/banner';
import { SafetyNote } from '@/components/safety-note';
import { formatDate, formatDateTime } from '@/lib/validation';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Claim status', robots: { index: false, follow: false } };

export default async function ClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ref } = await params;
  const sp = await searchParams;
  const user = await currentUser();
  if (!user) redirect(`/sign-in?next=/claims/${ref}`);

  const detail = await myClaim(ref);
  if (!detail) notFound();

  const { claim, item, timeline, handover } = detail;
  const isNew = sp.new === '1';

  return (
    <div className="section" style={{ marginTop: 8, maxWidth: 780 }}>
      {isNew ? (
        <Banner tone="ok" title="Claim submitted">
          We emailed you a copy. The desk reviews claims within two working days — you will get another email when
          there is a decision.
        </Banner>
      ) : null}

      <div className="row" style={{ marginTop: isNew ? 20 : 0, gap: 10 }}>
        <span className="item-ref">{claim.ref}</span>
        <StatusChip status={claim.status} />
      </div>
      <h1 style={{ marginTop: 8 }}>{item.title}</h1>
      <p className="muted small">
        Item {item.ref} · {item.zoneLabel ?? 'Zone not recorded'} ·{' '}
        <Link href={`/items/${item.ref}`}>view listing</Link>
      </p>

      {claim.status === 'approved' && handover.code ? (
        <div className="code-box" style={{ margin: '24px 0' }}>
          <p className="eyebrow" style={{ marginBottom: 0 }}>
            Handover code
          </p>
          <p className="code">{handover.code}</p>
          <p className="small" style={{ margin: 0 }}>
            Show this at {env.deskLabel}. Do not share it — this is the only time it is displayed.
          </p>
          <CopyCode code={handover.code} />
        </div>
      ) : claim.status === 'approved' ? (
        <div className="banner banner-info" style={{ margin: '24px 0' }}>
          <div>
            <strong>{handover.used ? 'Handover complete' : 'Code already shown'}</strong>
            <div>
              {handover.used
                ? 'This item was handed over at the desk.'
                : 'Your code was displayed once and cannot be shown again. Ask the desk to reissue it if you lost it — bring photo ID.'}
            </div>
          </div>
        </div>
      ) : null}

      <div className="split" style={{ marginTop: 28 }}>
        <div className="panel">
          <div className="panel-head">
            <strong>Progress</strong>
          </div>
          <div className="panel-body">
            <Timeline events={timeline} />
            {claim.reason ? (
              <p className="small muted" style={{ marginTop: 12 }}>
                Desk note: {claim.reason}
              </p>
            ) : null}
          </div>
        </div>

        <aside className="stack">
          <div className="panel">
            <div className="panel-head">
              <strong>What happens next</strong>
            </div>
            <div className="panel-body small stack">
              <p>
                {claim.status === 'submitted'
                  ? 'The desk compares your answer with the finder\u2019s record. Most claims are reviewed within two working days.'
                  : claim.status === 'under_review'
                    ? 'A staff member is looking at this claim now.'
                    : claim.status === 'approved'
                      ? `Collect the item from ${item.custodyLabel ?? env.deskLabel}. Bring photo ID.`
                      : claim.status === 'rejected'
                        ? 'If you have more proof, reply from the desk link in your email. A rejection is not final if the item is still held.'
                        : 'This claim is closed.'}
              </p>
              <p className="muted">
                Submitted {formatDateTime(claim.createdAt)}
                {claim.decidedAt ? ` · decided ${formatDate(claim.decidedAt)}` : ''}
              </p>
            </div>
          </div>

          <SafetyNote compact />
        </aside>
      </div>
    </div>
  );
}
