'use client';

import { useActionState } from 'react';
import { postMessage, type MessageState } from '@/lib/actions/messages';
import { SubmitButton } from './submit-button';
import { Banner } from './banner';

const initial: MessageState = { ok: false };

export function MessageForm({ claimRef, backTo }: { claimRef: string; backTo?: string }) {
  const [state, action] = useActionState(postMessage, initial);

  return (
    <form className="form" action={action}>
      <input type="hidden" name="claim_ref" value={claimRef} />
      <input type="hidden" name="back_to" value={backTo ?? `/claims/${claimRef}`} />
      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
      {state.ok ? <Banner tone="ok">{state.message}</Banner> : null}

      <div className="field">
        <label htmlFor={`body-${claimRef}`}>Reply on the board</label>
        <textarea
          id={`body-${claimRef}`}
          name="body"
          maxLength={2000}
          required
          placeholder="Ask a question, or add proof the desk can check."
        />
        <p className="hint">
          Read by the claimant, the finder and the desk. No email addresses, phone numbers or payment requests — those
          are blocked automatically.
        </p>
      </div>

      <SubmitButton className="btn btn-sm" pendingLabel="Sending…">
        Send message
      </SubmitButton>
    </form>
  );
}
