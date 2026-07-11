import { expect, test, type Page } from '@playwright/test';
import { installOperationMocks, openSpecular, submitThought } from './helpers';

interface NamedLongTask {
  readonly duration: number;
  readonly operation: string;
}

async function installLongTaskObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as typeof window & {
      __specularLongTasks?: NamedLongTask[];
      __specularOperation?: string;
    };
    state.__specularLongTasks = [];
    state.__specularOperation = 'starter-motion';
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        state.__specularLongTasks?.push({
          duration: entry.duration,
          operation: state.__specularOperation ?? 'unattributed',
        });
      }
    }).observe({ type: 'longtask', buffered: true });
  });
}

async function markOperation(page: Page, operation: string): Promise<void> {
  await page.evaluate((name) => {
    (window as typeof window & { __specularOperation?: string }).__specularOperation = name;
  }, operation);
}

test.beforeEach(async ({ page }) => {
  await installOperationMocks(page);
  await openSpecular(page);
  await installLongTaskObserver(page);
});

test('scripted mobile interactions produce no task longer than 50 milliseconds', async ({ page }) => {
  await page.waitForTimeout(500);
  await markOperation(page, 'send');
  await submitThought(page, 'The launch handoff is still the constraint.');

  await markOperation(page, 'challenge-transition');
  await page.getByRole('button', { name: 'Test this' }).click();
  await expect(page.getByText(/stakeholder absorbs the cost/iu)).toBeVisible();

  await page.getByRole('textbox', { name: 'Idea, context, or response' })
    .fill('The owner should be explicit before the handoff begins.');
  await page.getByRole('button', { name: 'Send input' }).click();

  await markOperation(page, 'gather-transition');
  await page.getByRole('button', { name: 'Gather this thread' }).click();
  await expect(page.getByRole('textbox', { name: 'Working position' })).toBeVisible();

  await markOperation(page, 'capsule-navigation');
  await page.getByRole('button', { name: 'Save as capsule' }).click();
  await page.getByRole('button', { name: /Open capsule library/u }).click();
  await expect(page.getByRole('dialog', { name: 'Capsules' })).toBeVisible();
  await page.waitForTimeout(250);

  const longTasks = await page.evaluate(() =>
    (window as typeof window & { __specularLongTasks?: NamedLongTask[] }).__specularLongTasks ?? [],
  );
  expect(longTasks, JSON.stringify(longTasks, null, 2)).toEqual([]);
});
