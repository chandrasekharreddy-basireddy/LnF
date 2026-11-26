'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { currentUser } from '@/lib/data';
import { errorText } from '@/lib/copy';
import { clamp, str } from '@/lib/validation';
import { sendEmail, templates } from '@/lib/email';

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

  if (user.email) {
    const mail = templates.claimReceived(claimRef, ref);
    await sendEmail({ to: user.email, ...mail });
  }
  revalidatePath('/claims');
  redirect(`/claims/${claimRef}?new=1`);
}
