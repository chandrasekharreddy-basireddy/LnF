'use client';

import { useActionState } from 'react';
import {
  createSavedSearch,
  deleteSavedSearch,
  toggleSavedItem,
  type SavedState,
} from '@/lib/actions/saved';
import { SubmitButton } from './submit-button';
import { Banner } from './banner';

const initial: SavedState = { ok: false };

export function SaveItemButton({ itemRef, saved }: { itemRef: string; saved: boolean }) {
  const [state, action] = useActionState(toggleSavedItem, initial);
  const isSaved = state.saved ?? saved;

  return (
    <form action={action}>
      <input type="hidden" name="ref" value={itemRef} />
      <SubmitButton className="btn btn-secondary btn-block" pendingLabel="Saving…">
        {isSaved ? '★ Saved — tap to remove' : '☆ Save this item'}
      </SubmitButton>
      {state.error ? (
        <p className="small" style={{ color: 'var(--danger)', marginTop: 6 }}>
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function SaveSearchForm({
  q,
  type,
  category,
  zone,
}: {
  q?: string;
  type?: string;
  category?: string;
  zone?: string;
}) {
  const [state, action] = useActionState(createSavedSearch, initial);
  const suggested =
    [q, category, zone].filter(Boolean).join(' · ') || (type === 'lost' ? 'lost items' : 'found items');

  return (
    <form className="form" action={action}>
      <input type="hidden" name="q" value={q ?? ''} />
      <input type="hidden" name="type" value={type ?? ''} />
      <input type="hidden" name="category" value={category ?? ''} />
      <input type="hidden" name="zone" value={zone ?? ''} />

      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
      {state.ok ? <Banner tone="ok">{state.message}</Banner> : null}

      <div className="field">
        <label htmlFor="search-label">Name this search</label>
        <input id="search-label" name="label" type="text" maxLength={60} defaultValue={suggested} required />
        <p className="hint">
          You get one in-app notification when a new listing matches. No email unless you turned alerts on.
        </p>
      </div>
      <SubmitButton className="btn btn-secondary btn-sm" pendingLabel="Saving…">
        Save this search
      </SubmitButton>
    </form>
  );
}

export function DeleteSearchButton({ id }: { id: string }) {
  const [state, action] = useActionState(deleteSavedSearch, initial);
  return (
    <form action={action} className="row">
      <input type="hidden" name="id" value={id} />
      {state.error ? <span className="small" style={{ color: 'var(--danger)' }}>{state.error}</span> : null}
      <SubmitButton className="btn btn-ghost btn-sm" pendingLabel="Removing…">
        Remove
      </SubmitButton>
    </form>
  );
}
