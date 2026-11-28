'use server';

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { isEmail, safeInternalPath, str } from '@/lib/validation';
import { issueSignInCode, sendWelcome } from '@/lib/auth/signin';
import { cookies } from 'next/headers';
import { callerIp } from '@/lib/http';

export type AuthState = { step: 'email' | 'otp'; email?: string; error?: string; notice?: string };


/** Hash-only audit row. Never the address, never the code. */
async function logAuthEvent(kind: 'code_requested' | 'code_verified' | 'code_failed' | 'code_throttled', email: string) {
  try {
    const supabase = await supabaseServer();
    await supabase.rpc('log_auth_event', {
      p_kind: kind,
      p_email: email,
      p_ip: await callerIp(),
    });
  } catch {
    // an audit row is not worth failing a sign-in over
  }
}

export async function requestOtp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = str(formData.get('email')).toLowerCase();
  if (!isEmail(email)) return { step: 'email', error: 'Enter a valid email address, for example name@campus.edu.' };

  // Throttle before anything is generated, so the form cannot be used to post
  // mail at somebody else's address.
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.rpc('check_signin_allowed', {
      p_email: email,
      p_ip: await callerIp(),
    });
    const verdict = data as { allowed?: boolean; reason?: string } | null;
    if (verdict && verdict.allowed === false) {
      await logAuthEvent('code_throttled', email);
      return {
        step: 'email',
        email,
        error:
          verdict.reason === 'ip'
            ? 'Too many sign-in attempts from this connection. Wait fifteen minutes and try again.'
            : 'We have sent several codes to that address already. Wait a few minutes, then try again.',
      };
    }
  } catch {
    // if the throttle itself is unreachable, the provider's own limits still apply
  }

  const issued = await issueSignInCode(email);
  if (!issued.ok) return { step: 'email', email, error: issued.error };

  await logAuthEvent('code_requested', email);

  // Deliberately identical whether or not an account existed: the screen must
  // not tell an attacker which addresses are registered.
  return {
    step: 'otp',
    email,
    notice: `We sent a code to ${email}. It works once and expires in ten minutes.`,
  };
}

export async function verifyOtp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = str(formData.get('email')).toLowerCase();
  const token = str(formData.get('token')).replace(/\s+/g, '');
  const next = safeInternalPath(str(formData.get('next')));

  // Supabase issues 6 or 8 digits depending on the project's Email OTP Length
  // setting. Rejecting anything but 6 locked people out of their own account.
  if (!/^\d{6,8}$/.test(token)) {
    return { step: 'otp', email, error: 'Enter the code from the email — it is all digits.' };
  }

  let firstTime = false;
  let name: string | null = null;

  try {
    const supabase = await supabaseServer();

    // The code is minted by admin.generateLink({ type: 'magiclink' }), and
    // Supabase binds an OTP to the type that created it. Verifying a magiclink
    // code as type 'email' returns "Token has expired or is invalid" for a code
    // that is perfectly valid — which is exactly how this failed in production.
    // 'magiclink' first, 'email' second for codes minted by a signup flow.
    let authData: Awaited<ReturnType<typeof supabase.auth.verifyOtp>>['data'] | null = null;
    let error: { message: string } | null = null;
    for (const type of ['magiclink', 'email'] as const) {
      const attempt = await supabase.auth.verifyOtp({ email, token, type });
      if (!attempt.error) {
        authData = attempt.data;
        error = null;
        break;
      }
      error = attempt.error;
    }

    if (error || !authData) {
      // the reason matters to whoever runs this, the wording does not help a user
      console.warn('[auth] verifyOtp failed:', error?.message ?? 'no data');
      await logAuthEvent('code_failed', email);
      return { step: 'otp', email, error: 'That code is wrong or has expired. Request a new one.' };
    }

    // The code proved the address. Record that, and greet a new account once.
    const { data: profile } = authData.user?.id
      ? await supabase.from('profiles').select('full_name,email_verified_at').eq('id', authData.user.id).maybeSingle()
      : { data: null };
    firstTime = !profile?.email_verified_at;
    name = (profile?.full_name as string | null) ?? null;

    await supabase.rpc('mark_email_verified');
    await logAuthEvent('code_verified', email);
  } catch {
    return { step: 'otp', email, error: 'Could not verify the code. Try again.' };
  }

  if (firstTime) await sendWelcome(email, name);
  redirect(next);
}

export async function signOut(): Promise<void> {
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signOut();

  if (error) {
    // signOut() returns before it clears storage when GoTrue answers 5xx or the
    // network blips. Redirecting anyway would leave a fully valid session on a
    // shared counter machine, so the cookies go regardless.
    const store = await cookies();
    for (const cookie of store.getAll()) {
      if (cookie.name.startsWith('sb-')) store.delete(cookie.name);
    }
  }

  redirect('/');
}


/**
 * Signing out also unsubscribes this browser from push. Without it the next
 * person to use the device keeps receiving the previous owner's notifications,
 * because a push subscription outlives a cookie.
 */
export async function forgetDevicePush(endpoint?: string): Promise<void> {
  const supabase = await supabaseServer();
  try {
    // Only the device being signed out. set_push_opt_in(false) deleted every
    // subscription the person had, so signing out on a library machine also
    // silenced their phone.
    if (endpoint) {
      await supabase.rpc('unregister_push_subscription', { p_endpoint: endpoint });
    }
  } catch {
    // a stale row is removed by the dispatcher after it fails
  }
}
