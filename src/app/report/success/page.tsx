import type { Metadata } from 'next';
import Link from 'next/link';
import { env } from '@/lib/env';
import { refLooksValid } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Report received', robots: { index: false, follow: false } };

export default async function ReportSuccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = typeof sp.ref === 'string' ? sp.ref : '';
  const ref = refLooksValid(raw) ? raw : '';
  const state = typeof sp.state === 'string' ? sp.state : 'pending_moderation';
  const inReview = state === 'pending_moderation';
  const heldAtDesk = state === 'quarantined';

  return (
    <div className="section" style={{ marginTop: 8, maxWidth: 620 }}>
      <p className="eyebrow">{inReview ? 'Received' : 'Logged'}</p>
      <h1>{inReview ? 'Your report is with the desk' : 'Your report is in'}</h1>

      <p className="lede">
        Reference <strong className="mono">{ref || 'pending'}</strong>.{' '}
        {heldAtDesk
          ? 'An identity document or card cannot be published, by design. It is held at the desk and can only be collected in person with proof of identity.'
          : inReview
            ? 'A staff member checks a new reporter’s first listings before they appear on the board — usually within a few hours. You will get an email the moment it is live.'
            : 'It is on the board now. You will be emailed when something similar is handed in.'}
      </p>

      <div className="card" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: '1.05rem' }}>What happens next</h2>
        <ol className="small" style={{ paddingLeft: 18, margin: 0 }}>
          <li style={{ marginBottom: 6 }}>
            {inReview ? 'A staff member publishes it, or asks you one question.' : 'Finders can see it on the board.'}
          </li>
          <li style={{ marginBottom: 6 }}>If something similar is handed in, you get an email with the listing.</li>
          <li>
            You claim it, answer the verification question, and collect it at {env.deskLabel}. Nothing to pay, ever.
          </li>
        </ol>
      </div>

      <div className="row" style={{ marginTop: 20 }}>
        <Link className="btn" href="/account">
          Your listings
        </Link>
        <Link className="btn btn-secondary" href="/browse">
          Browse the board
        </Link>
      </div>
    </div>
  );
}
