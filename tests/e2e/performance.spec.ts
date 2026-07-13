import { expect, test, type Page } from '@playwright/test';
import { installOperationMocks, openSpecular, submitThought } from './helpers';

interface NamedLongTask {
  readonly duration: number;
  readonly operation: string;
}

const LONG_TASK_THRESHOLD_MS = 50;

async function installLongTaskObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as typeof window & {
      __specularLongTasks?: NamedLongTask[];
      __specularOperation?: string | undefined;
      __specularLongTaskObserver?: PerformanceObserver;
    };
    state.__specularLongTaskObserver?.disconnect();
    state.__specularLongTasks = [];
    state.__specularOperation = undefined;
    state.__specularLongTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        state.__specularLongTasks?.push({
          duration: entry.duration,
          operation: state.__specularOperation ?? 'unattributed',
        });
      }
    });
    state.__specularLongTaskObserver.observe({ type: 'longtask' });
  });
}

async function expectInteractionWithoutLongTasks(
  page: Page,
  operation: string,
  action: () => Promise<void>,
): Promise<void> {
  await page.evaluate((name) => {
    const state = window as typeof window & {
      __specularLongTasks?: NamedLongTask[];
      __specularOperation?: string | undefined;
      __specularLongTaskObserver?: PerformanceObserver;
    };
    state.__specularLongTaskObserver?.takeRecords();
    state.__specularLongTasks = [];
    state.__specularOperation = name;
  }, operation);

  await action();
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => { resolve(); }));
  }));

  const longTasks = await page.evaluate((name) => {
    const state = window as typeof window & {
      __specularLongTasks?: NamedLongTask[];
      __specularOperation?: string | undefined;
      __specularLongTaskObserver?: PerformanceObserver;
    };
    for (const entry of state.__specularLongTaskObserver?.takeRecords() ?? []) {
      state.__specularLongTasks?.push({
        duration: entry.duration,
        operation: state.__specularOperation ?? 'unattributed',
      });
    }
    const operationEntries = (state.__specularLongTasks ?? [])
      .filter((entry) => entry.operation === name);
    state.__specularOperation = undefined;
    return operationEntries;
  }, operation);
  expect(
    longTasks,
    `${operation} produced browser tasks longer than ${String(LONG_TASK_THRESHOLD_MS)} milliseconds:\n${JSON.stringify(longTasks, null, 2)}`,
  ).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await installOperationMocks(page);
  await openSpecular(page);
  await installLongTaskObserver(page);
});

test('@performance scripted mobile interactions produce no task longer than 50 milliseconds', async ({ page }) => {
  await expectInteractionWithoutLongTasks(page, 'send', async () => {
    await submitThought(page, 'The launch handoff is still the constraint.');
  });

  await expectInteractionWithoutLongTasks(page, 'test-transition', async () => {
    await page.getByRole('button', { name: 'Test this' }).click();
    await expect(page.getByText(/stakeholder absorbs the cost/iu)).toBeVisible();
  });

  const secondThought = 'The owner should be explicit before the handoff begins.';
  await expectInteractionWithoutLongTasks(page, 'second-send', async () => {
    await page.getByRole('textbox', { name: 'Idea, context, or response' }).fill(secondThought);
    await page.getByRole('button', { name: 'Send input' }).click();
    await expect(page.getByText(secondThought, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Gather this thread' })).toBeVisible();
  });

  await expectInteractionWithoutLongTasks(page, 'gather-transition', async () => {
    await page.getByRole('button', { name: 'Gather this thread' }).click();
    await expect(page.getByRole('textbox', { name: 'Working position' })).toBeVisible();
  });

  await expectInteractionWithoutLongTasks(page, 'capsule-navigation', async () => {
    await page.getByRole('button', { name: 'Save as capsule' }).click();
    await expect(page.getByText('Capsule saved.')).toBeVisible();
    await page.getByRole('button', { name: /Open capsule library/u }).click();
    await expect(page.getByRole('dialog', { name: 'Capsules' })).toBeVisible();
  });
});
