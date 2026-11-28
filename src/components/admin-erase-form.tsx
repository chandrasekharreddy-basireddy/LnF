'use client';

import { useActionState, useState } from 'react';
import { eraseUser, type AdminState } from '@/lib/actions/admin';
import { SubmitButton } from './submit-button';

const initial: AdminState = { ok: false };

/**
 * Erasure is irreversible and takes the person's photos with it, so it is two
 * steps and surfaces any partial-cleanup notice returned by the server.
 */
export function EraseUserForm({ userId, email }: { userId: string; email: string }) {
  const [state, action] = useActionState(eraseUser, initial);
  const [open, setOpen] = useState(false);

  if (state.ok) {
    return (
      <div className="stack" style={{ gap: 4 }} role="status">
        <span className="chip chip-ok">erased</span>
        {state.message ? <p className="small muted">{state.message}</p> : null}
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        Erase
      </button>
    );
  }

  return (
    <form action={action} className="erase-form">
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="email" value={email} />
      {state.error ? (
        <p className="hint" role="alert" style={{ color: 'var(--danger)' }}>
          {state.error}
        </p>
      ) : null}
      <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'start' }}>
        <input type="checkbox" name="confirm" required />
        <span>
          Erase <strong>{email}</strong> — listings anonymised, photos deleted, claims removed.
        </span>
      </label>
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        <SubmitButton className="btn btn-danger btn-sm" pendingLabel="Erasing…">
          Confirm
        </SubmitButton>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
