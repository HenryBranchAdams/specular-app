import { expect, test } from '@playwright/test';
import {
  expectNoHorizontalOverflow,
  installOperationMocks,
  openSpecular,
  submitThought,
} from './helpers';

test('service worker restores authored PWA state after an offline page restart', async ({
  browser,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium' || testInfo.project.name !== 'chromium-375');
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:4173',
    serviceWorkers: 'allow',
    viewport: { width: 375, height: 760 },
  });
  let page = await context.newPage();
  try {
    const firstThought = 'The launch handoff needs a named owner at the decision boundary.';
    const secondThought = 'That owner should acknowledge the decision before work moves forward.';
    const offlineThought = 'The offline escalation timing still needs a durable answer.';
    const workingPosition = 'A launch handoff is reliable when its named owner acknowledges the decision before work moves forward.';

    await installOperationMocks(page);
    await openSpecular(page);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(async () => page.evaluate(() => navigator.serviceWorker.controller !== null))
      .toBe(true);

    await submitThought(page, firstThought);
    await page.getByRole('textbox', { name: 'Idea, context, or response' }).fill(secondThought);
    await page.getByRole('button', { name: 'Send input' }).click();
    await expect(page.getByText(secondThought, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Gather this thread' }).click();

    const thesis = page.getByRole('textbox', { name: 'Working position' });
    await expect(thesis).toHaveValue(firstThought);
    await expect(page.getByRole('textbox', { name: 'Thread excerpt 1' }))
      .toHaveValue(secondThought);
    await thesis.fill(workingPosition);
    await page.getByRole('button', { name: 'Save as capsule' }).click();
    await expect(page.getByText('Capsule saved.')).toBeVisible();
    await page.getByRole('button', { name: 'Return to thread' }).click();
    await expect(page.getByText(firstThought, { exact: true })).toBeVisible();
    await expect(page.getByText(secondThought, { exact: true })).toBeVisible();

    await context.setOffline(true);
    await page.getByRole('textbox', { name: 'Idea, context, or response' }).fill(offlineThought);
    await page.getByRole('button', { name: 'Send input' }).click();
    await expect(page.getByText(offlineThought, { exact: true })).toBeVisible();
    let recovery = page.getByRole('group', { name: 'Saved thought recovery' });
    await expect(recovery).toContainText('Not sent');
    await expect(recovery.getByRole('button', { name: 'Retry' })).toBeEnabled();

    await page.close();
    page = await context.newPage();
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Specular' })).toBeVisible();
    await expect(page.getByText(firstThought, { exact: true })).toBeVisible();
    await expect(page.getByText(secondThought, { exact: true })).toBeVisible();
    await expect(page.getByText(offlineThought, { exact: true })).toBeVisible();

    recovery = page.getByRole('group', { name: 'Saved thought recovery' });
    await expect(recovery).toContainText('Not sent');
    const retry = recovery.getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible();
    await expect(retry).toBeEnabled();

    await page.getByRole('button', { name: /Open capsule library/u }).click();
    const library = page.getByRole('dialog', { name: 'Capsules' });
    await expect(library.getByRole('list', { name: 'Saved capsules' })).toBeVisible();
    await library.getByRole('button', { name: /The launch handoff needs a named owner/u })
      .click();
    await expect(library.getByRole('textbox', { name: 'Working position' }))
      .toHaveValue(workingPosition);
    await expect(library.getByRole('textbox', { name: 'From the thread' }))
      .toHaveValue(secondThought);

    await expect(page.getByRole('heading', { name: 'Your local data needs attention' }))
      .toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  } finally {
    await context.close();
  }
});
