'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin, supabaseServer } from '@/lib/supabase-server';
import { currentUser, isAdmin, isStaff } from '@/lib/data';
import { errorText } from '@/lib/copy';
import { bool, clamp, str } from '@/lib/validation';
import { sendOrQueue, templates } from '@/lib/email';

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

/**
 * Erasure, end to end. The database function scrubs the person's presence in
 * every table and hands back the photo paths it queued; this deletes those
 * objects, then the Auth row (which still holds the address), then confirms by
 * email — before the profile is anonymised, so the address is captured first.
 *
 * The Auth deletion needs the service-role key. Without it the records are still
 * scrubbed and the action says plainly what is left, rather than claiming a
 * completed erasure it did not perform.
 */
export async function eraseUser(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const user = await currentUser();
  if (!isAdmin(user)) return { ok: false, error: 'Admin access only.' };

  const targetId = str(formData.get('user_id'));
  const targetEmail = str(formData.get('email')).toLowerCase();
  if (!targetId) return { ok: false, error: 'Missing user id.' };
  if (targetId === user?.id) return { ok: false, error: 'You cannot erase your own admin account here.' };
  if (formData.get('confirm') !== 'on') return { ok: false, error: 'Tick the confirmation box first.' };

  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('admin_erase_user_data', { p_user_id: targetId });
    if (error) return { ok: false, error: 'Could not scrub the records. Nothing was deleted.' };

    const result = data as { ok: boolean; error?: string; email?: string | null; photoPaths?: string[] };
    if (!result?.ok) return { ok: false, error: errorText(result?.error) };

    const paths = result.photoPaths ?? [];
    let storageNote = '';
    const admin = supabaseAdmin();

    if (paths.length && admin) {
      const { error: storageError } = await admin.storage.from('item-photos').remove(paths);
      if (storageError) {
        storageNote = ' Photos are queued and will be removed by the nightly job.';
      } else {
        await admin.from('storage_deletion_queue').delete().in('storage_path', paths);
      }
    } else if (paths.length) {
      storageNote = ' Photos are queued; the nightly job removes them.';
    }

    let authNote = '';
    if (admin) {
      const { error: authError } = await admin.auth.admin.deleteUser(targetId);
      if (authError) {
        authNote = ' The Auth account could not be deleted — retry from the Supabase dashboard.';
      }
    } else {
      authNote = ' SUPABASE_SERVICE_ROLE_KEY is not set, so the Auth account still exists.';
    }

    const confirmEmail = (result.email ?? targetEmail).trim().toLowerCase();
    if (confirmEmail) {
      await sendOrQueue({
        to: confirmEmail,
        mail: templates.erasureConfirmed(confirmEmail),
        eventType: 'erasure_confirmed',
        payload: { email: confirmEmail },
        dedupeKey: `erasure_confirmed:${targetId}`,
      });
    }

    revalidatePath('/admin/users');
    revalidatePath('/admin');
    return { ok: true, message: `Records erased.${storageNote}${authNote}` };
  } catch {
    return { ok: false, error: 'Could not complete the erasure. Try again.' };
  }
}
