'use client';

import { useActionState } from 'react';
import { saveProfile, requestDeletion, type AccountState } from '@/lib/actions/account';
import { SubmitButton } from './submit-button';
import { Banner } from './banner';

const initial: AccountState = { ok: false };

export function AccountForm({
  name,
  phone,
  alerts,
  marketing,
}: {
  name: string;
  phone: string;
  alerts: boolean;
  marketing: boolean;
}) {
  const [state, action] = useActionState(saveProfile, initial);
  return (
    <form className="form" action={action}>
      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
      {state.message ? <Banner tone="ok">{state.message}</Banner> : null}
      <div className="field">
        <label htmlFor="full_name">Name</label>
        <input id="full_name" name="full_name" type="text" autoComplete="name" defaultValue={name} maxLength={120} />
      </div>
      <div className="field">
        <label htmlFor="phone">Phone (optional)</label>
        <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={phone} maxLength={20} />
        <p className="hint">Only the desk sees this, and only if you need a call about a claim.</p>
      </div>
      <label className="check">
        <input type="checkbox" name="alerts" defaultChecked={alerts} />
        <span>Email me when something similar to my lost report is handed in.</span>
      </label>
      <label className="check">
        <input type="checkbox" name="marketing" defaultChecked={marketing} />
        <span>Send me occasional board updates. Separate from match alerts; you can turn it off any time.</span>
      </label>
      <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
    </form>
  );
}

export function DeleteAccount() {
  const [state, action] = useActionState(requestDeletion, initial);
  return (
    <form className="form" action={action}>
      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
      {state.message ? <Banner tone="ok">{state.message}</Banner> : null}
      <p className="small muted">
        This files an erasure request. The desk deletes your account, listings and claims within 7 days and emails you
        to confirm. It cannot be undone.
      </p>
      <SubmitButton className="btn btn-danger btn-sm" pendingLabel="Filing…">
        Request account deletion
      </SubmitButton>
    </form>
  );
}
