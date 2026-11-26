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
      outboxDeleted: summary.outboxDeleted ?? 0,
      email,
      at: new Date().toISOString(),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
