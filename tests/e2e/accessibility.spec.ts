import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { installThinkingMocks, openSpecular, writeThought } from './helpers';

async function expectAccessible(page: Page, state: string): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const severe = result.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical');
  expect(severe, `${state}: ${severe.map(({ id, help }) => `${id}: ${help}`).join('; ')}`).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await installThinkingMocks(page);
  await openSpecular(page);
});

test('blank, reflected, connected, and snapshot states have no serious accessibility violations', async ({ page }) => {
  await expectAccessible(page, 'blank document');
  await writeThought(page, 'Attention is not certainty.');
  await page.getByRole('button', { name: 'Reflect' }).click();
  await expect(page.getByText(/separating attention from certainty/iu)).toBeVisible();
  await expectAccessible(page, 'reflection margin');
  await page.getByRole('button', { name: 'Connections' }).click();
  await expectAccessible(page, 'connections');
  await page.getByRole('button', { name: 'Document' }).click();
  await page.getByRole('button', { name: 'Create snapshot' }).click();
  await expectAccessible(page, 'snapshot');
});
