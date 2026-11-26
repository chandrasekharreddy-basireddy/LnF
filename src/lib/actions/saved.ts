'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { currentUser } from '@/lib/data';
import { errorText } from '@/lib/copy';
import { clamp, str } from '@/lib/validation';

export type SavedState = { ok: boolean; error?: string; message?: string; saved?: boolean };

export async function toggleSavedItem(_prev: SavedState, formData: FormData): Promise<SavedState> {
  const user = await currentUser();
  if (!user) return { ok: false, error: 'Sign in to save an item.' };

  const ref = str(formData.get('ref'));
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('toggle_saved_item', { p_ref: ref });
    if (error) return { ok: false, error: 'Could not save that item.' };
    const result = data as { ok: boolean; saved?: boolean; error?: string };
    if (!result?.ok) return { ok: false, error: errorText(result?.error) };

    revalidatePath(`/items/${ref}`);
    revalidatePath('/account/saved');
    return { ok: true, saved: result.saved, message: result.saved ? 'Saved.' : 'Removed from saved.' };
  } catch {
    return { ok: false, error: 'Could not reach the board.' };
  }
}

export async function createSavedSearch(_prev: SavedState, formData: FormData): Promise<SavedState> {
  const user = await currentUser();
  if (!user) return { ok: false, error: 'Sign in to save a search.' };

  const label = clamp(str(formData.get('label')), 60);
  if (label.length < 2) return { ok: false, error: 'Give the search a name, for example "blue bottles".' };

  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('save_search', {
      p_label: label,
      p_query: clamp(str(formData.get('q')), 120) || null,
      p_type: str(formData.get('type')) || null,
      p_category: str(formData.get('category')) || null,
      p_zone: str(formData.get('zone')) || null,
    });
    if (error) return { ok: false, error: 'Could not save that search.' };
    const result = data as { ok: boolean; error?: string };
    if (!result?.ok) return { ok: false, error: errorText(result?.error) };

    revalidatePath('/account/saved');
    return { ok: true, message: 'Saved. One email-free notification when something matches.' };
  } catch {
    return { ok: false, error: 'Could not reach the board.' };
  }
}

export async function deleteSavedSearch(_prev: SavedState, formData: FormData): Promise<SavedState> {
  const user = await currentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };

  const id = str(formData.get('id'));
  try {
    const supabase = await supabaseServer();
    const { error } = await supabase.rpc('delete_saved_search', { p_id: id });
    if (error) return { ok: false, error: 'Could not remove that search.' };
    revalidatePath('/account/saved');
    return { ok: true, message: 'Removed.' };
  } catch {
    return { ok: false, error: 'Could not reach the board.' };
  }
}
