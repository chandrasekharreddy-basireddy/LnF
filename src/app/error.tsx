'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Log the digest only — never the message, which can carry user input.
    console.error('[lnf] render error', error.digest ?? 'no-digest');
  }, [error]);

  return (
    <div className="section" style={{ maxWidth: 560, paddingTop: 40 }}>
      <p className="eyebrow">Something broke</p>
      <h1>This screen did not load.</h1>
      <p className="lede">
        The board itself is probably fine. Retry, and if it keeps failing the desk can look up your reference directly.
      </p>
      <div className="row" style={{ marginTop: 20 }}>
        <button className="btn" type="button" onClick={reset}>
          Try again
        </button>
        <Link className="btn btn-secondary" href="/browse">
          Browse the board
        </Link>
      </div>
      {error.digest ? <p className="small muted" style={{ marginTop: 16 }}>Reference: {error.digest}</p> : null}
    </div>
  );
}
