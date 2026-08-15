import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, installThinkingMocks, openSpecular, writeThought } from './helpers';

test('an open verified workspace can draft offline while a cold offline launch stays shielded', async ({ browser, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium' || testInfo.project.name !== 'chromium-375');
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', serviceWorkers: 'allow', viewport: { width: 375, height: 760 } });
  let page = await context.newPage();
  try {
    await installThinkingMocks(page);
    await openSpecular(page);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(async () => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    const authSentinel = 'host-owned-auth-route';
    await context.route(/\/(?:signin-with-chatgpt|signout-with-chatgpt|callback)(?:\/|$)/u, async (route) => {
      await route.fulfill({ contentType: 'text/plain', status: 200, body: `${authSentinel}:${new URL(route.request().url()).pathname}` });
    });
    const authPage = await context.newPage();
    for (const path of ['/signin-with-chatgpt', '/signout-with-chatgpt', '/callback']) {
      const response = await authPage.goto(path);
      expect(response?.fromServiceWorker()).toBe(false);
      await expect(authPage.locator('body')).toHaveText(`${authSentinel}:${path}`);
    }
    await authPage.close();

    await page.unroute('**/api/session');
    await page.unroute('**/api/workspace');
    await context.setOffline(true);
    await page.getByRole('textbox', { name: 'Document title' }).fill('An offline thought');
    await writeThought(page, 'The canonical writing should remain checkpointed while this verified page is open.');
    await expect(page.getByText('Saved on this device')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Document title' })).toHaveValue('An offline thought');
    await expectNoHorizontalOverflow(page);

    await page.close();
    page = await context.newPage();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('alert')).toContainText('could not verify your ChatGPT session');
    await expect(page.getByRole('textbox', { name: 'Document title' })).toHaveCount(0);
    await expect(page.getByText('An offline thought')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  } finally {
    await context.close();
  }
});

test('a waiting service worker activates only after the author accepts a checkpointed update', async ({ browser, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium' || testInfo.project.name !== 'chromium-375');
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', serviceWorkers: 'allow', viewport: { width: 375, height: 760 } });
  const page = await context.newPage();
  try {
    await installThinkingMocks(page);
    await openSpecular(page);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(async () => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    const savedRemotely = page.waitForResponse((response) => (
      response.url().endsWith('/api/workspace')
      && response.request().method() === 'PUT'
      && response.status() === 200
    ));
    await page.getByRole('textbox', { name: 'Document title' }).fill('Checkpointed before update');
    await savedRemotely;
    await expect(page.getByText('Saved')).toBeVisible();

    await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js?release=B', { scope: '/' }); });
    await expect.poll(async () => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting !== null)).toBe(true);
    await expect(page.getByRole('status', { name: 'Application update' })).toBeVisible();

    await page.getByRole('button', { name: 'Update now' }).click();
    await expect(page.getByRole('textbox', { name: 'Document title' })).toHaveValue('Checkpointed before update');
    await expect.poll(async () => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await expect.poll(async () => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? '')).toContain('release=B');
  } finally {
    await context.close();
  }
});
