/**
 * Renders the built app against the local mock API and reports what each route
 * actually returned. Run with: node scripts/smoke.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { startMock } from './mock-supabase.mjs';

const PORT = 3111;
const MOCK_PORT = 54321;
const BASE = `http://127.0.0.1:${PORT}`;

const routes = [
  '/',
  '/browse',
  '/browse?q=earbuds',
  '/browse?q=nothingmatches',
  '/browse?type=lost',
  '/items/LF-2026-0007',
  '/items/LF-2026-0009',
  '/items/LF-2026-9999',
  '/safety',
  '/how-it-works',
  '/legal/privacy',
  '/legal/retention',
  '/legal/terms',
  '/sign-in',
  '/claims',
  '/staff',
  '/admin',
  '/api/health',
  '/api/cron/housekeeping',
  '/robots.txt',
  '/sitemap.xml',
];

const out = [];
const log = (...a) => out.push(a.join(' '));

const mock = await startMock(MOCK_PORT);

const child = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  cwd: '/scratch/work/lnf',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key',
    NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${PORT}`,
    CRON_SECRET: 'test-secret',
  },
});

let serverLog = '';
child.stdout.on('data', (d) => (serverLog += d.toString()));
child.stderr.on('data', (d) => (serverLog += d.toString()));

async function waitForServer(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(5000) });
      if (res.status) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}

try {
  if (!(await waitForServer())) {
    log('SERVER DID NOT START');
    log(serverLog.slice(0, 3000));
    throw new Error('no server');
  }

  for (const route of routes) {
    const started = Date.now();
    const res = await fetch(BASE + route, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const body = await res.text();
    const h1 = (body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) ?? [])[1] ?? '';
    log(
      `${String(res.status).padEnd(3)} ${String(Date.now() - started).padStart(4)}ms ${String(body.length).padStart(6)}b  ${route}  ${h1
        .replace(/<[^>]+>/g, '')
        .trim()
        .slice(0, 48)}`,
    );
  }

  const home = await (await fetch(BASE + '/')).text();
  log('');
  log('CHECK home shows board count 6:', /<b>6<\/b>\s*<span>Listings on the board/.test(home));
  log('CHECK home shows open found 4:', /<b>4<\/b>\s*<span>Waiting at the desk/.test(home));
  log('CHECK home lists an item:', /Black wireless earbuds/.test(home));
  log('CHECK home safety copy:', /Never pay to get an item back/.test(home));
  log('CHECK home build stamp:', /build (<!-- -->)?\d{4}-\d{2}-\d{2}/.test(home));

  const browse = await (await fetch(BASE + '/browse?q=earbuds')).text();
  log('CHECK search "earbuds" matches earbuds item:', /Black wireless earbuds/.test(browse));
  log('CHECK search count text:', /match your filters/.test(browse) && /\d+/.test(browse));

  const empty = await (await fetch(BASE + '/browse?q=nothingmatches')).text();
  log('CHECK no-results empty state:', /Nothing matches those filters yet/.test(empty));

  const detail = await (await fetch(BASE + '/items/LF-2026-0007')).text();
  log('CHECK detail shows question:', /Bluetooth name of the case/.test(detail));
  log('CHECK detail shows custody:', /Main Gate &amp; Security Desk/.test(detail));
  log('CHECK detail has no answer leak:', !/redmi buds/i.test(detail));
  log('CHECK detail has no private keys:', !/answer_hash|contact_email|reporter_id|serial_number/i.test(detail));
  log('CHECK detail has claim sign-in CTA:', /Sign in to claim/.test(detail));

  const sensitive = await (await fetch(BASE + '/items/LF-2026-0009')).text();
  log('CHECK sensitive item hides photo:', /No photo shown/.test(sensitive) && !/bottle\.webp/.test(sensitive));

  const staff = await fetch(BASE + '/staff', { redirect: 'manual' });
  log('CHECK /staff unauthenticated ->', staff.status, staff.headers.get('location'));

  const claims = await (await fetch(BASE + '/claims')).text();
  log('CHECK /claims asks for sign in:', /Sign in to see the claims/.test(claims));

  for (const evil of ['//evil.com', 'https://evil.com', '/\\evil.com']) {
    const res = await fetch(
      `${BASE}/auth/confirm?token_hash=abc&type=email&next=${encodeURIComponent(evil)}`,
      { redirect: 'manual' },
    );
    const location = res.headers.get('location') ?? '';
    log(`CHECK open redirect blocked (${evil}) ->`, res.status, location.replace(BASE, ''));
  }
  const okNext = await fetch(`${BASE}/auth/confirm?token_hash=abc&type=email&next=%2Fclaims`, { redirect: 'manual' });
  log('CHECK safe next still honoured ->', okNext.status, (okNext.headers.get('location') ?? '').replace(BASE, ''));

  const cron = await fetch(BASE + '/api/cron/housekeeping');
  log('CHECK cron without bearer ->', cron.status);

  const health = await (await fetch(BASE + '/api/health')).json();
  log('CHECK health payload:', JSON.stringify(health));

  log('');
  log('SERVER ERRORS:', (serverLog.match(/(Error|error)[^\n]{0,160}/g) ?? []).slice(0, 6).join(' || ') || 'none');

  mkdirSync('/scratch/work/shots', { recursive: true });
} catch (err) {
  log('SMOKE FAILED ' + String(err));
  log(serverLog.slice(-3000));
} finally {
  writeFileSync('/tmp/smoke.txt', out.join('\n') + '\n');
  child.kill('SIGTERM');
  await sleep(600);
  child.kill('SIGKILL');
  mock.close();
  process.exit(0);
}
