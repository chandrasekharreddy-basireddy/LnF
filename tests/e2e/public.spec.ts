import { expect, test } from '@playwright/test';

const ITEM = '/items/LF-2026-0007';

test.describe('public board', () => {
  test('home explains the product and offers both actions', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Lost something');
    await expect(page.getByRole('link', { name: 'I lost something' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'I found something' })).toBeVisible();
    await expect(page.getByText('Never pay to get an item back.')).toBeVisible();
    await expect(page.getByRole('link', { name: /Black wireless earbuds/ })).toBeVisible();
  });

  test('search lands on browse with the query in the URL', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('search').getByRole('searchbox').fill('earbuds');
    await page.getByRole('search').getByRole('button', { name: 'Search' }).click();
    await page.waitForURL(/\/browse\?q=earbuds/);
    await expect(page.getByText(/match your filters/)).toBeVisible();
    await expect(page.getByRole('link', { name: /Black wireless earbuds/ })).toBeVisible();
  });

  test('filters survive a reload and an empty result offers a next step', async ({ page }) => {
    await page.goto('/browse?type=lost&zone=parking');
    await expect(page).toHaveURL(/type=lost/);
    await expect(page.getByLabel('Type')).toHaveValue('lost');
    await expect(page.getByLabel('Zone')).toHaveValue('parking');

    await page.goto('/browse?q=zzzznothing');
    await expect(page.getByText('Nothing matches those filters yet')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Clear filters' })).toBeVisible();
  });

  test('item detail shows the question, never the answer', async ({ page }) => {
    await page.goto(ITEM);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Black wireless earbuds');
    await expect(page.getByText('To claim this, tell us')).toBeVisible();
    await expect(page.getByText('Bluetooth name of the case')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in to claim' })).toBeVisible();

    const body = (await page.content()).toLowerCase();
    for (const forbidden of ['redmi buds', 'answer_hash', 'contact_email', 'reporter_id', 'finder_contact']) {
      expect(body, `private value "${forbidden}" must not reach the browser`).not.toContain(forbidden);
    }
  });

  test('sensitive items never render a photo', async ({ page }) => {
    await page.goto('/items/LF-2026-0009');
    await expect(page.getByText('No photo shown')).toBeVisible();
    await expect(page.locator('img[src*="bottle"]')).toHaveCount(0);
  });

  test('no horizontal overflow at 360px', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile-only assertion');
    for (const route of ['/', '/browse', ITEM, '/safety', '/report/found']) {
      await page.goto(route);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow on ${route}`).toBeLessThanOrEqual(1);
    }
  });

  test('skip link is the first tab stop', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  });
});
