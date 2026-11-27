'use client';

import { useActionState } from 'react';
import { decideClaim, confirmHandover, setItemStatus, closeReport, type StaffState } from '@/lib/actions/staff';
import { SubmitButton } from './submit-button';
import { Banner } from './banner';

const initial: StaffState = { ok: false };

export function ClaimDecision({ claimRef, itemRef, status }: { claimRef: string; itemRef: string; status: string }) {
  const [state, action] = useActionState(decideClaim, initial);
  const decided = ['approved', 'rejected', 'withdrawn'].includes(status);

  return (
    <form className="form" action={action}>
      <input type="hidden" name="claim_ref" value={claimRef} />
      <input type="hidden" name="item_ref" value={itemRef} />
      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
      {state.message ? <Banner tone="ok">{state.message}</Banner> : null}

      <div className="field">
        <label htmlFor={`reason-${claimRef}`}>Reason (shown to the claimant on a rejection)</label>
        <input
          id={`reason-${claimRef}`}
          name="reason"
          type="text"
          maxLength={300}
          placeholder="Serial number did not match the item."
        />
      </div>

      <div className="row">
        <SubmitButton className="btn btn-sm" name="decision" value="approve" pendingLabel="Saving…">
          Approve
        </SubmitButton>
        <SubmitButton className="btn btn-secondary btn-sm" name="decision" value="review" pendingLabel="Saving…">
          Move to review
        </SubmitButton>
        <SubmitButton className="btn btn-danger btn-sm" name="decision" value="reject" pendingLabel="Saving…">
          Reject
        </SubmitButton>
      </div>
      {decided ? <p className="form-note">This claim is already {status.replace('_', ' ')}.</p> : null}
    </form>
  );
}

export function HandoverForm({
  itemRef,
  requiresWitness = false,
  staff = [],
}: {
  itemRef: string;
  requiresWitness?: boolean;
  staff?: { id: string; name: string }[];
}) {
  const [state, action] = useActionState(confirmHandover, initial);
  return (
    <form className="form" action={action}>
      <input type="hidden" name="item_ref" value={itemRef} />
      {requiresWitness ? (
        <div className="field">
          <label htmlFor="witness">Countersigned by</label>
          <select id="witness" name="witness" required defaultValue="">
            <option value="" disabled>
              Choose a staff member
            </option>
            {staff.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          <p className="hint">
            High-value categories are released by two people, and both are recorded in the audit log. You cannot
            countersign your own handover.
          </p>
        </div>
      ) : null}
      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
      {state.message ? <Banner tone="ok">{state.message}</Banner> : null}
      <div className="field">
        <label htmlFor="code">Handover code from the owner&apos;s claim page</label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="text"
          autoComplete="off"
          maxLength={6}
          style={{ fontFamily: 'var(--mono)', letterSpacing: '0.3em', textTransform: 'uppercase' }}
        />
        <p className="hint">
          Six characters. If the owner cannot show it, leave it blank and write why below — the desk refuses a
          handover with neither a code nor a note.
        </p>
      </div>
      <div className="field">
        <label htmlFor="note">Note (required when there is no code)</label>
        <input id="note" name="note" type="text" maxLength={300} placeholder="Owner collected in person, ID checked." />
      </div>
      <SubmitButton pendingLabel="Recording…">Confirm handover</SubmitButton>
    </form>
  );
}

export function ItemStatusForm({ itemRef, status }: { itemRef: string; status: string }) {
  const [state, action] = useActionState(setItemStatus, initial);
  return (
    <form className="form" action={action}>
      <input type="hidden" name="item_ref" value={itemRef} />
      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
      {state.message ? <Banner tone="ok">{state.message}</Banner> : null}
      <div className="field">
        <label htmlFor="status">Change listing status</label>
        <select id="status" name="status" defaultValue={status}>
          <option value="available">Publish on the board</option>
          <option value="pending_moderation">Hold for review</option>
          <option value="quarantined">Keep at the desk only</option>
          <option value="archived">Archive</option>
          <option value="expired">Expire now</option>
        </select>
        <p className="hint">Current status: {status.replace('_', ' ')}</p>
      </div>
      <div className="field">
        <label htmlFor="note-status">Reason</label>
        <input id="note-status" name="note" type="text" maxLength={300} />
      </div>
      <SubmitButton className="btn btn-secondary" pendingLabel="Updating…">
        Update listing
      </SubmitButton>
    </form>
  );
}

export function CloseReportForm({ reportId }: { reportId: string }) {
  const [state, action] = useActionState(closeReport, initial);
  return (
    <form action={action} className="row">
      <input type="hidden" name="report_id" value={reportId} />
      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
      {state.message ? <span className="small muted">{state.message}</span> : null}
      <SubmitButton className="btn btn-secondary btn-sm" pendingLabel="Closing…">
        Close report
      </SubmitButton>
    </form>
  );
}
