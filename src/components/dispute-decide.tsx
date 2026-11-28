'use client';

import { useActionState } from 'react';
import { decideDispute, type DisputeState } from '@/lib/actions/disputes';
import { SubmitButton } from './submit-button';
import { Banner } from './banner';
import { NOTE_MIN } from '@/lib/trust';

const initial: DisputeState = { ok: false };

/**
 * Uphold or dismiss, with a reason.
 *
 * The button says what it does to the claim, not just "submit": upholding puts a
 * rejected claim back in the queue only while the item is still in custody, and
 * a staff member should know which of those they are choosing.
 */
export function DisputeDecide({ disputeRef }: { disputeRef: string }) {
  const [state, action] = useActionState(decideDispute, initial);

  return (
    <form className="form" action={action}>
      <input type="hidden" name="dispute_ref" value={disputeRef} />
      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
      {state.ok ? <Banner tone="ok">Recorded. The person who raised it has been told.</Banner> : null}

      <fieldset className="field">
        <legend>Outcome</legend>
        <label className="check">
          <input type="radio" name="decision" value="upheld" required />
          Uphold — the decision was wrong
        </label>
        <label className="check">
          <input type="radio" name="decision" value="dismissed" />
          Dismiss — the decision stands
        </label>
      </fieldset>

      <div className="field">
        <label htmlFor={`note-${disputeRef}`}>Reason (on the record)</label>
        <textarea
          id={`note-${disputeRef}`}
          name="note"
          required
          minLength={NOTE_MIN}
          maxLength={2000}
          placeholder="What you checked, and what you decided. The claimant reads this."
        />
        <p className="hint">
          Upholding reopens the claim only while the item is still with the desk. After a handover it records the
          finding and changes nothing else — the page says so before you send it.
        </p>
      </div>

      <SubmitButton className="btn btn-sm" pendingLabel="Recording…">
        Record the outcome
      </SubmitButton>
    </form>
  );
}
