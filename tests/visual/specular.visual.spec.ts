import { expect, test, type Page } from '@playwright/test';
import { installThinkingMocks, openSpecular, openSpecularPath, writeThought } from '../e2e/helpers';

const screenshotOptions = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  fullPage: true,
  maxDiffPixelRatio: 0.02,
  threshold: 0.2,
};
const overlayScreenshotOptions = { ...screenshotOptions, fullPage: false };

async function settleVisual(page: Page): Promise<void> {
  await page.evaluate(async () => { await document.fonts.ready; });
}

test('canonical authoring page and reflection margin', async ({ page }) => {
  await installThinkingMocks(page);
  await openSpecular(page);
  await page.getByRole('textbox', { name: 'Document title' }).fill('On attention and uncertainty');
  await writeThought(page, 'Attention is not proof. It is a reason to keep looking without pretending the answer is settled.');
  await page.getByRole('button', { name: 'Reflect' }).click();
  await expect(page.getByText(/separating attention from certainty/iu)).toBeVisible();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await settleVisual(page);
  await expect(page).toHaveScreenshot('authoring-desktop.png', screenshotOptions);
});

test('signed-out entry at a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/session', async (route) => {
    await route.fulfill({ contentType: 'application/json', status: 401, body: JSON.stringify({ authenticated: false, signInUrl: '/signin-with-chatgpt?return_to=%2F' }) });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your private thinking workspace' })).toBeVisible();
  await settleVisual(page);
  await expect(page).toHaveScreenshot('entry-mobile.png', screenshotOptions);
});

test('PWA notices remain distinct at a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const states = [
    ['patterns-status--update-ready', 'Application update', 'update-ready-mobile.png'],
    ['patterns-status--preparing', 'Application update', 'update-preparing-mobile.png'],
    ['patterns-status--update-failure', 'Application update', 'update-failure-mobile.png'],
    ['patterns-status--offline-ready', 'Offline availability', 'offline-ready-mobile.png'],
  ] as const;
  for (const [storyId, accessibleName, screenshot] of states) {
    await page.goto(`http://127.0.0.1:6006/iframe.html?id=${storyId}&viewMode=story`);
    await expect(page.getByRole('status', { name: accessibleName })).toBeVisible();
    await settleVisual(page);
    await expect(page).toHaveScreenshot(screenshot, screenshotOptions);
  }
});

test('Library and Snapshot overlays at a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installThinkingMocks(page);
  await openSpecular(page);
  await page.getByRole('textbox', { name: 'Document title' }).fill('A synthetic working document');
  await writeThought(page, 'A compact surface should preserve hierarchy and every deliberate action.');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByText('No published links yet.')).toBeVisible();
  await settleVisual(page);
  await expect(page).toHaveScreenshot('library-mobile.png', overlayScreenshotOptions);

  await page.getByRole('button', { name: 'Close library' }).click();
  await page.getByRole('button', { name: 'Create snapshot' }).click();
  await expect(page.getByRole('dialog', { name: 'Snapshot editor' })).toBeVisible();
  await settleVisual(page);
  await expect(page).toHaveScreenshot('snapshot-mobile.png', overlayScreenshotOptions);
});

test('public snapshot with references at a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/shares/visual-snapshot', async (route) => {
    await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({
      title: 'A published synthetic reflection',
      createdAt: 1_800_000_000_000,
      blocks: [{
        id: 'synthetic:block',
        content: 'A published page keeps authored writing primary and source context legible.',
        kind: 'thought',
        references: [{ id: 'synthetic:reference', author: 'A. Writer', title: 'Synthetic source', url: 'https://example.com/source' }],
      }],
    }) });
  });
  await openSpecularPath(page, '/s/visual-snapshot');
  await expect(page.getByRole('heading', { name: 'A published synthetic reflection' })).toBeVisible();
  await settleVisual(page);
  await expect(page).toHaveScreenshot('published-mobile.png', screenshotOptions);
});
