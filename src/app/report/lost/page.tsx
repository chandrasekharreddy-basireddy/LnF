import type { Metadata } from 'next';
import Link from 'next/link';
import { currentUser, zones } from '@/lib/data';
import { CATEGORIES } from '@/lib/copy';
import { env } from '@/lib/env';
import { ReportForm } from '@/components/report-form';
import { Banner } from '@/components/banner';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Report something you lost',
  description: 'Post what you lost so finders can match it, and get an email when something similar is handed in.',
};

export default async function ReportLostPage() {
  const [user, zoneList] = await Promise.all([currentUser(), zones()]);

  return (
    <div className="section" style={{ marginTop: 8, maxWidth: 760 }}>
      <p className="eyebrow">Report a lost item</p>
      <h1>Tell us what you lost.</h1>
      <p className="lede">
        Most recoveries start here: a finder searches for what they picked up and finds your report. Your contact
        details stay private — they are never shown on the listing.
      </p>

      <div style={{ margin: '24px 0' }}>
        <Banner tone="info" title="What not to write">
          Descriptions are public. Keep out your ID number, address, phone number and full serial numbers. The desk
          verifies those in person.
        </Banner>
      </div>

      {user ? (
        <div className="card">
          <ReportForm
            kind="lost"
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
            We email you the moment a similar item is handed in, so we need a verified address. One code, no password.
          </p>
          <div className="row">
            <Link className="btn" href="/sign-in?next=/report/lost">
              Sign in with email
            </Link>
            <Link className="btn btn-secondary" href="/browse">
              Search the board first
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
