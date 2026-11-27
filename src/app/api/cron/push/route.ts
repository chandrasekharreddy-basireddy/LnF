import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase-server';
import { pushPayload, summariseDelivery, vapidConfig } from '@/lib/push';
import { sendPushBatch, type PushTarget } from '@/lib/push-send';
import { timingSafeEqualString } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type PushBatch = {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  attempts: number;
  subscriptions: PushTarget[];
};

/**
 * Delivers queued notifications as web push. Bearer-guarded like the
 * housekeeping cron, and service-role only: `claim_push_batch()` and
 * `finish_push()` are granted to `service_role` alone, because they hand out
 * the endpoint and keys of other people's devices.
 *
 * It refuses with a named reason rather than pretending: no VAPID keys, no
 * service key, or a database error all come back as a non-200 with the reason.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  const expected = env.cronSecret ? `Bearer ${env.cronSecret}` : '';
  if (!expected || !timingSafeEqualString(auth, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const vapid = vapidConfig({
    publicKey: env.vapidPublicKey,
    privateKey: env.vapidPrivateKey,
    subject: env.vapidSubject,
  });
  if (!vapid.ok) {
    return NextResponse.json({ error: 'push is not configured', reason: vapid.reason }, { status: 503 });
  }

  const admin = supabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set, so nothing can be claimed.' }, { status: 503 });
  }

  const { data, error } = await admin.rpc('claim_push_batch', { p_limit: 20 });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const batches = (Array.isArray(data) ? data : []) as PushBatch[];
  const summary = { claimed: batches.length, sent: 0, failed: 0, skipped: 0, devices: 0, dropped: 0 };

  for (const batch of batches) {
    const targets = Array.isArray(batch.subscriptions) ? batch.subscriptions : [];
    const payload = pushPayload({
      id: batch.id,
      kind: batch.kind,
      title: batch.title,
      body: batch.body,
      link: batch.link,
    });

    const results = targets.length ? await sendPushBatch(targets, payload, vapid) : [];
    const status = summariseDelivery(results);
    const gone = results.filter((r) => r.gone).map((r) => r.endpoint);

    const finished = await admin.rpc('finish_push', {
      p_id: batch.id,
      p_status: status,
      p_drop_endpoints: gone,
    });
    const dropped = Number((finished.data as { dropped?: number } | null)?.dropped ?? 0);

    summary.devices += results.length;
    summary.dropped += dropped;
    if (status === 'sent') summary.sent += 1;
    else if (status === 'failed') summary.failed += 1;
    else summary.skipped += 1;
  }

  return NextResponse.json(
    { ok: summary.failed === 0, ...summary, at: new Date().toISOString() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
