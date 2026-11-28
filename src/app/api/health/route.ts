import { NextResponse } from 'next/server';
import { boardStats } from '@/lib/data';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function GET() {
  const started = Date.now();

  // a deployment with no Supabase configuration looks identical to an empty
  // board from the outside; say which it is
  const configured = Boolean(env.supabaseUrl && env.supabaseAnonKey);
  const stats = configured ? await boardStats() : null;
  const dbOk = stats !== null;

  return NextResponse.json(
    {
      status: dbOk ? 'ok' : 'degraded',
      service: 'lnf',
      build: env.buildStamp,
      database: dbOk ? 'reachable' : 'unreachable',
      configured: configured ? 'yes' : 'no',
      ...(configured
        ? {}
        : { hint: 'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not set for this build.' }),
      ms: Date.now() - started,
      time: new Date().toISOString(),
    },
    { status: dbOk ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
