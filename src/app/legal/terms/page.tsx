import type { Metadata } from 'next';
import Link from 'next/link';
import { env } from '@/lib/env';

export const metadata: Metadata = { title: 'Terms of use', description: 'The rules for using L&F.' };

export default function TermsPage() {
  return (
    <article className="section" style={{ marginTop: 8, maxWidth: 720 }}>
      <p className="eyebrow">Legal</p>
      <h1>Terms of use</h1>
      <p className="lede">
        Short version: be honest, do not post other people&apos;s private information, and never pay for a returned
        item.
      </p>

      <h2>What this service is</h2>
      <p>
        L&amp;F is a listing and custody record for {env.campusName}. It helps an owner find a found item and prove it
        is theirs. It is not a marketplace, an escrow, a courier or a chat service. No money changes hands anywhere in
        the flow, and staff never ask for a deposit.
      </p>

      <h2>Your account</h2>
      <p>
        One account per person, tied to a verified email. You are responsible for what is posted from it. A false claim,
        or posting someone else&apos;s private information, can suspend the account.
      </p>

      <h2>What you may post</h2>
      <ul>
        <li>Items you actually found or actually lost.</li>
        <li>Descriptions with no ID numbers, addresses, phone numbers or full serial numbers.</li>
        <li>Photos of the item — not of people, documents or screens.</li>
      </ul>

      <h2>What we remove</h2>
      <p>
        Listings that ask for money, expose private data, are duplicates, or are not about a lost or found item. Reports
        are reviewed by staff; the decision is recorded in an audit log.
      </p>

      <h2>Handovers</h2>
      <p>
        Items are released at {env.deskLabel} against an approved claim and a one-time code. Staff may ask for photo ID.
        If you lose your code, ask the desk to reissue it — do not send it to anyone, ever.
      </p>

      <h2>Liability</h2>
      <p>
        We keep a record and run a desk. We cannot guarantee an item will be found, and we are not responsible for
        property left with a third party outside the desk. Report anything that looks wrong; the{' '}
        <Link href="/safety">safety page</Link> explains how.
      </p>
    </article>
  );
}
