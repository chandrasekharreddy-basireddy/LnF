'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin, supabaseServer } from '@/lib/supabase-server';
import { currentUser } from '@/lib/data';
import { errorText } from '@/lib/copy';
import { clamp, isEmail, str } from '@/lib/validation';
import { sendOrQueue, templates } from '@/lib/email';
import { issueSignInCode } from '@/lib/auth/signin';
import { cookies } from 'next/headers';
import { callerIp } from '@/lib/http';

export type ClaimState = { ok: boolean; error?: string; fieldErrors?: Record<string, string> };

export async function submitClaim(_prev: ClaimState, formData: FormData): Promise<ClaimState> {
  const user = await currentUser();
  if (!user) {
    return { ok: false, error: 'Sign in to claim an item. The desk needs a verified email to reach you.' };
  }
  const ref = str(formData.get('ref'));
  const answer = clamp(str(formData.get('answer')), 200);
  const proof = clamp(str(formData.get('proof')), 1000);
  const agreed = formData.get('truthful') === 'on';

  const fieldErrors: Record<string, string> = {};
  if (answer.length < 2) fieldErrors.answer = 'Answer the verification question.';
  if (!agreed) fieldErrors.truthful = 'Confirm this before submitting.';
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors, error: 'Check the highlighted fields.' };

  let claimRef = '';
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('submit_claim', {
      p_ref: ref,
      p_answer: answer,
      p_proof: proof || null,
    });
    if (error) return { ok: false, error: 'Could not submit the claim. Try again in a moment.' };
    const result = data as { ok: boolean; error?: string; ref?: string };
    if (!result?.ok) return { ok: false, error: errorText(result?.error) };
    claimRef = result.ref ?? '';
  } catch {
    return { ok: false, error: 'Could not reach the board. Check your connection and try again.' };
  }

  await sendOrQueue({
    to: user.email,
    mail: templates.claimReceived(claimRef, ref),
    eventType: 'claim_received',
    payload: { claimRef, itemTitle: ref },
    dedupeKey: `claim_received:${claimRef}`,
  });
  revalidatePath('/claims');
  redirect(`/claims/${claimRef}?new=1`);
}


export type PublicClaimState = {
  ok: boolean;
  step?: 'details' | 'verify';
  email?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  notice?: string;
};


/**
 * Claiming without an account.
 *
 * The answer is hashed at the moment it is given and parked in a draft, so the
 * plaintext never rests anywhere. The draft is addressed by a random token in an
 * http-only cookie, and it is only turned into a claim once the email is proved.
 */
export async function startPublicClaim(_prev: PublicClaimState, formData: FormData): Promise<PublicClaimState> {
  const ref = str(formData.get('ref'));
  const email = str(formData.get('email')).toLowerCase();
  const answer = clamp(str(formData.get('answer')), 200);
  const proof = clamp(str(formData.get('proof')), 1000);

  const fieldErrors: Record<string, string> = {};
  if (!isEmail(email)) fieldErrors.email = 'We need an address to send your code and your handover code to.';
  if (answer.length < 2) fieldErrors.answer = 'Answer the verification question.';
  if (!formData.get('truthful')) fieldErrors.truthful = 'Confirm this before submitting.';
  if (Object.keys(fieldErrors).length) return { ok: false, step: 'details', fieldErrors, error: 'Check the highlighted fields.' };

  const ip = await callerIp();

  try {
    const supabase = await supabaseServer();

    // Mailing a code is a paid, abusable action: throttle it exactly as sign-in
    // is throttled, before anything is sent.
    const authClient = supabaseAdmin() ?? supabase;
    const { data: throttle } = await authClient.rpc('check_signin_allowed', { p_email: email, p_ip: ip });
    const verdict = throttle as { allowed?: boolean; reason?: string } | null;
    if (verdict && verdict.allowed === false) {
      await authClient.rpc('log_auth_event', { p_kind: 'code_throttled', p_email: email, p_ip: ip });
      return {
        ok: false,
        step: 'details',
        error:
          verdict.reason === 'ip'
            ? 'Too many attempts from this connection. Wait fifteen minutes and try again.'
            : 'We have sent several codes to that address already. Wait a few minutes, then try again.',
      };
    }

    const { data, error } = await supabase.rpc('create_claim_draft', {
      p_ref: ref,
      p_email: email,
      p_answer: answer,
      p_proof: proof || null,
      p_ip: ip,
    });
    if (error) return { ok: false, step: 'details', error: 'Could not start the claim. Try again.' };

    const result = data as { ok: boolean; error?: string; token?: string };
    if (!result?.ok) return { ok: false, step: 'details', error: errorText(result?.error) };

    const store = await cookies();
    store.set('lnf-claim', result.token ?? '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 20,
    });

    await authClient.rpc('log_auth_event', { p_kind: 'code_requested', p_email: email, p_ip: ip });

    const issued = await issueSignInCode(email);
    if (!issued.ok) return { ok: false, step: 'details', error: issued.error };

    return {
      ok: true,
      step: 'verify',
      email,
      notice: `We sent a 6-digit code to ${email}. It proves the address and keeps your claim tied to you.`,
    };
  } catch {
    return { ok: false, step: 'details', error: 'Could not reach the board. Try again.' };
  }
}

export async function finishPublicClaim(_prev: PublicClaimState, formData: FormData): Promise<PublicClaimState> {
  const email = str(formData.get('email')).toLowerCase();
  const token = str(formData.get('token')).replace(/\s+/g, '');

  if (!/^\d{6}$/.test(token)) {
    return { ok: false, step: 'verify', email, error: 'Enter the 6-digit code from the email.' };
  }

  let claimRef = '';
  try {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) {
      await (supabaseAdmin() ?? supabase).rpc('log_auth_event', {
        p_kind: 'code_failed',
        p_email: email,
        p_ip: await callerIp(),
      });
      return { ok: false, step: 'verify', email, error: 'That code is wrong or has expired. Request a new one.' };
    }

    const store = await cookies();
    const draft = store.get('lnf-claim')?.value;
    if (!draft) return { ok: false, step: 'details', error: 'That claim session expired. Start again — it takes a moment.' };

    const { data, error: draftError } = await supabase.rpc('finalise_claim_draft', { p_token: draft });
    if (draftError) return { ok: false, step: 'verify', email, error: 'Could not finish the claim. Try again.' };

    const result = data as { ok: boolean; error?: string; ref?: string };
    if (!result?.ok) return { ok: false, step: 'details', error: errorText(result?.error) };

    claimRef = result.ref ?? '';
    store.delete('lnf-claim');
    await supabase.rpc('mark_email_verified');
    await (supabaseAdmin() ?? supabase).rpc('log_auth_event', {
      p_kind: 'code_verified',
      p_email: email,
      p_ip: await callerIp(),
    });
  } catch {
    return { ok: false, step: 'verify', email, error: 'Could not verify the code. Try again.' };
  }

  revalidatePath('/claims');
  redirect(`/claims/${claimRef}?new=1`);
}
