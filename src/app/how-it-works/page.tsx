import type { Metadata } from 'next';
import Link from 'next/link';
import { env } from '@/lib/env';

export const metadata: Metadata = {
  title: 'How it works',
  description: 'Report, match, verify, collect. The four steps of a recovery.',
};

export default function HowItWorksPage() {
  return (
    <article className="section" style={{ marginTop: 8, maxWidth: 760 }}>
      <p className="eyebrow">How it works</p>
      <h1>Four steps, one counter.</h1>
      <p className="lede">
        Everything happens on one board and ends at {env.deskLabel}. No group chats, no phone numbers swapped, no
        payment at any step.
      </p>

      <div className="stack-lg" style={{ marginTop: 28 }}>
        <section className="card">
          <p className="eyebrow">Step 1 — Report</p>
          <h2>Log it in about a minute</h2>
          <p>
            Found something? Photograph it, say where and when, and write one question only the owner could answer. The
            question is public; the answer is hashed and never shown. Lost something? Describe it without ID numbers or
            your phone number, and turn on match alerts.
          </p>
        </section>

        <section className="card">
          <p className="eyebrow">Step 2 — Match</p>
          <h2>We look for the other half</h2>
          <p>
            A new found item is compared with every open lost report on title, category, zone and date. Anything close
            is flagged and the reporter gets one email. You can always search the board yourself — the search box
            understands &ldquo;airpods&rdquo; when the listing says &ldquo;earbuds&rdquo;.
          </p>
        </section>

        <section className="card">
          <p className="eyebrow">Step 3 — Verify</p>
          <h2>Prove it is yours</h2>
          <p>
            Start a claim and answer the verification question, plus anything else you can show. A wrong answer never
            reveals the right one. The desk compares your answer with the finder&apos;s record and decides — usually
            within two working days.
          </p>
        </section>

        <section className="card">
          <p className="eyebrow">Step 4 — Collect</p>
          <h2>One code, one handover</h2>
          <p>
            An approved claim issues a one-time code, shown once on your claim page. Show it at the counter with photo
            ID. The desk records the handover, the item is marked returned, and the finder gets a thank-you note.
          </p>
        </section>
      </div>

      <h2 style={{ marginTop: 36 }}>Questions people actually ask</h2>
      <div className="stack">
        <details className="card card-tight">
          <summary>Do I need an account?</summary>
          <p className="small" style={{ marginTop: 8 }}>
            To browse, no. To report, claim or collect, yes — a verified email, no password. That is how the desk reaches
            you and how a claim is tied to a person.
          </p>
        </details>
        <details className="card card-tight">
          <summary>Is my phone number public?</summary>
          <p className="small" style={{ marginTop: 8 }}>
            Never. Contact details stay with the desk. The listing shows only what is on the item card.
          </p>
        </details>
        <details className="card card-tight">
          <summary>How long does an item stay listed?</summary>
          <p className="small" style={{ marginTop: 8 }}>
            90 days, then it is hidden and eventually deleted. If you still need it, the desk can renew the listing
            before it expires.
          </p>
        </details>
        <details className="card card-tight">
          <summary>What if the item is already returned?</summary>
          <p className="small" style={{ marginTop: 8 }}>
            The listing stays visible with a &ldquo;Returned&rdquo; status so you can see what happened, but it cannot
            be claimed again.
          </p>
        </details>
      </div>

      <p style={{ marginTop: 28 }}>
        <Link className="btn" href="/browse">
          Search the board
        </Link>
      </p>
    </article>
  );
}
