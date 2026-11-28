import type { Metadata } from 'next';
import Link from 'next/link';
import { env } from '@/lib/env';
import { SafetyNote } from '@/components/safety-note';
import { publicTrust } from '@/lib/data';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Safety', description: 'How to collect an item without getting scammed.' };

export default async function SafetyPage() {
  const trust = await publicTrust();
  return (
    <article className="section" style={{ marginTop: 8, maxWidth: 720 }}>
      <p className="eyebrow">Safety</p>
      <h1>Collecting something should be boring.</h1>
      <p className="lede">
        The whole design is aimed at one outcome: the item goes to its owner, at a staffed counter, with no money and no
        stranger meeting. Here is what that means in practice.
      </p>

      <div style={{ margin: '24px 0' }}>
        <SafetyNote />
      </div>

      <h2>Four things that are always true</h2>
      <ul>
        <li>
          <strong>Nothing costs money.</strong> No fee, no deposit, no courier charge, no gift card. If anyone asks,
          it is a scam — report the listing.
        </li>
        <li>
          <strong>Handovers happen at {env.deskLabel}.</strong> In daylight, with a staff member present, against an
          approved claim.
        </li>
        <li>
          <strong>Your handover code is yours.</strong> It is shown once on your claim page. Anyone who asks you to
          send it is trying to collect your item.
        </li>
        <li>
          <strong>We never ask for ID documents by email.</strong> Photo ID is checked in person at the counter, never
          uploaded, never photographed.
        </li>
      </ul>

      <h2>If something feels wrong</h2>
      <p>
        Use &ldquo;Report a problem with this listing&rdquo; on the item page. It reaches the desk immediately and is
        logged. For anything urgent, call the desk or write to {env.supportEmail}.
      </p>

      <h2>If you found an ID card or bank card</h2>
      <p>
        Do not photograph it and do not list it. Hand it straight to the desk. Those items are held without a public
        listing, and the desk contacts the issuing authority.
      </p>

      <h2>When you think the desk got it wrong</h2>
      <p>
        A claim is decided by a person, so it can be decided wrongly. For 14 days after a decision the claimant — or
        the finder, if the item has already gone out — can ask for a second look in the dispute room. Every dispute is
        answered with a reason on the record, and the outcome is counted here.
      </p>
      {trust ? (
        <div className="card card-tight" style={{ margin: '12px 0 24px' }}>
          <p className="small" style={{ margin: 0 }}>
            <strong>{trust.disputesOpened}</strong> dispute{trust.disputesOpened === 1 ? '' : 's'} raised ·{' '}
            <strong>{trust.disputesResolved}</strong> answered
            {trust.medianResolutionDays !== null ? `, typically within ${trust.medianResolutionDays} day${trust.medianResolutionDays === 1 ? '' : 's'}` : ''}
            {' · '}
            <strong>{trust.disputesUpheld}</strong> upheld, meaning the first decision was changed
            {trust.openDisputes > 0 ? ` · ${trust.openDisputes} still with the desk` : ''}.
          </p>
          <p className="small muted" style={{ margin: '6px 0 0' }}>
            These are counts about the desk, never about a person. Who disputed what stays between the people on that
            claim.
          </p>
        </div>
      ) : null}

      <p style={{ marginTop: 24 }}>
        <Link className="btn btn-secondary" href="/browse">
          Back to the board
        </Link>
      </p>
    </article>
  );
}
