import { expect, test } from '@playwright/test';

test('installed service worker keeps the PWA shell available offline', async ({
  browser,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium' || testInfo.project.name !== 'chromium-375');
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:4173',
    serviceWorkers: 'allow',
    viewport: { width: 375, height: 760 },
  });
  const page = await context.newPage();
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Ways to begin' })).toBeVisible();
  } finally {
    await context.close();
  }
});
