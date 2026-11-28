'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { currentUser } from '@/lib/data';
import { errorText } from '@/lib/copy';
import { scanText } from '@/lib/antifraud';
import { clamp, str } from '@/lib/validation';
import { noteProblem, reasonProblem } from '@/lib/trust';

export type DisputeState = { ok: boolean; error?: string; fieldErrors?: Record<string, string> };

/**
 * Opening a dispute.
 *
 * The page checks the window and the length before the round trip (src/lib/trust.ts);
 * this action repeats the length check and the payment/contact scan so the person
 * gets a sentence, and the database enforces all of it again because a server
 * action is a public endpoint.
 */
export async function openDispute(_prev: DisputeState, formData: FormData): Promise<DisputeState> {
  const user = await currentUser();
  if (!user) return { ok: false, error: 'Sign in first so the desk can reach you about this.' };

  const claimRef = str(formData.get('claim_ref'));
  const reason = clamp(str(formData.get('reason')), 2000);

  const problem = reasonProblem(reason);
  if (problem) return { ok: false, error: errorText(problem), fieldErrors: { reason: errorText(problem) } };

  const scan = scanText(reason);
  if (scan.blocked) {
    return { ok: false, error: `${errorText('BLOCKED')} ${scan.flags[0].reason}.` };
  }

  let disputeRef = '';
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('open_dispute', {
      p_claim_ref: claimRef,
      p_reason: reason,
    });
    if (error) return { ok: false, error: 'Could not open the dispute. Try again in a moment.' };

    const result = data as { ok: boolean; error?: string; reason?: string; ref?: string };
    if (!result?.ok) {
      if (result?.error === 'BLOCKED') {
        return { ok: false, error: `${errorText('BLOCKED')} ${result.reason ?? ''}`.trim() };
      }
      return { ok: false, error: errorText(result?.error) };
    }
    disputeRef = result.ref ?? '';
  } catch {
    return { ok: false, error: 'Could not reach the board. Check your connection and try again.' };
  }

  revalidatePath('/disputes');
  revalidatePath(`/claims/${claimRef}`);
  revalidatePath('/staff/disputes');
  redirect(`/disputes/${disputeRef}`);
}

/** The opener drops their own dispute. The database checks that it is theirs and still open. */
export async function withdrawDispute(_prev: DisputeState, formData: FormData): Promise<DisputeState> {
  const user = await currentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };

  const disputeRef = str(formData.get('dispute_ref'));

  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('withdraw_dispute', { p_dispute_ref: disputeRef });
    if (error) return { ok: false, error: 'Could not withdraw it. Try again in a moment.' };

    const result = data as { ok: boolean; error?: string };
    if (!result?.ok) return { ok: false, error: errorText(result?.error) };

    revalidatePath('/disputes');
    revalidatePath(`/disputes/${disputeRef}`);
    revalidatePath('/staff/disputes');
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach the board. Check your connection and try again.' };
  }
}

/**
 * Staff uphold or dismiss. The note is required by the database too: an outcome
 * without a reason is exactly the thing a dispute exists to prevent.
 */
export async function decideDispute(_prev: DisputeState, formData: FormData): Promise<DisputeState> {
  const user = await currentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };

  const disputeRef = str(formData.get('dispute_ref'));
  const decision = str(formData.get('decision'));
  const note = clamp(str(formData.get('note')), 2000);

  if (decision !== 'upheld' && decision !== 'dismissed') {
    return { ok: false, error: errorText('BAD_DECISION') };
  }
  const problem = noteProblem(note);
  if (problem) return { ok: false, error: errorText(problem), fieldErrors: { note: errorText(problem) } };

  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('decide_dispute', {
      p_dispute_ref: disputeRef,
      p_decision: decision,
      p_note: note,
    });
    if (error) return { ok: false, error: 'Could not record the decision. Try again in a moment.' };

    const result = data as { ok: boolean; error?: string; status?: string; reopened?: boolean };
    if (!result?.ok) return { ok: false, error: errorText(result?.error) };

    revalidatePath('/staff/disputes');
    revalidatePath(`/disputes/${disputeRef}`);
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach the board. Check your connection and try again.' };
  }
}
