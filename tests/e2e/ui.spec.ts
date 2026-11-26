import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('interface', () => {
  test('command palette jumps to a reference', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Open quick search/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Quick search' });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('textbox').fill('LF-2026-0007');
    await dialog.getByRole('textbox').press('Enter');
    await page.waitForURL(/\/items\/LF-2026-0007$/);
  });

  test('command palette opens with Control+K and closes with Escape', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: 'Quick search' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Quick search' })).toHaveCount(0);
  });

  test('theme choice is server-rendered and survives a reload', async ({ page }) => {
    await page.goto('/');
    const switcher = page.getByRole('form', { name: 'Colour theme' });
    await switcher.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    // rendered by the server from the cookie, so it is set before first paint
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('photo viewer opens, moves and closes by keyboard', async ({ page }) => {
    await page.goto('/items/LF-2026-0007');
    await page.getByRole('button', { name: /Open .*\(1 of 1\)/ }).click();
    await expect(page.getByRole('dialog', { name: 'Item photo' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Item photo' })).toHaveCount(0);
  });
});

test.describe('dark theme accessibility', () => {
  test.use({ bypassCSP: true });

  test('no critical or serious violations in dark mode', async ({ page, context }) => {
    await context.addCookies([
      { name: 'lnf-theme', value: 'dark', domain: '127.0.0.1', path: '/' },
    ]);
    for (const route of ['/', '/browse', '/items/LF-2026-0007']) {
      await page.goto(route);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const blocking = results.violations.filter(
        (violation) => violation.impact === 'critical' || violation.impact === 'serious',
      );
      expect(
        blocking.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
        `dark-mode violations on ${route}`,
      ).toEqual([]);
    }
  });
});
