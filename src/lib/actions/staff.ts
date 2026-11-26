'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { currentUser, isStaff } from '@/lib/data';
import { errorText } from '@/lib/copy';
import { clamp, str } from '@/lib/validation';
import { sendOrQueue, templates } from '@/lib/email';

export type StaffState = { ok: boolean; error?: string; message?: string };

export async function decideClaim(_prev: StaffState, formData: FormData): Promise<StaffState> {
  const user = await currentUser();
  if (!isStaff(user)) return { ok: false, error: 'Staff access only.' };

  const claimRef = str(formData.get('claim_ref'));
  const decision = str(formData.get('decision'));
  const reason = clamp(str(formData.get('reason')), 300);
  if (decision === 'reject' && reason.length < 4) {
    return { ok: false, error: 'Write a short reason. The claimant sees it.' };
  }

  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('staff_decide_claim', {
      p_claim_ref: claimRef,
      p_decision: decision,
      p_reason: reason || null,
    });
    if (error) return { ok: false, error: 'Could not record that decision.' };
    const result = data as { ok: boolean; error?: string; status?: string };
    if (!result?.ok) return { ok: false, error: errorText(result?.error) };

    if (decision !== 'review') {
      const { data: claim } = await supabase
        .from('claims')
        .select('claimant_id, ref_code, items(title)')
        .eq('ref_code', claimRef)
        .maybeSingle();
      const claimantId = (claim as { claimant_id?: string } | null)?.claimant_id;
      if (claimantId) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('email')
          .eq('id', claimantId)
          .maybeSingle();
        const email = (profile as { email?: string } | null)?.email;
        if (email) {
          await sendOrQueue({
            to: email,
            mail: templates.claimDecided(claimRef, decision === 'approve', reason || null),
            eventType: 'claim_decided',
            payload: { claimRef, approved: decision === 'approve', reason: reason || '' },
            dedupeKey: `claim_decided:${claimRef}`,
          });
        }
      }
    }

    revalidatePath('/staff');
    revalidatePath('/staff/items/' + str(formData.get('item_ref')));
    return { ok: true, message: decision === 'review' ? 'Moved to review.' : 'Decision recorded.' };
  } catch {
    return { ok: false, error: 'Could not reach the desk. Try again.' };
  }
}

export async function confirmHandover(_prev: StaffState, formData: FormData): Promise<StaffState> {
  const user = await currentUser();
  if (!isStaff(user)) return { ok: false, error: 'Staff access only.' };

  const itemRef = str(formData.get('item_ref'));
  const code = str(formData.get('code')).toUpperCase();
  const note = clamp(str(formData.get('note')), 300);

  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('staff_confirm_handover', {
      p_item_ref: itemRef,
      p_code: code || null,
      p_note: note || null,
    });
    if (error) return { ok: false, error: 'Could not confirm the handover.' };
    const result = data as { ok: boolean; error?: string };
    if (!result?.ok) return { ok: false, error: errorText(result?.error) };

    const { data: item } = await supabase
      .from('items')
      .select('title, contact_email, finder_email')
      .eq('ref_code', itemRef)
      .maybeSingle();
    const finderEmail = (item as { finder_email?: string; contact_email?: string; title?: string } | null);
    const to = finderEmail?.finder_email || finderEmail?.contact_email;
    if (to && finderEmail?.title) {
      await sendOrQueue({
        to,
        mail: templates.finderThanks(itemRef, finderEmail.title),
        eventType: 'finder_thanks',
        payload: { ref: itemRef, title: finderEmail.title },
        dedupeKey: `finder_thanks:${itemRef}`,
      });
    }

    revalidatePath('/staff');
    revalidatePath('/staff/items/' + itemRef);
    return { ok: true, message: 'Handover recorded. Item marked as returned.' };
  } catch {
    return { ok: false, error: 'Could not reach the desk. Try again.' };
  }
}

export async function setItemStatus(_prev: StaffState, formData: FormData): Promise<StaffState> {
  const user = await currentUser();
  if (!isStaff(user)) return { ok: false, error: 'Staff access only.' };

  const itemRef = str(formData.get('item_ref'));
  const status = str(formData.get('status'));
  const note = clamp(str(formData.get('note')), 300);

  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('staff_update_item', {
      p_ref: itemRef,
      p_status: status,
      p_note: note || null,
    });
    if (error) return { ok: false, error: 'Could not change that listing.' };
    const result = data as { ok: boolean; error?: string };
    if (!result?.ok) return { ok: false, error: errorText(result?.error) };
    revalidatePath('/staff');
    revalidatePath('/staff/items/' + itemRef);
    revalidatePath('/browse');
    return { ok: true, message: 'Listing updated.' };
  } catch {
    return { ok: false, error: 'Could not reach the desk. Try again.' };
  }
}

export async function closeReport(_prev: StaffState, formData: FormData): Promise<StaffState> {
  const user = await currentUser();
  if (!isStaff(user)) return { ok: false, error: 'Staff access only.' };
  const id = str(formData.get('report_id'));
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('admin_close_report', { p_id: id });
    if (error) return { ok: false, error: 'Could not close that report.' };
    const result = data as { ok: boolean; error?: string };
    if (!result?.ok) return { ok: false, error: errorText(result?.error) };
    revalidatePath('/admin');
    return { ok: true, message: 'Report closed.' };
  } catch {
    return { ok: false, error: 'Could not reach the desk.' };
  }
}
