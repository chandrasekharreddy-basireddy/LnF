import type { Metadata } from 'next';
import Link from 'next/link';
import { env } from '@/lib/env';
import { RETENTION } from '@/lib/retention';

export const metadata: Metadata = { title: 'Privacy notice', description: 'What L&F collects, why, and when it is deleted.' };

export default function PrivacyPage() {
  return (
    <article className="section" style={{ marginTop: 8, maxWidth: 720 }}>
      <p className="eyebrow">Legal</p>
      <h1>Privacy notice</h1>
      <p className="lede">
        Plain language, and short on purpose. This is what {env.campusName} holds when you use L&amp;F, and when it goes
        away. It is a product notice, not legal advice — the institution&apos;s counsel should review it before a public
        launch.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Your email address.</strong> Used to sign you in with a one-time code and to tell you about your own
          listings and claims. Never shown on a listing.
        </li>
        <li>
          <strong>Your name and phone number, if you add them.</strong> Seen only by the desk, and only to reach you
          about a claim.
        </li>
        <li>
          <strong>Listing content.</strong> The description, zone, date and photos you post. Descriptions are public.
          Photos are stored privately and served through links that expire in an hour.
        </li>
        <li>
          <strong>The verification answer.</strong> Stored as a one-way hash. Nobody, including staff, can read it back;
          the desk can only check whether an answer matches.
        </li>
        <li>
          <strong>Operational records.</strong> Claims, decisions, handovers and an audit log of staff actions. Kept so
          an item cannot be released twice or to the wrong person.
        </li>
      </ul>

      <h2>What we never collect</h2>
      <p>
        No Aadhaar or PAN numbers, no ID scans, no addresses, no payment details. A found ID document or bank card is
        never photographed or listed — it goes to the desk and to the issuing authority.
      </p>

      <h2>Photo metadata</h2>
      <p>
        Every uploaded photo is re-encoded on our server before it is stored. Location data, camera model, timestamps
        and all other EXIF metadata are removed in that step. You can also mark a photo as sensitive, which hides it
        from the public listing entirely.
      </p>

      <h2>Separate choices, not bundled</h2>
      <p>
        Match alerts are an opt-in you control on your account page. Marketing is a second, separate opt-in. Neither is
        a condition of using the board, and you can turn either off without emailing anyone.
      </p>

      <h2>How long we keep things</h2>
      <p>
        A listing lives for {RETENTION.listingDays} days. Then it is hidden, and {RETENTION.purgeAfterExpiryDays} days
        later it and its photos are deleted. The full table is on the{' '}
        <Link href="/legal/retention">retention page</Link>, and it is generated from the same constants the cleanup job
        uses.
      </p>

      <h2>Who can see what</h2>
      <p>
        The public board shows only: title, category, description, zone, date, custody location and the verification
        question. Answers, contact details, serial numbers, bin codes and staff notes are never sent to a browser that
        is not signed in as staff. This is enforced in the database, not just in the page code.
      </p>

      <h2>Your rights</h2>
      <p>
        You can see and correct your details on your <Link href="/account">account page</Link>, withdraw consent there,
        and file an erasure request in one click. The desk completes erasure within 7 days and confirms by email. If you
        believe something is wrong, write to {env.supportContact}.
      </p>

      <h2>Processors</h2>
      <p>
        Supabase (database, file storage and sign-in), Vercel (hosting), Brevo (email delivery). Each holds only the
        data needed for its job. Data is stored in the Supabase region closest to the campus.
      </p>
    </article>
  );
}
