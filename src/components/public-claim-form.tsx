'use client';

import { useActionState } from 'react';
import { finishPublicClaim, startPublicClaim, type PublicClaimState } from '@/lib/actions/claims';
import { SubmitButton } from './submit-button';
import { Banner } from './banner';

const initial: PublicClaimState = { ok: false };

/**
 * Two steps, one component: details, then the code that proves the address.
 * Nothing here creates an account in the user's mind — the account is a side
 * effect of proving the email.
 */
export function PublicClaimForm({ itemRef, question }: { itemRef: string; question: string | null }) {
  const [startState, start] = useActionState(startPublicClaim, initial);
  const [finishState, finish] = useActionState(finishPublicClaim, initial);

  const step = finishState.step === 'verify' && finishState.email ? 'verify' : startState.step === 'verify' ? 'verify' : 'details';
  const email = finishState.email ?? startState.email ?? '';
  const fe = startState.fieldErrors ?? {};

  if (step === 'verify' && email) {
    return (
      <form className="form" action={finish}>
        <input type="hidden" name="email" value={email} />
        {startState.notice ? <Banner tone="info">{startState.notice}</Banner> : null}
        {finishState.error ? <Banner tone="danger">{finishState.error}</Banner> : null}
        <div className="field">
          <label htmlFor="claim-token">6-digit code</label>
          <input
            id="claim-token"
            name="token"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            style={{ fontFamily: 'var(--mono)', fontSize: '1.4rem', letterSpacing: '0.3em', textAlign: 'center' }}
          />
          <p className="hint">Sent to {email}. The claim is created the moment the code is right.</p>
        </div>
        <SubmitButton pendingLabel="Checking…">Confirm and submit claim</SubmitButton>
      </form>
    );
  }

  return (
    <form className="form" action={start} noValidate>
      <input type="hidden" name="ref" value={itemRef} />
      {startState.error ? <Banner tone="danger">{startState.error}</Banner> : null}

      <div className="field">
        <label htmlFor="claim-email">Your email</label>
        <input
          id="claim-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@campus.edu"
          aria-invalid={Boolean(fe.email)}
        />
        {fe.email ? <p className="error">{fe.email}</p> : <p className="hint">No account needed. We send a code to prove it is yours.</p>}
      </div>

      <div className="field">
        <label htmlFor="claim-answer">{question ?? 'What identifies this as yours?'}</label>
        <input
          id="claim-answer"
          name="answer"
          type="text"
          required
          maxLength={200}
          autoComplete="off"
          aria-invalid={Boolean(fe.answer)}
        />
        {fe.answer ? <p className="error">{fe.answer}</p> : <p className="hint">Compared with what the finder recorded. A wrong answer never tells you the right one.</p>}
      </div>

      <div className="field">
        <label htmlFor="claim-proof">Anything else that proves it (optional)</label>
        <textarea id="claim-proof" name="proof" maxLength={1000} placeholder="Receipt date, the serial number, a photo of you using it." />
        <p className="hint">Seen only by the desk.</p>
      </div>

      <div>
        <label className="check">
          <input type="checkbox" name="truthful" aria-invalid={Boolean(fe.truthful)} />
          <span>This is my item and the details are true. I understand a false claim can suspend my account.</span>
        </label>
        {fe.truthful ? <p className="error">{fe.truthful}</p> : null}
      </div>

      <div className="form-actions">
        <SubmitButton pendingLabel="Starting…">Claim this item</SubmitButton>
      </div>
    </form>
  );
}
