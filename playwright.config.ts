import { defineConfig, devices } from '@playwright/test';

const PORT = 3200;
const MOCK_PORT = 54321;

/**
 * Runs the production build against the local mock of the Supabase API, so the
 * suite needs no credentials and cannot flake on a remote project.
 *
 * Build first with NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 — the value is
 * inlined at build time. `npm run e2e` does both.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 800 } } },
    // iPad Mini's descriptor defaults to WebKit; CI installs Chromium only.
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: `node scripts/mock-supabase.mjs --serve ${MOCK_PORT}`,
      url: `http://127.0.0.1:${MOCK_PORT}/rest/v1/public_zones`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `npx next start -p ${PORT}`,
      url: `http://127.0.0.1:${PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key',
        NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${PORT}`,
        NEXT_PUBLIC_CAMPUS_NAME: 'Sai University',
        NEXT_PUBLIC_DESK_LABEL: 'Main Gate & Security Desk',
        NEXT_PUBLIC_SUPPORT_EMAIL: 'help@lnf.app',
      },
    },
  ],
});
