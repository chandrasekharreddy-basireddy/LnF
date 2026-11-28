/**
 * Captures the rendered HTML of every route, with and without a session.
 *
 * No browser is involved: this sandbox's chromium cannot load an http URL, so
 * each page is fetched, its built stylesheet is inlined, scripts are stripped,
 * and the result is rendered to an image by the python step. Layout is close but
 * not pixel-identical to a real browser — CSS grid and flex are approximated.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { startMock } from './mock-supabase.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// the mock answers as staff+admin, so the desk and console pages render too
process.env.MOCK_ROLE = 'staff';
const OUT = path.join(ROOT, '.shots');
const PORT = Number(process.env.SHOT_PORT ?? 3390);

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function sessionCookie() {
  const session = {
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'ananya@campus.edu',
      email_confirmed_at: '2026-11-01T09:00:00Z',
      app_metadata: { provider: 'email' },
      user_metadata: {},
      created_at: '2026-11-01T09:00:00Z',
    },
  };
  return `sb-127-auth-token=base64-${b64url(session)}`;
}

const ROUTES = [
  ['home', '/', 'none'],
  ['browse', '/browse', 'none'],
  ['browse-search', '/browse?q=earbuds', 'none'],
  ['browse-empty', '/browse?q=zzzznothing', 'none'],
  ['item-detail', '/items/LF-2026-0007', 'none'],
  ['item-sensitive', '/items/LF-2026-0009', 'none'],
  ['hand-in', '/hand-in', 'none'],
  ['safety', '/safety', 'none'],
  ['how-it-works', '/how-it-works', 'none'],
  ['legal-privacy', '/legal/privacy', 'none'],
  ['legal-retention', '/legal/retention', 'none'],
  ['legal-terms', '/legal/terms', 'none'],
  ['sign-in', '/sign-in', 'none'],
  ['report-success', '/report/success?ref=LF-2026-0007&state=pending_moderation', 'none'],
  ['report-found', '/report/found', 'member'],
  ['report-lost', '/report/lost', 'member'],
  ['claims', '/claims', 'member'],
  ['claim-detail', '/claims/CLM-2026-0002', 'member'],
  ['messages', '/messages', 'member'],
  ['thread', '/messages/CLM-2026-0002', 'member'],
  ['account', '/account', 'member'],
  ['account-saved', '/account/saved', 'member'],
  ['staff', '/staff', 'staff'],
  ['staff-item', '/staff/items/LF-2026-0007', 'staff'],
  ['staff-label', '/staff/items/LF-2026-0007/label', 'staff'],
  ['staff-disposal', '/staff/disposal', 'staff'],
  ['staff-import', '/staff/import', 'staff'],
  ['staff-scan', '/staff/scan', 'staff'],
  ['disputes', '/disputes', 'member'],
  ['staff-disputes', '/staff/disputes', 'staff'],
  ['staff-matches', '/staff/matches', 'staff'],
  ['staff-analytics', '/staff/analytics', 'staff'],
  ['admin', '/admin', 'staff'],
  ['admin-users', '/admin/users', 'staff'],
  ['admin-audit', '/admin/audit', 'staff'],
];

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(800, () => done(false));
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const mock = await startMock(54321);

  const env = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key',
    NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
    NEXT_PUBLIC_CAMPUS_NAME: 'Sai University',
    NEXT_PUBLIC_DESK_LABEL: 'Main Gate & Security Desk',
    NEXT_PUBLIC_SUPPORT_EMAIL: 'help@lnf.app',
    MOCK_ROLE: 'staff',
  };

  const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '-p', String(PORT)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));

  let up = false;
  for (let i = 0; i < 60; i += 1) {
    if (await canConnect(PORT)) { up = true; break; }
    await sleep(500);
  }
  if (!up) { console.error('server did not start\n', log.slice(-1500)); mock.close(); process.exit(1); }

  const report = [];
  for (const [name, route, mode] of ROUTES) {
    const headers = { 'user-agent': 'lnf-shots' };
    if (mode !== 'none') headers.cookie = sessionCookie();

    const res = await fetch(`http://127.0.0.1:${PORT}${route}`, { headers, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    const html = res.status === 200 ? await res.text() : '';
    const title = (html.match(/<title[^>]*>([^<]*)</) ?? [])[1] ?? '';
    const isError = /Application error|Internal Server Error/.test(html);
    report.push({ name, route, mode, status: res.status, bytes: html.length, title, isError });
    if (html) writeFileSync(path.join(OUT, `${name}.html`), html);
    const loc = res.headers.get('location') ?? '';
    console.log(`${String(res.status).padEnd(4)} ${String(html.length).padStart(6)}b  ${name.padEnd(18)} ${title.slice(0, 40)} ${loc}`);
  }

  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  if (report.some((r) => r.status >= 500)) console.error('SERVER LOG TAIL\n', log.slice(-1200));
  child.kill('SIGTERM');
  await sleep(600);
  mock.close();
  process.exit(0);
}

await main();
