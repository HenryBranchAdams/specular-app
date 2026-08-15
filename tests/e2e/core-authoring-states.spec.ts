import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, installThinkingMocks, openSpecular, writeThought } from './helpers';

test('workspace loading resolves into the canonical document without exposing stale content', async ({ page }) => {
  const mocks = await installThinkingMocks(page);
  mocks.delayWorkspaceLoad();
  await page.goto('/');
  await expect(page.getByLabel('Opening private workspace')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Thought writing block' })).toHaveCount(0);

  mocks.releaseWorkspaceLoad();
  await expect(page.getByRole('textbox', { name: 'Thought writing block' })).toBeVisible();
  await expect(page.getByLabel('Opening private workspace')).toHaveCount(0);
});

test('canonical block actions announce their result and leave focus on writing', async ({ page }) => {
  await installThinkingMocks(page);
  await openSpecular(page);

  await page.getByRole('button', { name: 'New block' }).click();
  const blocks = page.getByRole('textbox', { name: 'Thought writing block' });
  await expect(blocks).toHaveCount(2);
  await expect(blocks.last()).toBeFocused();
  await expect(page.getByRole('status', { name: 'Workspace status' })).toHaveText('New writing block added.');

  const secondBlock = blocks.last().locator('xpath=ancestor::article[1]');
  await secondBlock.getByRole('button', { name: 'Delete block' }).click();
  await expect(blocks).toHaveCount(1);
  await expect(blocks.first()).toBeFocused();
  await expect(page.getByRole('status', { name: 'Workspace status' })).toHaveText('Writing block deleted.');
});

test('offline writing remains device-safe and recovers synchronization without losing authorship', async ({ page }) => {
  const mocks = await installThinkingMocks(page);
  await openSpecular(page);
  mocks.failNextWorkspaceSave();
  await writeThought(page, 'Synthetic writing remains canonical while the network is unavailable.');
  await expect(page.locator('.sync-status')).toHaveText('Saved on this device');

  await page.evaluate(() => { globalThis.dispatchEvent(new Event('online')); });
  await expect(page.locator('.sync-status')).toHaveText('Saved');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Thought writing block' })).toHaveValue('Synthetic writing remains canonical while the network is unavailable.');
});

test('reflection loading, calibration, saved, and failure states stay distinct', async ({ page }) => {
  const mocks = await installThinkingMocks(page);
  await openSpecular(page);
  await writeThought(page, 'Attention can justify another look without becoming certainty.');

  mocks.delayReflection();
  await page.getByRole('button', { name: 'Reflect' }).click();
  await expect(page.getByRole('button', { name: 'Reflecting…' })).toBeDisabled();
  mocks.releaseReflection();
  await expect(page.getByText(/separating attention from certainty/iu)).toBeVisible();
  await expect(page.getByRole('status', { name: 'Workspace status' })).toHaveText('Reflection ready.');

  await page.getByRole('textbox', { name: "Correct Specular's understanding" }).fill('Attention is a reason to continue looking.');
  await page.getByRole('button', { name: 'Respond' }).click();
  await expect(page.getByRole('status', { name: 'Workspace status' })).toHaveText('Reflection updated from your clarification.');
  await page.getByRole('button', { name: 'Save for later' }).click();
  await expect(page.getByRole('status', { name: 'Workspace status' })).toHaveText('Reflection saved for later.');

  await page.getByRole('button', { name: 'Dismiss reflection' }).click();
  mocks.failNextReflection();
  await page.getByRole('button', { name: 'Reflect' }).click();
  await expect(page.getByRole('alert')).toContainText(/reflect/iu);
});

test('extreme canonical content and filtered-empty connections remain legible at narrow 200 percent scale', async ({ page }) => {
  await installThinkingMocks(page);
  await openSpecular(page);
  const sentence = 'A long synthetic thought tests wrapping, authorship, and calm reading without using private content. ';
  const extreme = sentence.repeat(45);
  await page.getByRole('textbox', { name: 'Document title' }).fill('A deliberately long synthetic title that still wraps without taking over the workspace');
  await writeThought(page, extreme);

  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect(page.getByRole('textbox', { name: 'Thought writing block' })).toHaveValue(extreme);
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Connections' }).click();
  const connections = page.getByRole('region', { name: 'Connections' });
  await expect(connections.getByText(/A long synthetic thought tests wrapping/u)).toBeVisible();
  await connections.getByRole('combobox', { name: 'Filter connections by status' }).selectOption('dormant');
  await expect(connections.getByText('No connections match these filters.')).toBeVisible();
  await expect(page.getByRole('status', { name: 'Workspace status' })).toHaveText('No connections match these filters.');
  await expectNoHorizontalOverflow(page);
});

test('dictation review stays provisional until Keep and then returns focus to canonical writing', async ({ page }) => {
  await page.addInitScript(() => {
    class SyntheticTrack extends EventTarget {
      stop(): void { /* synthetic no-op */ }
    }
    const track = new SyntheticTrack();
    class SyntheticRecorder extends EventTarget {
      static isTypeSupported(): boolean { return false; }
      mimeType = 'audio/webm';
      state: RecordingState = 'inactive';
      start(): void { this.state = 'recording'; }
      stop(): void {
        if (this.state === 'inactive') return;
        const data = new Event('dataavailable');
        Object.defineProperty(data, 'data', { value: new Blob(['synthetic audio'], { type: this.mimeType }) });
        this.dispatchEvent(data);
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

  const canonical = page.getByRole('textbox', { name: 'Thought writing block' });
  await canonical.focus();
  await page.getByRole('button', { name: 'Start dictation' }).click();
  await page.getByRole('button', { name: 'Finish dictation' }).click();
  await expect(page.getByRole('textbox', { name: 'Dictation draft' })).toHaveValue('A synthetic dictated thought.');
  await expect(canonical).toHaveValue('');

  await page.getByRole('button', { name: 'Keep dictation' }).click();
  await expect(canonical).toHaveValue('A synthetic dictated thought.');
  await expect(canonical).toBeFocused();
  await expect(page.getByRole('status', { name: 'Workspace status' })).toHaveText('Dictation added to writing.');
});
