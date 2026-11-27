'use client';

import { useActionState } from 'react';
import { recordReview, type AdminState } from '@/lib/actions/admin';
import { SubmitButton } from './submit-button';
import { Banner } from './banner';

const initial: AdminState = { ok: false };

export function ReviewForm() {
  const [state, action] = useActionState(recordReview, initial);

  return (
    <form className="form" action={action}>
      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
      {state.message ? <Banner tone="ok">{state.message}</Banner> : null}
      <div className="field">
        <label htmlFor="review-notes">What you looked at (optional)</label>
        <input
          id="review-notes"
          name="notes"
          type="text"
          maxLength={1000}
          placeholder="Recovery rate flat, 3 expired items disposed, one dispute resolved."
        />
      </div>
      <SubmitButton className="btn btn-sm" pendingLabel="Recording…">
        Record this week&apos;s review
      </SubmitButton>
    </form>
  );
}
