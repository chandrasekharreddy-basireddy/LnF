import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// axe injects a script into the page; the app ships a nonce-based CSP, so the
// browser context bypasses CSP for these checks only. The CSP itself is asserted
// in scripts/smoke.mjs.
test.use({ bypassCSP: true });

const ROUTES = ['/', '/browse', '/items/LF-2026-0007', '/safety', '/legal/retention'];

test.describe('accessibility (WCAG 2.2 AA)', () => {
  for (const route of ROUTES) {
    test(`no critical or serious violations on ${route}`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', (error) => consoleErrors.push(error.message));

      await page.goto(route);
      await page.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();

      const blocking = results.violations.filter(
        (violation) => violation.impact === 'critical' || violation.impact === 'serious',
      );

      expect(
        blocking.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
        `serious accessibility violations on ${route}`,
      ).toEqual([]);

      expect(consoleErrors, `console errors on ${route}`).toEqual([]);
    });
  }

  test('every page has exactly one h1 and a landmark', async ({ page }) => {
    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('banner')).toHaveCount(1);
      await expect(page.getByRole('contentinfo')).toHaveCount(1);
    }
  });
});
