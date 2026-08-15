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
