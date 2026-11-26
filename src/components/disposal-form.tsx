'use client';

import { useActionState } from 'react';
import { disposeItem, type StaffState } from '@/lib/actions/staff';
import { SubmitButton } from './submit-button';
import { Banner } from './banner';

const initial: StaffState = { ok: false };

export function DisposalForm({ itemRef, suggested }: { itemRef: string; suggested: string }) {
  const [state, action] = useActionState(disposeItem, initial);

  return (
    <form className="form" action={action}>
      <input type="hidden" name="item_ref" value={itemRef} />
      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
      {state.message ? <Banner tone="ok">{state.message}</Banner> : null}

      <div className="field-row">
        <div className="field">
          <label htmlFor={`disp-${itemRef}`}>What happened</label>
          <select id={`disp-${itemRef}`} name="disposition" defaultValue={suggested}>
            <option value="donated">Donated</option>
            <option value="disposed">Disposed of</option>
            <option value="returned_to_issuer">Returned to the issuer</option>
            <option value="transferred_to_security">Transferred to campus security</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`note-${itemRef}`}>Note</label>
          <input
            id={`note-${itemRef}`}
            name="note"
            type="text"
            maxLength={300}
            required
            placeholder="Given to the donation drive, 26/11."
          />
        </div>
      </div>

      <SubmitButton className="btn btn-secondary btn-sm" pendingLabel="Recording…">
        Record disposition
      </SubmitButton>
    </form>
  );
}
