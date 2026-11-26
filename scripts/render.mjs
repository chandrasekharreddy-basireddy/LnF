/** Renders routes to HTML files and screenshots for visual review. */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { startMock } from './mock-supabase.mjs';

const PORT = 3113;
const BASE = `http://127.0.0.1:${PORT}`;
const dir = '/scratch/work/render';
mkdirSync(dir, { recursive: true });
mkdirSync('/scratch/work/shots', { recursive: true });

const mock = await startMock(54321);
const child = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  cwd: '/scratch/work/lnf',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'mock' },
});
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));

for (let i = 0; i < 40; i++) {
  try { await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(2000) }); break; } catch { await sleep(500); }
}

const pages = {
  home: '/',
  browse: '/browse',
  item: '/items/LF-2026-0007',
  item_sensitive: '/items/LF-2026-0009',
  report_found: '/report/found',
  signin: '/sign-in',
  retention: '/legal/retention',
  safety: '/safety',
};

for (const [name, route] of Object.entries(pages)) {
  const res = await fetch(BASE + route, { signal: AbortSignal.timeout(20000) });
  writeFileSync(`${dir}/${name}.html`, await res.text());
  console.log('wrote', name, res.status);
}

writeFileSync('/tmp/render-log.txt', log.slice(-2000));
child.kill('SIGKILL');
mock.close();
process.exit(0);
