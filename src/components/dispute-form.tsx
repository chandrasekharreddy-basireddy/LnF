'use client';

import { useActionState } from 'react';
import { openDispute, type DisputeState } from '@/lib/actions/disputes';
import { SubmitButton } from './submit-button';
import { Banner } from './banner';
import { REASON_MAX, REASON_MIN } from '@/lib/trust';

const initial: DisputeState = { ok: false };

/**
 * Ask the desk to look at a decision again.
 *
 * One field, because a dispute is a sentence about what was missed — not a form.
 * The thread underneath is where the back-and-forth happens.
 */
export function DisputeForm({ claimRef, daysLeft }: { claimRef: string; daysLeft: number }) {
  const [state, action] = useActionState(openDispute, initial);

  return (
    <form className="form" action={action}>
      <input type="hidden" name="claim_ref" value={claimRef} />
      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}

      <div className="field">
        <label htmlFor={`dispute-${claimRef}`}>What should the desk look at?</label>
        <textarea
          id={`dispute-${claimRef}`}
          name="reason"
          required
          minLength={REASON_MIN}
          maxLength={REASON_MAX}
          aria-describedby={`dispute-hint-${claimRef}`}
          placeholder="Something the answer or the proof did not cover — a mark, a serial number, who was with you."
        />
        <p className="hint" id={`dispute-hint-${claimRef}`}>
          At least {REASON_MIN} characters. {daysLeft === 0 ? 'The window closes today.' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left to contest this decision.`}{' '}
          Do not include a phone number, an email address or an ID number — those are blocked automatically.
        </p>
      </div>

      <SubmitButton className="btn btn-sm" pendingLabel="Sending…">
        Ask for a second look
      </SubmitButton>
    </form>
  );
}
