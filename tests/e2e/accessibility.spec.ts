import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { installThinkingMocks, openSpecular, openSpecularPath, writeThought } from './helpers';

async function expectAccessible(page: Page, state: string): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const severe = result.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical');
  expect(severe, `${state}: ${severe.map(({ id, help }) => `${id}: ${help}`).join('; ')}`).toEqual([]);
}

test.describe('authenticated workspace states', () => {
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

  test('library and destructive-confirmation states have no serious accessibility violations', async ({ page }) => {
    await writeThought(page, 'Authored writing needs a deliberate deletion boundary.');
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expectAccessible(page, 'account archive and recovery library');
    await page.getByRole('button', { name: 'Close library' }).click();
    await page.getByRole('button', { name: 'Delete block' }).click();
    await expect(page.getByRole('button', { name: 'Confirm delete block' })).toBeVisible();
    await expectAccessible(page, 'delete block confirmation');
  });

  test('authentication loss shields the workspace without serious accessibility violations', async ({ page }) => {
    await page.unroute('**/api/workspace');
    await page.route('**/api/workspace', async (route) => {
      await route.fulfill({ contentType: 'application/json', status: 401, body: JSON.stringify({ error: 'authentication_required' }) });
    });
    const unauthorizedSave = page.waitForResponse((response) => (
      response.url().endsWith('/api/workspace')
      && response.request().method() === 'PUT'
      && response.status() === 401
    ));
    await writeThought(page, 'This sentence must disappear behind the sign-in gate.');
    await unauthorizedSave;

    await expect(page.getByRole('link', { name: 'Sign in with ChatGPT' })).toBeVisible();
    await expect(page.getByText('This sentence must disappear behind the sign-in gate.')).toHaveCount(0);
    await expectAccessible(page, 'authentication lost');
  });
});

test('the signed-out gate has no serious accessibility violations', async ({ page }) => {
  await page.route('**/api/session', async (route) => {
    await route.fulfill({ contentType: 'application/json', status: 401, body: JSON.stringify({ authenticated: false, signInUrl: '/signin-with-chatgpt' }) });
  });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Sign in with ChatGPT' })).toBeVisible();
  await expectAccessible(page, 'signed-out gate');
});

test('hosted snapshot loading, available, empty, and unavailable states have no serious accessibility violations', async ({ page }) => {
  let state: 'available' | 'empty' | 'unavailable' = 'available';
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let firstRequest = true;
  await page.route('**/api/shares/accessible-snapshot', async (route) => {
    if (firstRequest) {
      firstRequest = false;
      await pending;
    }
    if (state === 'unavailable') {
      await route.fulfill({ contentType: 'application/json', status: 404, body: JSON.stringify({ error: 'unavailable' }) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({
      title: 'An accessible synthetic snapshot',
      createdAt: 1_800_000_000_000,
      blocks: state === 'empty' ? [] : [{
        id: 'synthetic:block',
        content: 'A synthetic passage keeps the public reading state testable.',
        kind: 'thought',
        references: [{ id: 'synthetic:reference', author: 'A. Writer', title: 'Synthetic source', url: 'https://example.com/source' }],
      }],
    }) });
  });

  await openSpecularPath(page, '/s/accessible-snapshot');
  await expect(page.getByLabel('Loading snapshot')).toBeVisible();
  await expectAccessible(page, 'hosted snapshot loading');
  release?.();
  await expect(page.getByRole('heading', { name: 'An accessible synthetic snapshot' })).toBeVisible();
  await expectAccessible(page, 'hosted snapshot available with references');

  state = 'empty';
  await page.reload();
  await expect(page.getByText('This snapshot has no published writing.')).toBeVisible();
  await expectAccessible(page, 'hosted snapshot empty');

  state = 'unavailable';
  await page.reload();
  await expect(page.getByRole('heading', { name: /unavailable/iu })).toBeVisible();
  await expectAccessible(page, 'hosted snapshot unavailable');
});

test('an interrupted dictation state has no serious accessibility violations', async ({ page }) => {
  await page.addInitScript(() => {
    class SyntheticTrack extends EventTarget {
      stopped = false;
      stop(): void { this.stopped = true; }
    }
    const track = new SyntheticTrack();
    class SyntheticRecorder extends EventTarget {
      static isTypeSupported(): boolean { return false; }
      mimeType = 'audio/webm';
      state: RecordingState = 'inactive';
      start(): void { this.state = 'recording'; }
      stop(): void {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        this.dispatchEvent(new Event('stop'));
      }
    }
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => Promise.resolve({ getTracks: () => [track], getAudioTracks: () => [track] }) },
    });
    Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: SyntheticRecorder });
  });
  await installThinkingMocks(page);
  await openSpecular(page);
  await page.getByRole('button', { name: 'Start dictation' }).click();
  await expect(page.getByText('Recording · keep Specular open')).toBeVisible();
  await page.evaluate(() => { globalThis.dispatchEvent(new Event('offline')); });
  await expect(page.getByRole('alert')).toContainText('Dictation was interrupted');
  await expectAccessible(page, 'dictation interrupted');
});
