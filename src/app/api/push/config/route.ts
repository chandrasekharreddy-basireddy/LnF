import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { vapidConfig } from '@/lib/push';

export const dynamic = 'force-dynamic';

/**
 * Public and safe by design: it answers one question — can this deployment
 * send push? — and returns the VAPID *public* key, which is public by
 * definition (the browser needs it to subscribe). The private key and the
 * reason a deployment is unconfigured never leave the server.
 */
export async function GET() {
  const config = vapidConfig({
    publicKey: env.vapidPublicKey,
    privateKey: env.vapidPrivateKey,
    subject: env.vapidSubject,
  });

  return NextResponse.json(
    { enabled: config.ok, publicKey: config.ok ? config.publicKey : null },
    { headers: { 'cache-control': 'no-store' } },
  );
}
