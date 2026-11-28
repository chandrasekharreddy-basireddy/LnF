'use client';

/* eslint-disable react-hooks/refs --
   useFormDraft returns { formRef, onBeforeSubmit }. Passing a ref object to
   <form ref=...> is the documented pattern; the rule flags reading it off the
   returned object because it cannot see through the hook. */

import { useFormDraft } from './form-draft';
import { useActionState } from 'react';
import { handInFoundItem, type HandInState } from '@/lib/actions/reports';
import { CATEGORIES } from '@/lib/copy';
import { todayISO } from '@/lib/validation';
import { SubmitButton } from './submit-button';
import { Banner } from './banner';

const initial: HandInState = { ok: false };

/** The public intake form. No account, no photo upload, staff review first. */
export function HandInForm({ zones }: { zones: { code: string; name: string }[] }) {
  const [state, action] = useActionState(handInFoundItem, initial);
  const draft = useFormDraft(state);
  const fe = state.fieldErrors ?? {};

  return (
    <form className="form" action={action} ref={draft.formRef} onSubmit={draft.onBeforeSubmit} noValidate>
      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}

      <div className="field">
        <label htmlFor="title">What did you find?</label>
        <input id="title" name="title" type="text" maxLength={120} required placeholder="Black wireless earbuds in a charging case" aria-invalid={Boolean(fe.title)} />
        {fe.title ? <p className="error">{fe.title}</p> : null}
      </div>

      <div className="field">
        <label htmlFor="description">Describe it, without the one detail that proves ownership</label>
        <textarea id="description" name="description" maxLength={1000} required placeholder="Matte black case, small sticker on the back. Found on a study desk." aria-invalid={Boolean(fe.description)} />
        {fe.description ? <p className="error">{fe.description}</p> : <p className="hint">Never write a serial number, an ID number or a full name here. That belongs in the answer below.</p>}
      </div>

      <div className="filters">
        <div className="field">
          <label htmlFor="category">Category</label>
          <select id="category" name="category" defaultValue="other">
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="zone">Where</label>
          <select id="zone" name="zone" defaultValue="">
            <option value="">Not sure</option>
            {zones.map((z) => (
              <option key={z.code} value={z.code}>{z.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="spot">Exact spot (optional)</label>
          <input id="spot" name="spot" type="text" maxLength={120} placeholder="Third table from the window" />
        </div>
        <div className="field">
          <label htmlFor="event_date">Date you found it</label>
          <input id="event_date" name="event_date" type="date" max={todayISO()} defaultValue={todayISO()} required aria-invalid={Boolean(fe.event_date)} />
          {fe.event_date ? <p className="error">{fe.event_date}</p> : null}
        </div>
      </div>

      <div className="field">
        <label htmlFor="question">One question only the owner could answer</label>
        <input id="question" name="question" type="text" maxLength={200} required placeholder="What is written on the rubber band around it?" aria-invalid={Boolean(fe.question)} />
        {fe.question ? <p className="error">{fe.question}</p> : <p className="hint">This is what the desk uses to check a claim. It is shown publicly; the answer never is.</p>}
      </div>

      <div className="field">
        <label htmlFor="answer">The answer</label>
        <input id="answer" name="answer" type="text" maxLength={200} required autoComplete="off" aria-invalid={Boolean(fe.answer)} />
        {fe.answer ? <p className="error">{fe.answer}</p> : <p className="hint">Stored as a one-way hash. Nobody at the desk can read it either.</p>}
      </div>

      <div className="filters">
        <div className="field">
          <label htmlFor="finder_email">Your email (optional)</label>
          <input id="finder_email" name="finder_email" type="email" autoComplete="email" placeholder="So the desk can thank you" />
        </div>
        <div className="field">
          <label htmlFor="finder_phone">Your phone (optional)</label>
          <input id="finder_phone" name="finder_phone" type="tel" autoComplete="tel" maxLength={20} />
        </div>
      </div>

      <div className="card" style={{ background: 'var(--brand-soft)', borderColor: 'var(--brand-soft)' }}>
        <p className="small" style={{ marginBottom: 4 }}>
          <strong>Hand it to the desk, not to a stranger.</strong>
        </p>
        <p className="small muted" style={{ margin: 0 }}>
          Take the item to Main Gate & Security Desk. They photograph it and add it to the board. Never arrange a
          handover yourself, and never ask for money.
        </p>
      </div>

      <div className="form-actions">
        <SubmitButton pendingLabel="Sending…">Log this item</SubmitButton>
      </div>
    </form>
  );
}
