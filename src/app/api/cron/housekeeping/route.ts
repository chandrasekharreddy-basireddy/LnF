import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Summary = {
  expired?: number;
  purged?: number;
  photoPaths?: string[];
  notificationsDeleted?: number;
  auditDeleted?: number;
  reportsDeleted?: number;
};

/**
 * Daily maintenance: expire listings, enforce retention, nudge reporters, and
 * delete the photos of purged listings. Requires the service-role key; without
 * it the database-side job (see docs/deployment.md) still runs.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  const expected = env.cronSecret ? `Bearer ${env.cronSecret}` : '';

  if (!expected || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = supabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY is not set, so photo cleanup cannot run.' },
      { status: 503 },
    );
  }

  const { data, error } = await admin.rpc('housekeeping');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const summary = (data ?? {}) as Summary;
  const paths = summary.photoPaths ?? [];
  let photosDeleted = 0;

  if (paths.length) {
    const { error: storageError } = await admin.storage.from('item-photos').remove(paths);
    if (!storageError) photosDeleted = paths.length;
  }

  return NextResponse.json(
    {
      ok: true,
      expired: summary.expired ?? 0,
      purged: summary.purged ?? 0,
      photosDeleted,
      notificationsDeleted: summary.notificationsDeleted ?? 0,
      auditDeleted: summary.auditDeleted ?? 0,
      reportsDeleted: summary.reportsDeleted ?? 0,
      at: new Date().toISOString(),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
