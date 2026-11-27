'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { currentUser, isStaff } from '@/lib/data';
import { errorText } from '@/lib/copy';
import { clamp, str } from '@/lib/validation';

export type ImportState = {
  ok: boolean;
  error?: string;
  message?: string;
  imported?: number;
  skipped?: { row: number; title?: string; reason: string }[];
  refs?: string[];
};

export async function importRows(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const user = await currentUser();
  if (!isStaff(user)) return { ok: false, error: 'Staff access only.' };

  const raw = str(formData.get('rows'));
  const note = clamp(str(formData.get('note')), 200);
  if (!raw) return { ok: false, error: 'Nothing to import. Paste the spreadsheet first.' };

  let rows: unknown;
  try {
    rows = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'That could not be read as rows. Re-paste the sheet and try again.' };
  }
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: 'No rows found.' };
  if (rows.length > 500) return { ok: false, error: 'Import 500 rows at a time. Split the sheet.' };

  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('bulk_import_items', {
      p_rows: rows,
      p_note: note || null,
    });
    if (error) return { ok: false, error: 'The import did not run. Nothing was saved.' };

    const result = data as {
      ok: boolean;
      error?: string;
      imported?: number;
      skipped?: ImportState['skipped'];
      refs?: string[];
    };
    if (!result?.ok) return { ok: false, error: errorText(result?.error) };

    revalidatePath('/browse');
    revalidatePath('/staff');
    revalidatePath('/');

    const imported = result.imported ?? 0;
    const skipped = result.skipped ?? [];
    return {
      ok: true,
      imported,
      skipped,
      refs: result.refs ?? [],
      message:
        skipped.length === 0
          ? `${imported} listings added to the board.`
          : `${imported} added, ${skipped.length} skipped — see the list below.`,
    };
  } catch {
    return { ok: false, error: 'Could not reach the database. Nothing was saved.' };
  }
}
