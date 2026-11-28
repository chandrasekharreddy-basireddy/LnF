'use client';

import { useActionState } from 'react';
import { withdrawDispute, type DisputeState } from '@/lib/actions/disputes';
import { SubmitButton } from './submit-button';
import { Banner } from './banner';

const initial: DisputeState = { ok: false };

export function DisputeWithdraw({ disputeRef }: { disputeRef: string }) {
  const [state, action] = useActionState(withdrawDispute, initial);

  return (
    <form className="form" action={action}>
      <input type="hidden" name="dispute_ref" value={disputeRef} />
      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
      {state.ok ? <Banner tone="ok">Withdrawn. Nothing further will happen with this dispute.</Banner> : null}
      <SubmitButton className="btn btn-ghost btn-sm" pendingLabel="Withdrawing…">
        Withdraw this dispute
      </SubmitButton>
      <p className="hint">You can withdraw while it is still with the desk. It cannot be reopened afterwards.</p>
    </form>
  );
}
