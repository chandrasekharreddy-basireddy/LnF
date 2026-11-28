'use client';

import { useActionState } from 'react';
import { setRole, purgeSamples, type AdminState } from '@/lib/actions/admin';
import { SubmitButton } from './submit-button';
import { Banner } from './banner';

const initial: AdminState = { ok: false };

export function RoleForm() {
  const [state, action] = useActionState(setRole, initial);
  return (
    <form className="form" action={action}>
      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
      {state.message ? <Banner tone="ok">{state.message}</Banner> : null}
      <div className="field-row">
        <div className="field">
          <label htmlFor="email">Account email</label>
          <input id="email" name="email" type="email" required placeholder="name@example.com" />
          <p className="hint">They must sign in once before a role can be granted.</p>
        </div>
        <div className="field">
          <label htmlFor="role">Role</label>
          <select id="role" name="role" defaultValue="staff">
            <option value="staff">Staff — desk access</option>
            <option value="admin">Admin — full access</option>
            <option value="member">Member — no console</option>
          </select>
        </div>
      </div>
      <div className="row">
        <SubmitButton className="btn btn-sm" name="grant" value="true" pendingLabel="Granting…">
          Grant
        </SubmitButton>
        <SubmitButton className="btn btn-secondary btn-sm" name="grant" value="false" pendingLabel="Removing…">
          Remove
        </SubmitButton>
      </div>
    </form>
  );
}

export function PurgeSamples() {
  const [state, action] = useActionState(purgeSamples, initial);
  return (
    <form className="form" action={action}>
      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
      {state.message ? <Banner tone="ok">{state.message}</Banner> : null}
      <p className="small muted">
        The six example listings shipped with a fresh board are marked as samples and excluded from published
        statistics. Remove them once the real backlog is photographed and listed.
      </p>
      <SubmitButton className="btn btn-secondary btn-sm" pendingLabel="Removing…">
        Remove sample listings
      </SubmitButton>
    </form>
  );
}
