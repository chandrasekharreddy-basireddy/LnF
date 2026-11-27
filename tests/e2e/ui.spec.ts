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
    // the shortcut is a client handler: wait for hydration rather than race it
    await page.waitForFunction(() => document.documentElement.dataset.hydrated === 'true');
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: 'Quick search' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Quick search' })).toHaveCount(0);
  });

  test('one tap flips the theme and it survives a reload', async ({ page }) => {
    await page.goto('/');
    const flip = page.getByRole('button', { name: 'Switch between light and dark theme' });
    await expect(flip).toBeVisible();

    // the headless browser reports a light system preference, so the first tap
    // must produce an explicit dark theme
    await flip.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    // rendered from the cookie by the server, so it is set before first paint
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.getByRole('button', { name: 'Switch between light and dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('the sun and moon icons follow the rendered theme', async ({ page }) => {
    await page.goto('/');
    const sun = page.locator('.flip-icon-sun');
    const moon = page.locator('.flip-icon-moon');

    await page.getByRole('button', { name: 'Switch between light and dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(moon).toBeVisible();
    await expect(sun).toBeHidden();
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
