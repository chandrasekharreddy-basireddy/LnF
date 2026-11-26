'use client';

import { useState } from 'react';

export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? 'Copied' : 'Copy code'}
      </button>
      <span className="small muted" role="status" aria-live="polite">
        {copied ? 'Keep it private until you are at the counter.' : ''}
      </span>
    </div>
  );
}
