import type { Metadata } from 'next';
import Link from 'next/link';
import { zones } from '@/lib/data';
import { HandInForm } from '@/components/hand-in-form';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Hand something in',
  description: 'Found something on campus? Log it in under a minute — no account needed. The desk takes custody.',
};

export default async function HandInPage() {
  const zoneList = await zones();

  return (
    <div className="section" style={{ marginTop: 8, maxWidth: 760 }}>
      <p className="eyebrow">Hand something in</p>
      <h1>You found it. That is the hard part.</h1>
      <p className="lede" style={{ marginBottom: 8 }}>
        Tell us what it is and one thing only its owner would know. No account, no photograph, no meeting a stranger.
      </p>
      <p className="small muted" style={{ marginBottom: 24 }}>
        Already signed in? <Link href="/report/found">Use the fuller form</Link> — it lets you add a photo.
      </p>

      <div className="card">
        <HandInForm zones={zoneList} />
      </div>

      <p className="small muted" style={{ marginTop: 16 }}>
        A staff member checks every hand-in before it appears on the board, usually within a few hours. Bring the item
        to {env.deskLabel}.
      </p>
    </div>
  );
}
