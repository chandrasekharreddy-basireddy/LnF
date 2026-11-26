import type { Metadata } from 'next';
import Link from 'next/link';
import { currentUser, zones } from '@/lib/data';
import { CATEGORIES } from '@/lib/copy';
import { env } from '@/lib/env';
import { ReportForm } from '@/components/report-form';
import { Banner } from '@/components/banner';
import { SafetyNote } from '@/components/safety-note';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Hand in something you found',
  description: 'Log a found item in under a minute, with one question only the owner can answer.',
};

export default async function ReportFoundPage() {
  const [user, zoneList] = await Promise.all([currentUser(), zones()]);

  return (
    <div className="section" style={{ marginTop: 8, maxWidth: 760 }}>
      <p className="eyebrow">Report a found item</p>
      <h1>You found something. Thank you.</h1>
      <p className="lede">
        Log it here, then hand it in at {env.deskLabel}. It takes about a minute. The one thing we ask for is a
        question only the real owner could answer — that is what stops the wrong person walking away with it.
      </p>

      <div style={{ margin: '24px 0' }}>
        <Banner tone="info" title="Before you upload a photo">
          Location data and camera details are removed from your photo on upload. Do not photograph ID cards, bank
          cards or anything with a number you would not publish — those go straight to the desk.
        </Banner>
      </div>

      {user ? (
        <div className="card">
          <ReportForm
            kind="found"
            categories={CATEGORIES}
            zones={zoneList}
            deskLabel={env.deskLabel}
            defaultEmail={user.email}
          />
        </div>
      ) : (
        <div className="card stack">
          <h2 style={{ fontSize: '1.2rem' }}>Sign in first</h2>
          <p className="small">
            A verified email is how we tell you when the owner collects the item, and how the desk reaches you if a
            claim looks wrong. It takes one code, no password.
          </p>
          <div className="row">
            <Link className="btn" href="/sign-in?next=/report/found">
              Sign in with email
            </Link>
            <Link className="btn btn-secondary" href="/browse">
              Back to the board
            </Link>
          </div>
        </div>
      )}

      <div style={{ marginTop: 28 }}>
        <SafetyNote />
      </div>
    </div>
  );
}
