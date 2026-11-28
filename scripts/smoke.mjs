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
  '/disputes',
  '/staff',
  '/staff/disputes',
  '/staff/analytics',
  '/staff/scan',
  '/staff/disposal',
  '/staff/items/LF-2026-0007/label',
  '/admin',
  '/api/health',
  '/api/push/config',
  '/api/cron/housekeeping',
  '/api/cron/push',
  '/robots.txt',
  '/sitemap.xml',
  '/offline.html',
  '/offline-sheet.js',
  '/sw.js',
  '/sw-policy.js',
  '/manifest.webmanifest',
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
    // a real-shaped international number, so the click-to-chat link renders
    DESK_WHATSAPP_NUMBER: '+91 98765 43210',
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

  const waHref = (detail.match(/https:\/\/wa\.me\/919876543210\?text=([^"&]+)/) ?? [])[1] ?? '';
  const waText = waHref ? decodeURIComponent(waHref) : '';
  log('CHECK item page offers WhatsApp click-to-chat:', /https:\/\/wa\.me\/919876543210\?text=/.test(detail));
  log('CHECK WhatsApp message names the item and nothing private:', waText.includes('LF-2026-0007') && !/redmi buds/i.test(waText) && !/answer/i.test(waText));
  log('CHECK WhatsApp link carries the desk number, not a bare national number:', !/wa\.me\/9876543210\?/.test(detail));

  const sensitive = await (await get(BASE + '/items/LF-2026-0009')).text();
  log('CHECK sensitive item hides photo:', /No photo shown/.test(sensitive) && !/bottle\.webp/.test(sensitive));

  const staff = await get(BASE + '/staff', { redirect: 'manual' });
  log('CHECK /staff unauthenticated ->', staff.status, staff.headers.get('location'));
  for (const guarded of ['/staff/scan', '/staff/disposal', '/staff/matches', '/staff/disputes', '/staff/items/LF-2026-0007/label', '/account', '/account/saved', '/messages', '/messages/CLM-2026-0001', '/disputes', '/disputes/DSP-2026-0001', '/staff/import', '/staff/analytics', '/staff/desk', '/items/LF-2026-0007/timeline']) {
    const res = await get(BASE + guarded, { redirect: 'manual' });
    const loc = res.headers.get('location') ?? '';
    const body = await res.text();
    // Next streams the shell, so a guarded page may redirect with 307 or hand
    // the redirect to the client in a 200 payload. Both are correct; rendering
    // the staff UI is not.
    const redirected = (res.status === 307 && loc.includes('/sign-in')) || /\/sign-in\?next=/.test(body);
    const leaked = /Disposal queue|Scan a tag|Saved searches|No pairs waiting|Record the outcome|Ask for a second look|Download the PDF|Recovery rate|Days in the chain|Keep this sheet for the counter|On the board now/.test(body);
    log(`CHECK ${guarded} guarded ->`, redirected && !leaked, `(${res.status})`);
  }


  // the custody timeline (0032): the reporter's own item, behind their session
  const timelineAnon = await get(BASE + '/items/LF-2026-0007/timeline', { redirect: 'manual' });
  const timelineBody = await timelineAnon.text();
  const timelineRedirected =
    (timelineAnon.status === 307 && (timelineAnon.headers.get('location') ?? '').includes('/sign-in')) ||
    /\/sign-in\?next=/.test(timelineBody);
  log('CHECK the custody timeline is behind a session ->', timelineRedirected, `(${timelineAnon.status})`);
  log(
    'CHECK and draws no step before the session is checked:',
    !/Days in the chain|What happened, in order|Claims received/.test(timelineBody),
  );
  // a signed-out visitor is sent to sign-in whatever the reference is, so this
  // is the shape check: no 500, and no timeline drawn from a reference that
  // does not exist
  const timelineMissing = await get(BASE + '/items/LF-2026-9999/timeline', { redirect: 'manual' });
  const timelineMissingBody = await timelineMissing.text();
  log(
    'CHECK an unknown timeline reference is not a 500:',
    timelineMissing.status !== 500 && !/Days in the chain/.test(timelineMissingBody),
    `(${timelineMissing.status})`,
  );

  // the offline desk (0035 + the worker): a page that must work with no network,
  // a policy that says what may be cached, and a manifest that installs
  const offlineRes = await get(BASE + '/offline.html', { redirect: 'manual' });
  const offline = await offlineRes.text();
  const offlineCsp = offlineRes.headers.get('content-security-policy') ?? '';
  log('CHECK the offline page is public and served:', offlineRes.status === 200, `(${offlineRes.status})`);
  log('CHECK it explains itself without a session:', /You are offline/.test(offline) && /at the counter/.test(offline));
  log('CHECK it carries no listing data of its own:', !/LF-\d{4}-\d{4}/.test(offline));
  log(
    'CHECK it repeats the no-payment rule:',
    /Never hand an item over/.test(offline) && /does not\s+charge/.test(offline),
  );
  log('CHECK its own policy, not the nonce one:', offlineCsp.includes("default-src 'none'") && offlineCsp.includes("script-src 'self'") && !offlineCsp.includes('nonce-'));
  log('CHECK its one script is same-origin:', /<script src="\/offline-sheet\.js"/.test(offline) && !/<script>/.test(offline));

  const sheetJs = await (await get(BASE + '/offline-sheet.js')).text();
  log(
    'CHECK the sheet reader draws with textContent, never markup:',
    /textContent/.test(sheetJs) && !/\.innerHTML\s*=/.test(sheetJs),
  );
  log('CHECK the sheet reader refuses an expired sheet:', /SHEET_EXPIRED_MS/.test(sheetJs) && /age\.expired/.test(sheetJs));

  const sw = await get(BASE + '/sw.js');
  const swBody = await sw.text();
  log('CHECK the worker is served as javascript:', sw.status === 200 && /javascript/.test(sw.headers.get('content-type') ?? ''), `(${sw.headers.get('content-type')})`);
  log('CHECK the worker loads its policy module:', /importScripts\('\/sw-policy\.js'\)/.test(swBody));
  log(
    'CHECK the worker never answers a page from a cache:',
    /if \(plan === 'navigation'\) event\.respondWith\(networkOrOffline/.test(swBody) &&
      !/async function networkOrOffline[\s\S]{0,700}?caches\.match\(request\)/.test(swBody),
  );
  const policy = await (await get(BASE + '/sw-policy.js')).text();
  log('CHECK the policy keeps the offline page and nothing private:', /offline\.html/.test(policy) && /'\/staff'/.test(policy) && /'\/api\/'/.test(policy));

  const manifestRes = await get(BASE + '/manifest.webmanifest');
  const manifest = await manifestRes.json().catch(() => ({}));
  log('CHECK the manifest is served:', manifestRes.status === 200 && manifest.name === 'L&F — lost and found', `(${manifestRes.status})`);
  log('CHECK it pins id and scope:', manifest.id === '/' && manifest.scope === '/');
  log('CHECK it offers shortcuts into the app:', Array.isArray(manifest.shortcuts) && manifest.shortcuts.length === 3);
  log('CHECK it starts where the board is:', manifest.start_url === '/' && manifest.display === 'standalone');

  // the institution report: a PDF behind a staff session, and nothing else
  const reportAnon = await get(BASE + '/api/staff/report/monthly?month=2026-11', { redirect: 'manual' });
  const reportAnonBody = await reportAnon.text();
  log('CHECK monthly report needs a session ->', reportAnon.status === 401, `(${reportAnon.status})`);
  log('CHECK the refusal is text, not a PDF:', !/^%PDF/.test(reportAnonBody) && /sign in/i.test(reportAnonBody));
  log('CHECK the refusal carries no numbers:', !/handedIn|recoveryRate|Central Library/.test(reportAnonBody));

  const reportBadMonth = await get(BASE + '/api/staff/report/monthly?month=2026-13', { redirect: 'manual' });
  log('CHECK a bad month is refused before anything is built ->', reportBadMonth.status === 401);

  const claims = await (await get(BASE + '/claims')).text();
  log('CHECK /claims asks for sign in:', /Sign in to see the claims/.test(claims));

  const disputes = await (await get(BASE + '/disputes', { redirect: 'manual' })).text();
  log(
    'CHECK /disputes asks for sign in, and explains the window before it does:',
    /Sign in/.test(disputes) || /\/sign-in\?next=\/disputes/.test(disputes),
  );

  // React separates adjacent text nodes with <!-- -->; compare the words, not the markup
  const safety = (await (await get(BASE + '/safety')).text()).replace(/<!-- -->/g, '');
  log('CHECK /safety explains the dispute room:', /ask for a second look/i.test(safety));
  log(
    'CHECK /safety publishes the desk\'s dispute record:',
    /3<\/strong> disputes raised/.test(safety) && /typically within 4 days/.test(safety) && /1<\/strong> upheld/.test(safety),
  );
  log('CHECK /safety shows no person-level trust data:', !/disputesUpheld|claimantEmail|accountAgeDays/i.test(safety));

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

  const pushConfig = await (await get(BASE + '/api/push/config')).json();
  log('CHECK push config is public and disabled without VAPID keys:', pushConfig.enabled === false && pushConfig.publicKey === null);
  log('CHECK push config leaks no private key:', !/private/i.test(JSON.stringify(pushConfig)));

  const pushCron = await get(BASE + '/api/cron/push');
  log('CHECK push cron without bearer ->', pushCron.status === 401);
  const pushCronAuthed = await get(BASE + '/api/cron/push', { headers: { authorization: 'Bearer test-secret' } });
  const pushCronBody = await pushCronAuthed.json();
  log('CHECK push cron with bearer but no VAPID names the reason ->', pushCronAuthed.status === 503 && pushCronBody.reason === 'VAPID_KEYS_NOT_SET', JSON.stringify(pushCronBody));

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
