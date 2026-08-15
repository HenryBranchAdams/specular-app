import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, openSpecularPath } from './helpers';

test('signed-out and verification-failed boundaries keep private content closed', async ({ page }) => {
  await page.route('**/api/session', async (route) => {
    await route.fulfill({ contentType: 'application/json', status: 401, body: JSON.stringify({ authenticated: false, signInUrl: '/signin-with-chatgpt?return_to=%2F' }) });
  });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Sign in with ChatGPT' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const viewport = page.viewportSize();
  if (viewport !== null) await page.setViewportSize({ width: viewport.width, height: 480 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect(page.getByRole('heading', { name: 'Your private thinking workspace' })).toBeVisible();
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

test('hosted snapshot loading, available, empty, and unavailable states stay distinct', async ({ page }) => {
  let response: 'available' | 'empty' | 'unavailable' = 'available';
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let firstRequest = true;
  await page.route('**/api/shares/synthetic-snapshot', async (route) => {
    if (firstRequest) {
      firstRequest = false;
      await pending;
    }
    if (response === 'unavailable') {
      await route.fulfill({ contentType: 'application/json', status: 404, body: JSON.stringify({ error: 'This snapshot is unavailable.' }) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({
      title: 'Synthetic attention notes',
      createdAt: 1_800_000_000_000,
      blocks: response === 'empty' ? [] : [{ id: 'synthetic:block', content: 'Attention can invite another look without becoming certainty.', kind: 'thought', references: [] }],
    }) });
  });
  await openSpecularPath(page, '/s/synthetic-snapshot');
  await expect(page.getByLabel('Loading snapshot')).toBeVisible();
  release?.();
  await expect(page.getByRole('heading', { name: 'Synthetic attention notes' })).toBeVisible();

  response = 'empty';
  await page.reload();
  await expect(page.getByText('This snapshot has no published writing.')).toBeVisible();

  response = 'unavailable';
  await page.reload();
  await expect(page.getByRole('heading', { name: /unavailable/iu })).toBeVisible();
});

test('hosted snapshots reflow extreme synthetic content and references at 200%', async ({ page }) => {
  await page.route('**/api/shares/synthetic-extreme', async (route) => {
    await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({
      title: 'A deliberately long synthetic title that tests the published reading surface',
      createdAt: 1_800_000_000_000,
      blocks: [{
        id: 'synthetic:block',
        content: `A long synthetic passage ${'keeps its authored meaning visible while testing narrow reflow. '.repeat(12)}`,
        kind: 'thought',
        references: [{
          id: 'synthetic:reference',
          author: 'A. Synthetic Writer',
          title: 'A reference title that remains legible without escaping the published surface',
          url: 'https://example.com/synthetic-reference',
        }],
      }],
    }) });
  });
  await openSpecularPath(page, '/s/synthetic-extreme');
  await expect(page.getByRole('heading', { name: /deliberately long synthetic title/iu })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'References' })).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect(page.getByRole('link', { name: /reference title/iu })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
