import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { installThinkingMocks, openSpecular, writeThought } from '../e2e/helpers';

test('captures a non-blocking WebKit authoring receipt', async ({ page }) => {
  await mkdir('artifacts/ui-quality/webkit', { recursive: true });
  await installThinkingMocks(page);
  await openSpecular(page);
  await page.getByRole('textbox', { name: 'Document title' }).fill('A WebKit diagnostic document');
  await writeThought(page, 'This synthetic receipt checks the canonical page and mobile browser layout.');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Document library' })).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    path: 'artifacts/ui-quality/webkit/library-mobile.png',
  });
});
