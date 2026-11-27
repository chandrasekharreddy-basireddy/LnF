import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, isStaff, matchQueue } from '@/lib/data';
import { Banner } from '@/components/banner';
import { explainMatch } from '@/lib/phash';
import { formatDateTime } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Possible matches', robots: { index: false, follow: false } };

export default async function MatchesPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/staff/matches');
  if (!isStaff(user)) redirect('/');

  const pairs = await matchQueue(50);

  return (
    <div className="section" style={{ marginTop: 8 }}>
      <Link className="small" href="/staff">
        ← Desk
      </Link>
      <div className="section-head" style={{ marginTop: 8 }}>
        <div>
          <p className="eyebrow">Matching</p>
          <h1 style={{ marginBottom: 4 }}>Possible matches</h1>
          <p className="muted small">
            Lost reports paired with found items, strongest first. Each pair shows the numbers it was scored from:
            title, category, zone, how far apart the dates are, and how far apart the photos are. A pair is a lead to
            check, never a decision — the claim and the verification answer still decide who collects.
          </p>
        </div>
        {pairs ? <span className="chip chip-quiet">{pairs.length} to look at</span> : null}
      </div>

      <div style={{ margin: '18px 0' }}>
        <Banner tone="info" title="A photo match is a hint, not proof">
          Two photos can look alike and be two different objects. The desk still asks the finder&apos;s question and
          still wants the code at handover.
        </Banner>
      </div>

      {pairs === null ? (
        <div className="card text-center" style={{ padding: 32 }}>
          <h3>We could not load the queue</h3>
          <p className="muted small">
            The database refused the request, or the queue is not readable right now. Reload in a moment; nothing was
            changed.
          </p>
          <Link className="btn" href="/staff/matches">
            Try again
          </Link>
        </div>
      ) : pairs.length ? (
        <div className="stack">
          {pairs.map((pair) => {
            const sameCategory = pair.lostCategory === pair.foundCategory;
            return (
              <div key={`${pair.lostRef}-${pair.foundRef}`} className="panel">
                <div className="panel-head row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <strong>{pair.lostTitle}</strong>
                    <div className="item-ref">
                      lost · <span className="mono">{pair.lostRef}</span> · {pair.lostCategory}
                    </div>
                  </div>
                  <span className={`chip ${pair.score >= 0.6 ? 'chip-ok' : 'chip-quiet'}`}>{pair.score.toFixed(2)}</span>
                </div>
                <div className="panel-body">
                  <p className="small" style={{ marginBottom: 6 }}>
                    ↔ <strong>{pair.foundTitle}</strong>{' '}
                    <span className="mono small">{pair.foundRef}</span>
                    {pair.zone ? <span className="muted small"> · {pair.zone}</span> : null}
                  </p>
                  <p className="small muted" style={{ marginBottom: 12 }}>
                    {explainMatch({
                      title: Number(pair.titleScore ?? 0),
                      sameCategory,
                      sameZone: Boolean(pair.zone),
                      distance: pair.photoDistance,
                    })}
                    {' · '}
                    {pair.dayGap === 0 ? 'both events on the same day' : `${pair.dayGap} days apart`}
                    {' · '}
                    found {formatDateTime(pair.createdAt)}
                  </p>
                  <div className="row" style={{ gap: 8 }}>
                    <Link className="btn btn-ghost btn-sm" href={`/staff/items/${pair.lostRef}`}>
                      Open the lost report
                    </Link>
                    <Link className="btn btn-ghost btn-sm" href={`/staff/items/${pair.foundRef}`}>
                      Open the found item
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card text-center" style={{ padding: 32 }}>
          <h3>No pairs waiting</h3>
          <p className="muted small">
            A pair appears when a found item and a lost report share a category, a similar title or a similar photo
            within 45 days of each other.
          </p>
        </div>
      )}
    </div>
  );
}
