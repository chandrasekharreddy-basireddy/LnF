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
  const itemRef = str(formData.get('item_ref'));
  const decision = str(formData.get('decision'));
  const reason = clamp(str(formData.get('reason')), 300);
  if (decision === 'reject' && reason.length < 4) {
    return { ok: false, error: 'Write a short reason. The claimant sees it.' };
  }

  // Only the write decides the result. Everything after it — the email, the
  // cache refresh — must never turn a committed decision into "try again".
  let result: { ok: boolean; error?: string; status?: string };
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('staff_decide_claim', {
      p_claim_ref: claimRef,
      p_decision: decision,
      p_reason: reason || null,
    });
    if (error) return { ok: false, error: 'Could not record that decision.' };
    result = data as { ok: boolean; error?: string; status?: string };
  } catch {
    return { ok: false, error: 'Could not reach the desk. Try again.' };
  }

  if (!result?.ok) return { ok: false, error: errorText(result?.error) };

  if (decision !== 'review') {
    await notifyClaimant(claimRef, decision === 'approve', reason);
  }

  revalidatePath('/staff');
  if (itemRef) revalidatePath('/staff/items/' + itemRef);
  return { ok: true, message: decision === 'review' ? 'Moved to review.' : 'Decision recorded.' };
}

/** Best effort: a missing address or a refused email never fails the decision. */
async function notifyClaimant(claimRef: string, approved: boolean, reason: string): Promise<void> {
  try {
    const supabase = await supabaseServer();
    const { data: claim } = await supabase
      .from('claims')
      .select('claimant_id')
      .eq('ref_code', claimRef)
      .maybeSingle();
    const claimantId = (claim as { claimant_id?: string } | null)?.claimant_id;
    if (!claimantId) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', claimantId)
      .maybeSingle();
    const email = (profile as { email?: string } | null)?.email;
    if (!email) return;

    await sendOrQueue({
      to: email,
      mail: templates.claimDecided(claimRef, approved, reason || null),
      eventType: 'claim_decided',
      payload: { claimRef, approved, reason },
      dedupeKey: `claim_decided:${claimRef}`,
    });
  } catch {
    // the decision stands; the in-app notification is already written by the RPC
  }
}

export async function confirmHandover(_prev: StaffState, formData: FormData): Promise<StaffState> {
  const user = await currentUser();
  if (!isStaff(user)) return { ok: false, error: 'Staff access only.' };

  const itemRef = str(formData.get('item_ref'));
  const code = str(formData.get('code')).toUpperCase();
  const note = clamp(str(formData.get('note')), 300);
  const witness = str(formData.get('witness')) || null;

  let result: { ok: boolean; error?: string };
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('staff_confirm_handover', {
      p_item_ref: itemRef,
      p_code: code || null,
      p_note: note || null,
      p_witness: witness,
    });
    if (error) return { ok: false, error: 'Could not confirm the handover.' };
    result = data as { ok: boolean; error?: string };
  } catch {
    return { ok: false, error: 'Could not reach the desk. Try again.' };
  }

  if (!result?.ok) return { ok: false, error: errorText(result?.error) };

  await thankFinder(itemRef);

  revalidatePath('/staff');
  revalidatePath('/staff/items/' + itemRef);
  return { ok: true, message: 'Handover recorded. Item marked as returned.' };
}

/** Best effort, same rule as the decision email. */
async function thankFinder(itemRef: string): Promise<void> {
  try {
    const supabase = await supabaseServer();
    const { data: item } = await supabase
      .from('items')
      .select('title, contact_email, finder_email')
      .eq('ref_code', itemRef)
      .maybeSingle();
    const row = item as { finder_email?: string; contact_email?: string; title?: string } | null;
    const to = row?.finder_email || row?.contact_email;
    if (!to || !row?.title) return;

    await sendOrQueue({
      to,
      mail: templates.finderThanks(itemRef, row.title),
      eventType: 'finder_thanks',
      payload: { ref: itemRef, title: row.title },
      dedupeKey: `finder_thanks:${itemRef}`,
    });
  } catch {
    // the handover stands
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
    // a first-time reporter's listing goes live silently otherwise
    if (status === 'available') {
      await notifyListingPublished(itemRef);
    }

    revalidatePath('/staff');
    revalidatePath('/staff/items/' + itemRef);
    revalidatePath('/browse');
    return { ok: true, message: 'Listing updated.' };
  } catch {
    return { ok: false, error: 'Could not reach the desk. Try again.' };
  }
}

export async function disposeItem(_prev: StaffState, formData: FormData): Promise<StaffState> {
  const user = await currentUser();
  if (!isStaff(user)) return { ok: false, error: 'Staff access only.' };

  const itemRef = str(formData.get('item_ref'));
  const disposition = str(formData.get('disposition'));
  const note = clamp(str(formData.get('note')), 300);

  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('dispose_item', {
      p_ref: itemRef,
      p_disposition: disposition,
      p_note: note,
    });
    if (error) return { ok: false, error: 'Could not record that disposition.' };
    const result = data as { ok: boolean; error?: string };
    if (!result?.ok) return { ok: false, error: errorText(result?.error) };

    revalidatePath('/staff/disposal');
    revalidatePath('/staff');
    return { ok: true, message: 'Recorded. It is in the audit log.' };
  } catch {
    return { ok: false, error: 'Could not reach the desk.' };
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
    revalidatePath('/staff');
    return { ok: true, message: 'Report closed.' };
  } catch {
    return { ok: false, error: 'Could not reach the desk.' };
  }
}

/** Best effort: tell the reporter their pending listing is on the board now. */
async function notifyListingPublished(itemRef: string): Promise<void> {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase
      .from('items')
      .select('title, type, contact_email, finder_email')
      .eq('ref_code', itemRef)
      .maybeSingle();

    const row = data as { title?: string; type?: 'lost' | 'found'; contact_email?: string | null; finder_email?: string | null } | null;
    const to = row?.contact_email || row?.finder_email;
    if (!to) return;

    await sendOrQueue({
      to,
      mail: templates.itemPublished(itemRef, row?.title ?? 'Your item', row?.type === 'lost' ? 'lost' : 'found'),
      eventType: 'item_published',
      payload: { ref: itemRef, title: row?.title ?? 'Your item', kind: row?.type === 'lost' ? 'lost' : 'found' },
      dedupeKey: `item_published:${itemRef}`,
    });
  } catch {
    // the status change stands even if the notice cannot be sent
  }
}
