'use server';

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { isEmail, safeInternalPath, str } from '@/lib/validation';
import { issueSignInCode, sendWelcome } from '@/lib/auth/signin';
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
    notice: `We sent a 6-digit code to ${email}. It works once and expires in ten minutes.`,
  };
}

export async function verifyOtp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = str(formData.get('email')).toLowerCase();
  const token = str(formData.get('token')).replace(/\s+/g, '');
  const next = safeInternalPath(str(formData.get('next')));

  if (!/^\d{6}$/.test(token)) {
    return { step: 'otp', email, error: 'Enter the 6-digit code from the email.' };
  }

  let firstTime = false;
  let name: string | null = null;

  try {
    const supabase = await supabaseServer();
    const { data: authData, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) {
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
  await supabase.auth.signOut();
  redirect('/');
}


/**
 * Signing out also unsubscribes this browser from push. Without it the next
 * person to use the device keeps receiving the previous owner's notifications,
 * because a push subscription outlives a cookie.
 */
export async function forgetDevicePush(): Promise<void> {
  const supabase = await supabaseServer();
  try {
    // set_push_opt_in(false) deletes this user's subscriptions and the flag
    await supabase.rpc('set_push_opt_in', { p_on: false });
  } catch {
    // a stale row is removed by the dispatcher after it fails
  }
}
