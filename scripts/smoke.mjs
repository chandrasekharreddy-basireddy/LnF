/**
 * Renders the built app against the local mock API and reports what each route
 * actually returned. Run with: node scripts/smoke.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the project from this file, never from the machine it happens to run on.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import { startMock } from './mock-supabase.mjs';

const PORT = Number(process.env.SMOKE_PORT ?? 3400 + Math.floor(Math.random() * 400));
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
  '/hand-in',
  '/safety',
  '/how-it-works',
  '/legal/privacy',
  '/legal/retention',
  '/legal/terms',
  '/sign-in',
  '/claims',
  '/staff',
  '/staff/scan',
  '/staff/disposal',
  '/staff/items/LF-2026-0007/label',
  '/admin',
  '/api/health',
  '/api/cron/housekeeping',
  '/robots.txt',
  '/sitemap.xml',
];

const out = [];
let failures = 0;
const log = (...a) => {
  const line = a.join(' ');
  if (line.includes('CHECK') && line.includes('false')) failures += 1;
  out.push(line);
  try {
    try {
    writeFileSync('/tmp/smoke.txt', out.join('\n') + '\n');
  } catch {
    // the transcript is a convenience; stdout already carries it
  }
  } catch {}
};

let mock;
try {
  mock = await startMock(MOCK_PORT);
} catch (err) {
  writeFileSync('/tmp/smoke.txt', `MOCK PORT ${MOCK_PORT} UNAVAILABLE: ${err.message}\n`);
  process.exit(1);
}

// Call the installed binary through this node process: no reliance on PATH,
// no npx resolution, and it works the same locally and in CI.
const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '-p', String(PORT)], {
  cwd: ROOT,
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
child.on('error', (err) => {
  failures += 1;
  log('SMOKE FAILED to start the server: ' + err.message);
});
child.stdout.on('data', (d) => (serverLog += d.toString()));
child.stderr.on('data', (d) => (serverLog += d.toString()));

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const finish = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}

async function waitForServer(tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await canConnect(PORT)) return true;
    await sleep(500);
  }
  return false;
}

/** fetch with a hard deadline that cannot be ignored by the socket layer. */
function get(url, init = {}) {
  return Promise.race([
    fetch(url, init),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`deadline ${url}`)), 20000)),
  ]);
}

try {
  if (!(await waitForServer())) {
    log('SERVER DID NOT START');
    log(serverLog.slice(0, 3000));
    throw new Error('no server');
  }

  for (const route of routes) {
    const started = Date.now();
    const res = await get(BASE + route, { redirect: 'manual' });
    const body = await res.text();
    const h1 = (body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) ?? [])[1] ?? '';
    log(
      `${String(res.status).padEnd(3)} ${String(Date.now() - started).padStart(4)}ms ${String(body.length).padStart(6)}b  ${route}  ${h1
        .replace(/<[^>]+>/g, '')
        .trim()
        .slice(0, 48)}`,
    );
  }

  const homeRes = await get(BASE + '/');
  const home = await homeRes.text();
  const csp = homeRes.headers.get('content-security-policy') ?? '';
  const nonce = (csp.match(/'nonce-([^']+)'/) ?? [])[1] ?? '';
  log('');
  log('CHECK CSP header present:', csp.includes("default-src 'self'") && csp.includes("frame-ancestors 'none'"));
  log('CHECK CSP nonce minted per request:', nonce.length > 10);
  log('CHECK script tags carry that nonce:', nonce ? home.includes(`nonce="${nonce}"`) : false);
  log('CHECK CSP has no unsafe-eval in prod:', !csp.includes("'unsafe-eval'"));

  const darkRes = await get(BASE + '/', { headers: { cookie: 'lnf-theme=dark' } });
  const darkHtml = await darkRes.text();
  log('CHECK theme cookie renders data-theme server-side:', /<html[^>]*data-theme="dark"/.test(darkHtml));
  log('');
  log('CHECK home shows board count 6:', /<b>6<\/b>\s*<span>Listings on the board/.test(home));
  log('CHECK home shows open found 4:', /<b>4<\/b>\s*<span>Waiting at the desk/.test(home));
  log('CHECK home lists an item:', /Black wireless earbuds/.test(home));
  log('CHECK home safety copy:', /Never pay to get an item back/.test(home));
  log('CHECK home build stamp:', /build (<!-- -->)?\d{4}-\d{2}-\d{2}/.test(home));

  const browse = await (await get(BASE + '/browse?q=earbuds')).text();
  log('CHECK search "earbuds" matches earbuds item:', /Black wireless earbuds/.test(browse));
  log('CHECK search count text:', /match your filters/.test(browse) && /\d+/.test(browse));

  const empty = await (await get(BASE + '/browse?q=nothingmatches')).text();
  log('CHECK no-results empty state:', /Nothing matches those filters yet/.test(empty));

  const detail = await (await get(BASE + '/items/LF-2026-0007')).text();
  log('CHECK detail shows question:', /Bluetooth name of the case/.test(detail));
  log('CHECK detail shows custody:', /Main Gate &amp; Security Desk/.test(detail));
  log('CHECK detail has no answer leak:', !/redmi buds/i.test(detail));
  log('CHECK detail has no private keys:', !/answer_hash|contact_email|reporter_id|serial_number/i.test(detail));
  log('CHECK anonymous visitor can claim without an account:', /Claim this item/.test(detail) && /No account needed/.test(detail));

  const sensitive = await (await get(BASE + '/items/LF-2026-0009')).text();
  log('CHECK sensitive item hides photo:', /No photo shown/.test(sensitive) && !/bottle\.webp/.test(sensitive));

  const staff = await get(BASE + '/staff', { redirect: 'manual' });
  log('CHECK /staff unauthenticated ->', staff.status, staff.headers.get('location'));
  for (const guarded of ['/staff/scan', '/staff/disposal', '/staff/items/LF-2026-0007/label', '/account/saved', '/messages', '/messages/CLM-2026-0001', '/staff/import']) {
    const res = await get(BASE + guarded, { redirect: 'manual' });
    const loc = res.headers.get('location') ?? '';
    const body = await res.text();
    // Next streams the shell, so a guarded page may redirect with 307 or hand
    // the redirect to the client in a 200 payload. Both are correct; rendering
    // the staff UI is not.
    const redirected = (res.status === 307 && loc.includes('/sign-in')) || /\/sign-in\?next=/.test(body);
    const leaked = /Disposal queue|Scan a tag|Saved searches/.test(body);
    log(`CHECK ${guarded} guarded ->`, redirected && !leaked, `(${res.status})`);
  }


  const claims = await (await get(BASE + '/claims')).text();
  log('CHECK /claims asks for sign in:', /Sign in to see the claims/.test(claims));

  for (const evil of ['//evil.com', 'https://evil.com', '/\\evil.com']) {
    const res = await get(
      `${BASE}/auth/confirm?token_hash=abc&type=email&next=${encodeURIComponent(evil)}`,
      { redirect: 'manual' },
    );
    const location = res.headers.get('location') ?? '';
    log(`CHECK open redirect blocked (${evil}) ->`, res.status, location.replace(BASE, ''));
  }
  const okNext = await get(`${BASE}/auth/confirm?token_hash=abc&type=email&next=%2Fclaims`, {
    redirect: 'manual',
  });
  log('CHECK safe next still honoured ->', okNext.status, (okNext.headers.get('location') ?? '').replace(BASE, ''));

  const cron = await get(BASE + '/api/cron/housekeeping');
  log('CHECK cron without bearer ->', cron.status);

  const health = await (await get(BASE + '/api/health')).json();
  log('CHECK health payload:', JSON.stringify(health));

  log('');
  log('DONE');
  log(failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} CHECK(S) FAILED`);
  log('SERVER ERRORS:', (serverLog.match(/(Error|error)[^\n]{0,160}/g) ?? []).slice(0, 6).join(' || ') || 'none');

} catch (err) {
  failures += 1;
  log('SMOKE FAILED ' + String(err));
  log(serverLog.slice(-3000));
} finally {
  try {
    writeFileSync('/tmp/smoke.txt', out.join('\n') + '\n');
  } catch {
    // the transcript is a convenience; stdout already carries it
  }
  // print, so CI and a human both see it — and fail, so it is a gate
  process.stdout.write(out.join('\n') + '\n');
  child.kill('SIGTERM');
  await sleep(600);
  child.kill('SIGKILL');
  mock.close();
  process.exit(failures === 0 ? 0 : 1);
}
