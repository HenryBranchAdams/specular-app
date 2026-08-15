import { expect, test } from '@playwright/test';
import { createTestHarness, type TestHarness } from 'wrangler';

let harness: TestHarness;
let baseUrl: URL;

const AUTHOR_HEADERS = {
  'oai-authenticated-user-id': 'synthetic-browser-author-a',
  'oai-authenticated-user-email': 'browser-author-a@example.test',
} as const;

async function prepareDatabase() {
  await harness.getWorker().applyD1Migrations('DB');
}

test.beforeAll(async () => {
  harness = createTestHarness({
    root: process.cwd(),
  workers: [{ configPath: './dist/server/wrangler.json', secrets: { OPENAI_API_KEY: '' } }],
  });
  ({ url: baseUrl } = await harness.listen());
  await prepareDatabase();
});

test.afterEach(async () => {
  await harness.reset();
  ({ url: baseUrl } = await harness.listen());
  await prepareDatabase();
});

test.afterAll(async () => {
  await harness.close();
});

test('canonical writing persists through the browser, built Worker, and D1', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: baseUrl.toString(),
    extraHTTPHeaders: AUTHOR_HEADERS,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  try {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Specular' })).toBeVisible();
    await expect(page.getByText('browser-author-a@example.test')).toBeVisible();

    const saveReachedD1 = page.waitForResponse((response) => (
      response.url().endsWith('/api/workspace')
      && response.request().method() === 'PUT'
      && response.status() === 200
    ));
    await page.getByRole('textbox', { name: 'Document title' }).fill('A real integration thought');
    await page.getByRole('textbox', { name: 'Thought writing block' }).fill('This writing crossed the browser, Worker, and D1 boundaries.');
    await page.getByRole('textbox', { name: 'Thought writing block' }).blur();
    await saveReachedD1;
    await expect(page.getByText('Saved')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Document title' })).toHaveValue('A real integration thought');
    await expect(page.getByRole('textbox', { name: 'Thought writing block' })).toHaveValue(
      'This writing crossed the browser, Worker, and D1 boundaries.',
    );
  } finally {
    await context.close();
  }
});
