import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { installOperationMocks, openSpecular, submitThought } from './helpers';

async function expectAccessible(page: Page, state: string): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const severe = result.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical');
  expect(severe, `${state}: ${severe.map(({ id, help }) => `${id}: ${help}`).join('; ')}`).toEqual([]);

  const undersized = await page.locator('button:visible, textarea:visible').evaluateAll((elements) =>
    elements.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width + 0.01 < 44 || rect.height + 0.01 < 44
        ? [`${element.tagName.toLowerCase()}[aria-label="${element.getAttribute('aria-label') ?? ''}"] ${String(rect.width)}x${String(rect.height)}`]
        : [];
    }),
  );
  expect(undersized, `${state}: interactive targets smaller than 44 CSS pixels`).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await installOperationMocks(page);
  await openSpecular(page);
});

test('empty, thread, Challenge, conclusion, and capsule states are accessible', async ({ page }) => {
  await expectAccessible(page, 'empty');
  await submitThought(page, 'The launch handoff is still the constraint.');
  await expectAccessible(page, 'thread');

  await page.getByRole('button', { name: 'Challenge me' }).click();
  await expect(page.getByText(/stakeholder absorbs the cost/iu)).toBeVisible();
  await expectAccessible(page, 'challenge');

  await page.getByRole('button', { name: 'Draft a conclusion' }).click();
  await expectAccessible(page, 'conclusion');
  await page.getByRole('button', { name: 'Save as capsule' }).click();
  await page.getByRole('button', { name: /Open capsule library/u }).click();
  await expectAccessible(page, 'capsule');
});

test('offline failure and voice failure remain announced, named, focused, and accessible', async ({
  context,
  page,
}) => {
  await context.setOffline(true);
  await page.getByRole('textbox', { name: 'Your thought' }).fill('Preserve this offline thought.');
  await page.getByRole('button', { name: 'Send thought' }).click();
  await expect(page.getByRole('alert')).toContainText('ready to retry');
  await expectAccessible(page, 'offline error');
  await context.setOffline(false);

  await page.route('**/api/realtime/session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ value: 'ephemeral-test-key', expiresAt: Math.floor(Date.now() / 1000) + 60 }),
  }));
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(new DOMException('Denied.', 'NotAllowedError')) },
    });
  });
  await page.getByRole('button', { name: 'Start voice' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /Microphone|Voice/iu })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Your thought' })).toBeFocused();
  await expectAccessible(page, 'voice failure');
});
