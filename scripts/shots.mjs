import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { startMock } from './mock-supabase.mjs';

const PORT = 3114;
const BASE = `http://127.0.0.1:${PORT}`;
const mock = await startMock(54321);
const child = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  cwd: '/scratch/work/lnf', stdio: 'ignore',
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'mock' },
});
for (let i = 0; i < 40; i++) {
  try { await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(2000) }); break; } catch { await sleep(500); }
}
const shots = [
  ['home-mobile', '/', '360,800'],
  ['home-desktop', '/', '1280,900'],
  ['browse-desktop', '/browse', '1280,900'],
  ['browse-mobile', '/browse', '360,800'],
  ['item-desktop', '/items/LF-2026-0007', '1280,1000'],
  ['item-mobile', '/items/LF-2026-0007', '360,800'],
  ['report-mobile', '/report/found', '360,800'],
];
for (const [name, route, size] of shots) {
  try {
    execFileSync('chromium', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--no-proxy-server', '--proxy-bypass-list=*', '--disable-dev-shm-usage',
      `--window-size=${size}`, '--virtual-time-budget=5000',
      `--screenshot=/scratch/work/shots/${name}.png`, BASE + route,
    ], { stdio: 'ignore', timeout: 60000 });
    console.log('shot', name);
  } catch (e) { console.log('shot failed', name, e.message.slice(0, 100)); }
}
child.kill('SIGKILL');
mock.close();
process.exit(0);
