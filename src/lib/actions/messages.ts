'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { currentUser } from '@/lib/data';
import { errorText } from '@/lib/copy';
import { scanText } from '@/lib/antifraud';
import { str } from '@/lib/validation';

export type MessageState = { ok: boolean; error?: string; message?: string };

export async function postMessage(_prev: MessageState, formData: FormData): Promise<MessageState> {
  const user = await currentUser();
  if (!user) return { ok: false, error: 'Sign in to reply.' };

  const claimRef = str(formData.get('claim_ref'));
  const body = str(formData.get('body'));
  const backTo = str(formData.get('back_to')) || `/claims/${claimRef}`;

  if (body.length < 1) return { ok: false, error: errorText('EMPTY') };
  if (body.length > 2000) return { ok: false, error: errorText('TOO_LONG') };

  // Explain the block before spending a round trip; the database still enforces it.
  const scan = scanText(body);
  if (scan.blocked) {
    return { ok: false, error: `${errorText('BLOCKED')} ${scan.flags[0].reason}.` };
  }

  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('post_claim_message', {
      p_claim_ref: claimRef,
      p_body: body,
    });
    if (error) return { ok: false, error: 'Could not send that message. Try again.' };

    const result = data as { ok: boolean; error?: string; reason?: string };
    if (!result?.ok) {
      if (result?.error === 'BLOCKED') {
        return { ok: false, error: `${errorText('BLOCKED')} ${result.reason ?? ''}`.trim() };
      }
      return { ok: false, error: errorText(result?.error) };
    }

    revalidatePath(backTo);
    revalidatePath(`/claims/${claimRef}`);
    return { ok: true, message: 'Sent. It stays on the board.' };
  } catch {
    return { ok: false, error: 'Could not reach the board. Try again.' };
  }
}
