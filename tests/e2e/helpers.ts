import { expect, type Page } from '@playwright/test';
import { createInitialWorkspace, type WorkspaceState } from '../../src/thinking/model';

export interface ThinkingMockController {
  delayReflection(): void;
  releaseReflection(): void;
}

const reflection = {
  mirror: 'You are separating attention from certainty without yet saying what attention warrants.',
  directions: [
    { label: 'Name the distinction', prompt: 'What exactly can attention justify if it cannot justify certainty?', move: 'distinguish' },
    { label: 'Follow the implication', prompt: 'What changes when you treat attention as a reason to continue rather than a verdict?', move: 'implications' },
  ],
  referencedBlockIds: ['block:browser'],
  sources: [],
};

export async function installThinkingMocks(page: Page): Promise<ThinkingMockController> {
  let delayed = false;
  let release: (() => void) | undefined;
  let pending = Promise.resolve();
  let workspace: WorkspaceState = createInitialWorkspace(1_800_000_000_000);
  let revision = 0;

  await page.route('**/api/session', async (route) => {
    await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({
      authenticated: true,
      email: 'browser@example.com',
      cacheNamespace: 'account:browser',
      signOutUrl: '/signout-with-chatgpt?return_to=%2F',
    }) });
  });
  await page.route('**/api/workspace', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { workspace: WorkspaceState };
      workspace = body.workspace;
      revision += 1;
      await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({ revision }) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({ revision, workspace }) });
  });

  await page.route('**/api/reflect', async (route) => {
    if (delayed) {
      await pending;
      delayed = false;
    }
    await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify(reflection) });
  });
  await page.route('**/api/shares', async (route) => {
    await route.fulfill({ contentType: 'application/json', status: 201, body: JSON.stringify({ url: '/s/browser-snapshot' }) });
  });

  return {
    delayReflection(): void {
      delayed = true;
      pending = new Promise<void>((resolve) => { release = resolve; });
    },
    releaseReflection(): void {
      release?.();
      release = undefined;
    },
  };
}

export async function openSpecular(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Specular' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Thought writing block' })).toBeVisible();
}

export async function writeThought(page: Page, thought: string): Promise<void> {
  const block = page.getByRole('textbox', { name: /writing block$/u }).last();
  await block.fill(thought);
  await block.blur();
  await expect(block).toHaveValue(thought);
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
}
