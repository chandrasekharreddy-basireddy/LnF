'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { currentUser } from '@/lib/data';
import { clamp, str } from '@/lib/validation';

export type AccountState = { ok: boolean; error?: string; message?: string };

export async function saveProfile(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const user = await currentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };

  const name = clamp(str(formData.get('full_name')), 120);
  const phone = clamp(str(formData.get('phone')), 20);
  const alerts = formData.get('alerts') === 'on';
  const marketing = formData.get('marketing') === 'on';

  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from('profiles')
      .update({ full_name: name || null, phone: phone || null, alerts_opt_in: alerts, marketing_opt_in: marketing })
      .eq('id', user.id)
      .select('id');
    if (error) return { ok: false, error: 'Could not save your details.' };
    // an update that matched no row is a failure, not a silent success
    if (!data || data.length === 0) {
      return { ok: false, error: 'Your profile could not be found. Sign out and in again.' };
    }
    revalidatePath('/account');
    return { ok: true, message: 'Saved.' };
  } catch {
    return { ok: false, error: 'Could not reach the database.' };
  }
}

export async function requestDeletion(_prev: AccountState): Promise<AccountState> {
  const user = await currentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  try {
    const supabase = await supabaseServer();
    const { error } = await supabase.from('abuse_reports').insert({
      item_id: null,
      reporter_id: user.id,
      reporter_email: user.email,
      reason: 'account_deletion',
      details: 'Data subject requested erasure of their account and records.',
    });
    if (error) return { ok: false, error: 'Could not file the request. Email the desk instead.' };
    return { ok: true, message: 'Request filed. The desk deletes your account and records within 7 days.' };
  } catch {
    return { ok: false, error: 'Could not reach the database.' };
  }
}
