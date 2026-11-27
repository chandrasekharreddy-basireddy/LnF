import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual as equal } from 'node:crypto';
import { env } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase-server';
import { renderOutboxMail, sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Compares two strings without leaking their length or prefix through timing. */
function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    // still compare something of equal length so the branch is not the only signal
    equal(left, left);
    return false;
  }
  return equal(left, right);
}

type OutboxRow = {
  id: string;
  dedupeKey: string;
  eventType: string;
  to: string;
  payload: Record<string, unknown>;
  attempts: number;
};

type EmailSummary = { attempted: number; sent: number; failed: number; note?: string };

type StorageSummary = { attempted: number; deleted: number; failed: number; note?: string };

/**
 * Deletes the photos housekeeping queued. The queue is written in the same
 * transaction as the row delete, so a Storage failure never loses the path —
 * it stays queued with its error and is retried tomorrow.
 */
async function drainStorageQueue(admin: NonNullable<ReturnType<typeof supabaseAdmin>>): Promise<StorageSummary> {
  const summary: StorageSummary = { attempted: 0, deleted: 0, failed: 0 };

  const { data, error } = await admin
    .from('storage_deletion_queue')
    .select('id, storage_path, attempts')
    .lt('attempts', 5)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) return { ...summary, note: error.message };

  for (const row of (data ?? []) as { id: string; storage_path: string; attempts: number }[]) {
    summary.attempted += 1;
    const { error: removeError } = await admin.storage.from('item-photos').remove([row.storage_path]);

    if (removeError) {
      summary.failed += 1;
      await admin
        .from('storage_deletion_queue')
        .update({ attempts: row.attempts + 1, last_error: removeError.message.slice(0, 500) })
        .eq('id', row.id);
      continue;
    }

    summary.deleted += 1;
    await admin.from('storage_deletion_queue').delete().eq('id', row.id);
  }

  return summary;
}

/** Retries queued mail. Runs after housekeeping so a stuck message still ages out. */
async function dispatchOutbox(admin: NonNullable<ReturnType<typeof supabaseAdmin>>): Promise<EmailSummary> {
  const summary: EmailSummary = { attempted: 0, sent: 0, failed: 0 };

  const { data, error } = await admin.rpc('claim_email_batch', { p_limit: 25 });
  if (error) return { ...summary, note: error.message };

  const rows = (data ?? []) as OutboxRow[];
  for (const row of rows) {
    summary.attempted += 1;
    const mail = renderOutboxMail(row.eventType, row.payload);
    if (!mail) {
      await admin.rpc('finish_email', { p_id: row.id, p_ok: false, p_error: `unknown event ${row.eventType}` });
      summary.failed += 1;
      continue;
    }
    const result = await sendEmail({ to: row.to, ...mail });
    await admin.rpc('finish_email', {
      p_id: row.id,
      p_ok: result.ok,
      p_error: result.ok ? null : `brevo status ${result.status ?? 'unreachable'}`,
    });
    if (result.ok) summary.sent += 1;
    else summary.failed += 1;
  }

  return summary;
}

type Summary = {
  expired?: number;
  purged?: number;
  photoPaths?: string[];
  notificationsDeleted?: number;
  auditDeleted?: number;
  reportsDeleted?: number;
  outboxDeleted?: number;
};

/**
 * Daily maintenance: expire listings, enforce retention, nudge reporters, and
 * delete the photos of purged listings. Requires the service-role key; without
 * it the database-side job (see docs/deployment.md) still runs.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  const expected = env.cronSecret ? `Bearer ${env.cronSecret}` : '';

  if (!expected || !timingSafeEqual(auth, expected)) {
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
  const email = await dispatchOutbox(admin);
  const storage = await drainStorageQueue(admin);
  const paths = summary.photoPaths ?? [];
  let photosDeleted = 0;

  if (paths.length) {
    const { error: storageError } = await admin.storage.from('item-photos').remove(paths);
    if (!storageError) photosDeleted = paths.length;
  }

  const degraded = (storage.failed ?? 0) > 0 || (email.failed ?? 0) > 0;

  return NextResponse.json(
    {
      ok: !degraded,
      expired: summary.expired ?? 0,
      purged: summary.purged ?? 0,
      photosDeleted,
      notificationsDeleted: summary.notificationsDeleted ?? 0,
      auditDeleted: summary.auditDeleted ?? 0,
      reportsDeleted: summary.reportsDeleted ?? 0,
      outboxDeleted: summary.outboxDeleted ?? 0,
      email,
      storage,
      at: new Date().toISOString(),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
