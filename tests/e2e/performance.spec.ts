import { expect, test, type Page } from '@playwright/test';
import { installThinkingMocks, openSpecular } from './helpers';

interface NamedLongTask { duration: number; operation: string }
const LONG_TASK_THRESHOLD_MS = 50;

async function installLongTaskObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as typeof window & { __specularLongTasks?: NamedLongTask[]; __specularOperation?: string; __specularLongTaskObserver?: PerformanceObserver };
    state.__specularLongTasks = [];
    state.__specularLongTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.__specularLongTasks?.push({ duration: entry.duration, operation: state.__specularOperation ?? 'unattributed' });
    });
    state.__specularLongTaskObserver.observe({ type: 'longtask' });
  });
}

async function withoutLongTasks(page: Page, operation: string, action: () => Promise<void>): Promise<void> {
  await page.evaluate((name) => {
    const state = window as typeof window & { __specularLongTasks?: NamedLongTask[]; __specularOperation?: string };
    state.__specularLongTasks = [];
    state.__specularOperation = name;
  }, operation);
  await action();
  await page.evaluate(() => new Promise<void>((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); }));
  const tasks = await page.evaluate((name) => {
    const state = window as typeof window & { __specularLongTasks?: NamedLongTask[]; __specularOperation?: string; __specularLongTaskObserver?: PerformanceObserver };
    for (const entry of state.__specularLongTaskObserver?.takeRecords() ?? []) state.__specularLongTasks?.push({ duration: entry.duration, operation: state.__specularOperation ?? 'unattributed' });
    delete state.__specularOperation;
    return (state.__specularLongTasks ?? []).filter((entry) => entry.operation === name);
  }, operation);
  expect(tasks, `${operation} produced tasks longer than ${String(LONG_TASK_THRESHOLD_MS)}ms`).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await installThinkingMocks(page);
  await openSpecular(page);
  await installLongTaskObserver(page);
});

test('@performance core writing interactions produce no task longer than 50 milliseconds', async ({ page }) => {
  await withoutLongTasks(page, 'write', async () => { await page.getByRole('textbox', { name: 'Thought writing block' }).fill('Attention is not certainty.'); });
  await withoutLongTasks(page, 'reflect', async () => { await page.getByRole('button', { name: 'Reflect' }).click(); await expect(page.getByText(/separating attention/iu)).toBeVisible(); });
  await withoutLongTasks(page, 'branch', async () => { await page.getByRole('button', { name: /What exactly can attention justify/iu }).click(); await expect(page.getByText('Working from')).toBeVisible(); });
  await withoutLongTasks(page, 'connections', async () => { await page.getByRole('button', { name: 'Connections' }).click(); await expect(page.getByRole('region', { name: 'Connections' })).toBeVisible(); });
});
