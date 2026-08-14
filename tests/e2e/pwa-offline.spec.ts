import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, installThinkingMocks, openSpecular, writeThought } from './helpers';

test('the authored workspace remains available after an offline restart', async ({ browser, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium' || testInfo.project.name !== 'chromium-375');
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', serviceWorkers: 'allow', viewport: { width: 375, height: 760 } });
  let page = await context.newPage();
  try {
    await installThinkingMocks(page);
    await openSpecular(page);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.getByRole('textbox', { name: 'Document title' }).fill('An offline thought');
    await writeThought(page, 'The canonical writing should remain on this device without a network.');
    await page.waitForTimeout(300);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(async () => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    await context.setOffline(true);
    await page.close();
    page = await context.newPage();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('textbox', { name: 'Document title' })).toHaveValue('An offline thought');
    await expect(page.getByRole('textbox', { name: 'Thought writing block' })).toHaveValue('The canonical writing should remain on this device without a network.');
    await expectNoHorizontalOverflow(page);
  } finally {
    await context.close();
  }
});
