'use client';

import { useActionState } from 'react';
import { submitClaim, type ClaimState } from '@/lib/actions/claims';
import { SubmitButton } from './submit-button';
import { Banner } from './banner';

const initial: ClaimState = { ok: false };

export function ClaimForm({ itemRef, question }: { itemRef: string; question: string | null }) {
  const [state, action] = useActionState(submitClaim, initial);
  const fe = state.fieldErrors ?? {};

  return (
    <form className="form" action={action} noValidate>
      <input type="hidden" name="ref" value={itemRef} />

      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}

      <div className="field">
        <label htmlFor="answer">{question ?? 'What identifies this as yours?'}</label>
        <input
          id="answer"
          name="answer"
          type="text"
          required
          maxLength={200}
          autoComplete="off"
          aria-invalid={Boolean(fe.answer)}
          aria-describedby={fe.answer ? 'answer-error' : 'answer-hint'}
        />
        {fe.answer ? (
          <p className="error" id="answer-error">
            {fe.answer}
          </p>
        ) : (
          <p className="hint" id="answer-hint">
            The desk compares this with what the finder recorded. A wrong answer does not tell you what the right one
            is.
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="proof">Anything else that proves it is yours (optional)</label>
        <textarea
          id="proof"
          name="proof"
          maxLength={1000}
          placeholder="Purchase receipt date, a photo of you using it, the serial number."
        />
        <p className="hint">Seen only by the desk, never published.</p>
      </div>

      <div>
        <label className="check">
          <input type="checkbox" name="truthful" aria-invalid={Boolean(fe.truthful)} />
          <span>
            This is my item and the details are true. I understand a false claim can suspend my account.
          </span>
        </label>
        {fe.truthful ? <p className="error">{fe.truthful}</p> : null}
      </div>

      <div className="form-actions">
        <SubmitButton pendingLabel="Submitting…">Submit claim</SubmitButton>
        <span className="form-note">The desk reviews claims within two working days.</span>
      </div>
    </form>
  );
}
