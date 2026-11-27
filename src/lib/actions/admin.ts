'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { currentUser, isAdmin, isStaff } from '@/lib/data';
import { errorText } from '@/lib/copy';
import { bool, clamp, str } from '@/lib/validation';

export type AdminState = { ok: boolean; error?: string; message?: string };

export async function setRole(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const user = await currentUser();
  if (!isAdmin(user)) return { ok: false, error: 'Admin access only.' };

  const email = str(formData.get('email')).toLowerCase();
  const role = str(formData.get('role'));
  const grant = bool(formData.get('grant'));
  if (!email) return { ok: false, error: 'Enter the account email.' };

  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('admin_set_role', {
      p_email: email,
      p_role: role,
      p_grant: grant,
    });
    if (error) return { ok: false, error: 'Could not change that role.' };
    const result = data as { ok: boolean; error?: string };
    if (!result?.ok) return { ok: false, error: errorText(result?.error) };
    revalidatePath('/admin/users');
    return { ok: true, message: grant ? `${role} granted to ${email}.` : `${role} removed from ${email}.` };
  } catch {
    return { ok: false, error: 'Could not reach the database.' };
  }
}

export async function recordReview(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const user = await currentUser();
  if (!isStaff(user)) return { ok: false, error: 'Staff access only.' };

  const notes = clamp(str(formData.get('notes')), 1000);
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('record_weekly_review', { p_notes: notes || null });
    if (error) return { ok: false, error: 'Could not record the review.' };
    const result = data as { ok: boolean; week?: string; error?: string };
    if (!result?.ok) return { ok: false, error: errorText(result?.error) };
    revalidatePath('/admin');
    return { ok: true, message: `Recorded for the week of ${result.week ?? 'this week'}.` };
  } catch {
    return { ok: false, error: 'Could not reach the database.' };
  }
}

export async function purgeSamples(_prev: AdminState): Promise<AdminState> {
  const user = await currentUser();
  if (!isAdmin(user)) return { ok: false, error: 'Admin access only.' };
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('admin_purge_samples');
    if (error) return { ok: false, error: 'Could not remove the sample rows.' };
    const result = data as { ok: boolean; deleted?: number; error?: string };
    if (!result?.ok) return { ok: false, error: errorText(result?.error) };
    revalidatePath('/');
    revalidatePath('/browse');
    revalidatePath('/admin');
    return { ok: true, message: `${result.deleted ?? 0} sample listings removed.` };
  } catch {
    return { ok: false, error: 'Could not reach the database.' };
  }
}
