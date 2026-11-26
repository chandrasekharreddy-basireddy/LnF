import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentUser, getItem, isItemSaved } from '@/lib/data';
import { categoryLabel } from '@/lib/copy';
import { formatDate, formatDateTime } from '@/lib/validation';
import { env } from '@/lib/env';
import { PhotoGallery } from '@/components/photo-gallery';
import { SafetyNote } from '@/components/safety-note';
import { StatusChip } from '@/components/status-chip';
import { ClaimForm } from '@/components/claim-form';
import { ListingReport } from '@/components/listing-report';
import { Banner } from '@/components/banner';
import { CategoryIcon } from '@/components/category-icon';
import { SaveItemButton } from '@/components/save-controls';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ ref: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ref } = await params;
  const data = await getItem(ref);
  if (!data) return { title: 'Listing not found' };
  return {
    title: data.item.title,
    description: data.item.description.slice(0, 155),
    robots: { index: data.item.status === 'available', follow: true },
  };
}

export default async function ItemPage({ params, searchParams }: Props) {
  const { ref } = await params;
  const sp = await searchParams;
  const data = await getItem(ref);
  if (!data) notFound();

  const { item, photos } = data;
  const user = await currentUser();
  const saved = user ? await isItemSaved(item.ref) : false;
  const posted = sp.posted === '1';

  if (item.status === 'quarantined') {
    return (
      <div className="section" style={{ maxWidth: '60ch' }}>
        <p className="eyebrow">Held at the desk</p>
        <h1>This item is with staff</h1>
        <p className="lede">
          Reference {item.ref}. Identity documents and bank cards are never published. Bring proof of identity to{' '}
          {env.deskLabel} and ask for this reference.
        </p>
        <div className="row">
          <Link className="btn" href="/browse">
            Back to the board
          </Link>
          <Link className="btn btn-secondary" href="/report/lost">
            Post a lost report
          </Link>
        </div>
      </div>
    );
  }

  const claimable = item.type === 'found' && item.status === 'available';
  const closed = item.status === 'claimed' || item.status === 'recovered';

  return (
    <div className="section" style={{ marginTop: 8 }}>
      {posted ? (
        <Banner tone="ok" title="Posted">
          Reference {item.ref}. We emailed you a copy. The desk verifies any claim before release.
        </Banner>
      ) : null}

      <div className="split" style={{ marginTop: posted ? 20 : 0 }}>
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 10 }}>
            <StatusChip status={item.status} />
            <span className={`chip ${item.type === 'lost' ? 'chip-lost' : 'chip-found'}`}>
              {item.type === 'lost' ? 'Lost report' : 'Found item'}
            </span>
            <span className="item-ref">{item.ref}</span>
            {item.isSample ? <span className="chip chip-quiet">Sample listing</span> : null}
          </div>

          <h1 style={{ marginBottom: 10 }}>{item.title}</h1>
          <p className="lede" style={{ marginBottom: 20 }}>
            {item.description}
          </p>

          {item.sensitiveHiddenPhoto ? (
            <div className="banner banner-warn" style={{ marginBottom: 20 }}>
              <div>
                <strong>No photo shown</strong>
                <div>The finder flagged this photo as sensitive, so the listing is description only.</div>
              </div>
            </div>
          ) : photos.length ? (
            <div style={{ marginBottom: 24 }}>
              <PhotoGallery photos={photos} />
            </div>
          ) : (
            <div
              className="card"
              style={{ display: 'grid', placeItems: 'center', padding: 32, marginBottom: 24 }}
              aria-hidden="true"
            >
              <CategoryIcon category={item.category} size={44} />
            </div>
          )}

          <dl className="kv" style={{ marginBottom: 24 }}>
            <div>
              <dt>Category</dt>
              <dd style={{ margin: 0 }}>{categoryLabel(item.category)}</dd>
            </div>
            <div>
              <dt>{item.type === 'lost' ? 'Lost on' : 'Found on'}</dt>
              <dd style={{ margin: 0 }}>{formatDate(item.eventDate)}</dd>
            </div>
            <div>
              <dt>Zone</dt>
              <dd style={{ margin: 0 }}>
                {item.zoneLabel ?? 'Not recorded'}
                {item.spot ? ` — ${item.spot}` : ''}
              </dd>
            </div>
            <div>
              <dt>Where it is now</dt>
              <dd style={{ margin: 0 }}>{item.custodyLabel ?? env.deskLabel}</dd>
            </div>
            <div>
              <dt>Listed</dt>
              <dd style={{ margin: 0 }}>{formatDateTime(item.createdAt)}</dd>
            </div>
          </dl>

          <ListingReport itemRef={item.ref} />
        </div>

        <aside className="stack">
          {item.type === 'found' && item.verificationQuestion ? (
            <div className="panel">
              <div className="panel-head">
                <strong>To claim this, tell us</strong>
              </div>
              <div className="panel-body">
                <p style={{ fontWeight: 600, marginBottom: 6 }}>&ldquo;{item.verificationQuestion}&rdquo;</p>
                <p className="hint">
                  Public question, private answer. The finder recorded the answer; the desk checks it against yours.
                </p>
              </div>
            </div>
          ) : null}

          {item.type === 'found' ? (
            <div className="panel">
              <div className="panel-head">
                <strong>{claimable ? 'This is mine' : 'Claim status'}</strong>
              </div>
              <div className="panel-body">
                {claimable ? (
                  user ? (
                    <ClaimForm itemRef={item.ref} question={item.verificationQuestion} />
                  ) : (
                    <div className="stack">
                      <p className="small">
                        Sign in with your email so the desk can verify you and send updates. No password needed.
                      </p>
                      <Link className="btn btn-block" href={`/sign-in?next=/items/${item.ref}`}>
                        Sign in to claim
                      </Link>
                    </div>
                  )
                ) : (
                  <div className="stack">
                    <p className="small">
                      {closed
                        ? 'A claim has already been approved for this item, so it is no longer open to new claims. If you believe it is yours, report a problem below and the desk will look into it.'
                        : 'This item is not open for claims right now.'}
                    </p>
                    <Link className="btn btn-secondary btn-block" href="/browse">
                      Browse similar items
                    </Link>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="panel">
              <div className="panel-head">
                <strong>Lost report</strong>
              </div>
              <div className="panel-body stack">
                <p className="small">
                  Someone is looking for this. If you found it, hand it in at {env.deskLabel} and log it — the finder
                  search matches it automatically.
                </p>
                <Link className="btn btn-block" href="/report/found">
                  I found this
                </Link>
              </div>
            </div>
          )}

          {user ? (
            <div className="panel">
              <div className="panel-body">
                <SaveItemButton itemRef={item.ref} saved={saved} />
              </div>
            </div>
          ) : null}

          <SafetyNote />
        </aside>
      </div>
    </div>
  );
}
