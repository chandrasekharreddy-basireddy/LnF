'use client';

import { useActionState } from 'react';
import { requestOtp, verifyOtp, type AuthState } from '@/lib/actions/auth';
import { SubmitButton } from './submit-button';
import { Banner } from './banner';

const initial: AuthState = { step: 'email' };

export function SignInForm({ next = '/account' }: { next?: string }) {
  const [state, action] = useActionState(requestOtp, initial);
  const [verifyState, verifyAction] = useActionState(verifyOtp, initial);

  const step = verifyState.step === 'otp' && verifyState.email ? 'otp' : state.step;
  const email = verifyState.email ?? state.email ?? '';
  const error = verifyState.error ?? state.error;

  if (step === 'otp' && email) {
    return (
      <form className="form" action={verifyAction}>
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="next" value={next} />
        {state.notice ? <Banner tone="info">{state.notice}</Banner> : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <div className="field">
          <label htmlFor="token">6-digit code</label>
          <input
            id="token"
            name="token"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            style={{ fontFamily: 'var(--mono)', fontSize: '1.4rem', letterSpacing: '0.3em', textAlign: 'center' }}
          />
          <p className="hint">
            Sent to {email}. Check spam if it has not arrived in a minute. You can also click the link in the email.
          </p>
        </div>
        <SubmitButton pendingLabel="Verifying…">Verify and sign in</SubmitButton>
      </form>
    );
  }

  return (
    <form className="form" action={action}>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <div className="field">
        <label htmlFor="email">Email address</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@campus.edu"
          defaultValue={email}
        />
        <p className="hint">We email a 6-digit code. No password to remember or leak.</p>
      </div>
      <SubmitButton pendingLabel="Sending code…">Email me a code</SubmitButton>
    </form>
  );
}
