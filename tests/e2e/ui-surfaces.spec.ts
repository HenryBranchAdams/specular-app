import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';

test('signed-out and verification-failed boundaries keep private content closed', async ({ page }) => {
  await page.route('**/api/session', async (route) => {
    await route.fulfill({ contentType: 'application/json', status: 401, body: JSON.stringify({ authenticated: false, signInUrl: '/signin-with-chatgpt?return_to=%2F' }) });
  });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Sign in with ChatGPT' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.unroute('**/api/session');
  await page.route('**/api/session', async (route) => {
    await route.abort('failed');
  });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('could not verify your ChatGPT session');
  await expectNoHorizontalOverflow(page);
});

test('hosted snapshot loading, available, and unavailable states stay distinct', async ({ page }) => {
  let response: 'available' | 'unavailable' = 'available';
  await page.route('**/api/shares/synthetic-snapshot', async (route) => {
    if (response === 'unavailable') {
      await route.fulfill({ contentType: 'application/json', status: 404, body: JSON.stringify({ error: 'This snapshot is unavailable.' }) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({
      title: 'Synthetic attention notes',
      createdAt: 1_800_000_000_000,
      blocks: [{ id: 'synthetic:block', content: 'Attention can invite another look without becoming certainty.', kind: 'thought', references: [] }],
    }) });
  });
  await page.goto('/s/synthetic-snapshot');
  await expect(page.getByLabel('Loading snapshot')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Synthetic attention notes' })).toBeVisible();

  response = 'unavailable';
  await page.reload();
  await expect(page.getByRole('heading', { name: /unavailable/iu })).toBeVisible();
});
