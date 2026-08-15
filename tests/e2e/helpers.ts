import { expect, type Page } from '@playwright/test';
import { createInitialWorkspace, type WorkspaceState } from '../../src/thinking/model';

export interface ThinkingMockController {
  delayWorkspaceLoad(): void;
  delayReflection(): void;
  failNextReflection(): void;
  failNextWorkspaceSave(): void;
  releaseReflection(): void;
  releaseWorkspaceLoad(): void;
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
  let workspaceLoadDelayed = false;
  let workspaceSaveShouldFail = false;
  let reflectionShouldFail = false;
  let release: (() => void) | undefined;
  let releaseWorkspace: (() => void) | undefined;
  let pending = Promise.resolve();
  let pendingWorkspace = Promise.resolve();
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
      if (workspaceSaveShouldFail) {
        workspaceSaveShouldFail = false;
        await route.abort('failed');
        return;
      }
      const body = route.request().postDataJSON() as { workspace: WorkspaceState };
      workspace = body.workspace;
      revision += 1;
      await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({ revision }) });
      return;
    }
    if (workspaceLoadDelayed) {
      await pendingWorkspace;
      workspaceLoadDelayed = false;
    }
    await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({ revision, workspace }) });
  });

  await page.route('**/api/reflect', async (route) => {
    if (delayed) {
      await pending;
      delayed = false;
    }
    if (reflectionShouldFail) {
      reflectionShouldFail = false;
      await route.fulfill({ contentType: 'application/json', status: 503, body: JSON.stringify({ error: 'Reflection is temporarily unavailable.' }) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify(reflection) });
  });
  await page.route('**/api/dictation/transcribe', async (route) => {
    await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({ transcript: 'A synthetic dictated thought.' }) });
  });
  await page.route('**/api/dictation/cleanup', async (route) => {
    await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({ cleaned: 'A synthetic dictated thought.' }) });
  });
  await page.route('**/api/shares', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({ snapshots: [] }) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', status: 201, body: JSON.stringify({ url: '/s/browser-snapshot' }) });
  });
  await page.route('**/api/shares/*', async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({ revoked: true }) });
      return;
    }
    await route.fallback();
  });

  return {
    delayWorkspaceLoad(): void {
      workspaceLoadDelayed = true;
      pendingWorkspace = new Promise<void>((resolve) => { releaseWorkspace = resolve; });
    },
    delayReflection(): void {
      delayed = true;
      pending = new Promise<void>((resolve) => { release = resolve; });
    },
    failNextReflection(): void {
      reflectionShouldFail = true;
    },
    failNextWorkspaceSave(): void {
      workspaceSaveShouldFail = true;
    },
    releaseReflection(): void {
      release?.();
      release = undefined;
    },
    releaseWorkspaceLoad(): void {
      releaseWorkspace?.();
      releaseWorkspace = undefined;
    },
  };
}

export async function openSpecular(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Specular' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Thought writing block' })).toBeVisible();
}

export async function openSpecularPath(page: Page, path: string): Promise<void> {
  await page.route(`**${path}`, async (route) => {
    if (route.request().resourceType() !== 'document') {
      await route.fallback();
      return;
    }
    const root = new URL(route.request().url());
    root.pathname = '/';
    root.search = '';
    const response = await route.fetch({ url: root.toString() });
    await route.fulfill({ response });
  });
  await page.goto(path);
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
    offenders: [...document.querySelectorAll<HTMLElement>('body *')]
      .map((element) => ({
        name: `${element.tagName.toLowerCase()}${element.className.length > 0 ? `.${element.className.split(/\s+/u).join('.')}` : ''}`,
        left: Math.round(element.getBoundingClientRect().left),
        right: Math.round(element.getBoundingClientRect().right),
        scrollWidth: element.scrollWidth,
      }))
      .filter(({ left, right, scrollWidth }) => left < 0 || right > document.documentElement.clientWidth || scrollWidth > document.documentElement.clientWidth)
      .slice(0, 8),
  }));
  const evidence = JSON.stringify(dimensions.offenders);
  expect(dimensions.body, evidence).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.document, evidence).toBeLessThanOrEqual(dimensions.viewport);
}
