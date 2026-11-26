import { NextResponse } from 'next/server';
import { boardStats } from '@/lib/data';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function GET() {
  const started = Date.now();
  const stats = await boardStats();
  const dbOk = stats !== null;

  return NextResponse.json(
    {
      status: dbOk ? 'ok' : 'degraded',
      service: 'lnf',
      build: env.buildStamp,
      database: dbOk ? 'reachable' : 'unreachable',
      ms: Date.now() - started,
      time: new Date().toISOString(),
    },
    { status: dbOk ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
