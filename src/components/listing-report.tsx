'use client';

import { useActionState } from 'react';
import { reportListing, type ListingReportState } from '@/lib/actions/reports';
import { SubmitButton } from './submit-button';
import { Banner } from './banner';

const initial: ListingReportState = { ok: false };

export function ListingReport({ itemRef }: { itemRef: string }) {
  const [state, action] = useActionState(reportListing, initial);

  if (state.done) {
    return <Banner tone="ok" title="Report sent">The desk reviews reports the same day. Thank you.</Banner>;
  }

  return (
    <details>
      <summary className="small" style={{ cursor: 'pointer', color: 'var(--ink-soft)' }}>
        Report a problem with this listing
      </summary>
      <form className="form" action={action} style={{ marginTop: 12 }}>
        <input type="hidden" name="ref" value={itemRef} />
        {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
        <div className="field">
          <label htmlFor="reason">What is wrong?</label>
          <select id="reason" name="reason" defaultValue="scam">
            <option value="scam">It asks for money or a deposit</option>
            <option value="wrong">Wrong or misleading details</option>
            <option value="private">It exposes someone&apos;s private information</option>
            <option value="duplicate">Duplicate listing</option>
            <option value="other">Something else</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="details">Details (optional)</label>
          <textarea id="details" name="details" maxLength={1000} />
        </div>
        <SubmitButton className="btn btn-secondary btn-sm" pendingLabel="Sending…">
          Send report
        </SubmitButton>
      </form>
    </details>
  );
}
