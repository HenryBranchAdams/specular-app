import { expect, test } from '@playwright/test';
import {
  expectNoHorizontalOverflow,
  installOperationMocks,
  openSpecular,
  submitThought,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await installOperationMocks(page);
  await openSpecular(page);
});

test('first run, delayed persistence, reload, challenge, conclusion, and continued development', async ({ page }) => {
  await expect(page.getByRole('list', { name: 'Ways to begin' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Something unfinished.' })).toBeVisible();
  const mocks = await installOperationMocks(page);
  mocks.delayNextQuestion();

  const thought = 'The launch handoff is still the constraint.';
  await page.getByRole('textbox', { name: 'Idea, context, or response' }).fill(thought);
  await page.getByRole('button', { name: 'Send input' }).click();
  await expect(page.getByText(thought, { exact: true })).toBeVisible();
  mocks.releaseNextQuestion();
  await expect(page.getByText(
    'Which concrete signal would show the launch handoff is working?',
  )).toBeVisible();
  await page.reload();
  await expect(page.getByText(thought, { exact: true })).toBeVisible();
  await expect(page.getByText(
    'Which concrete signal would show the launch handoff is working?',
  )).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gather this thread' })).toHaveCount(0);
  const hierarchy = await page.locator('.transcript').evaluate((transcript) => {
    const user = transcript.querySelector<HTMLElement>('.turn--latest-user .turn__content');
    const question = transcript.querySelector<HTMLElement>('.turn--current .turn__content');
    if (user === null || question === null) {
      throw new Error('Expected a latest user turn and current Specular question.');
    }
    return {
      questionSize: Number.parseFloat(getComputedStyle(question).fontSize),
      userSize: Number.parseFloat(getComputedStyle(user).fontSize),
    };
  });
  expect(hierarchy.userSize).toBeGreaterThan(hierarchy.questionSize);

  await page.getByRole('button', { name: 'Test this' }).click();
  await expect(page.getByText(
    'Which stakeholder absorbs the cost if the launch assumption fails?',
  )).toBeVisible();
  await page.getByRole('textbox', { name: 'Idea, context, or response' })
    .fill('The owner needs to be visible at the handoff itself.');
  await page.getByRole('button', { name: 'Send input' }).click();
  await page.getByRole('button', { name: 'Gather this thread' }).click();
  const thesis = page.getByRole('textbox', { name: 'Working position' });
  await expect(thesis).toBeVisible();
  await thesis.fill('My edited read keeps ownership provisional and testable.');
  await page.getByRole('button', { name: 'Return to thread' }).click();
  await expect(page.getByRole('log', { name: 'Conversation history' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('capsule edit, export, permanent deletion, Save & finish, and a clean new thread', async ({ page }) => {
  await submitThought(page, 'The launch handoff is still the constraint.');
  await page.getByRole('textbox', { name: 'Idea, context, or response' })
    .fill('The owner should be named before the handoff begins.');
  await page.getByRole('button', { name: 'Send input' }).click();
  await page.getByRole('button', { name: 'Gather this thread' }).click();
  await page.getByRole('textbox', { name: 'Working position' })
    .fill('My edited capsule thesis is still provisional.');
  await page.getByRole('button', { name: 'Save as capsule' }).click();
  await expect(page.getByText('Capsule saved.')).toBeVisible();

  await page.getByRole('button', { name: /Open capsule library/u }).click();
  await page.getByRole('button', { name: /The launch handoff is still the constraint,/u }).click();
  const capsuleThesis = page.getByRole('dialog', { name: 'Capsules' })
    .getByRole('textbox', { name: 'Working position' });
  await capsuleThesis.fill('A locally edited capsule thesis.');
  await page.getByRole('button', { name: 'Save capsule edits' }).click();
  await expect(page.getByRole('dialog', { name: 'Capsules' }).getByText('Capsule updated.'))
    .toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^specular-export-\d{4}-\d{2}-\d{2}\.json$/u);

  await page.getByRole('button', { name: 'Permanently delete capsule' }).click();
  const confirmation = page.getByRole('alertdialog', { name: /Permanently delete/u });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Permanently delete capsule' }).click();
  await expect(page.getByText('No capsules yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Close capsule library' }).click();

  await page.getByRole('button', { name: 'Save & finish' }).click();
  await expect(page.getByRole('list', { name: 'Ways to begin' })).toBeVisible();
  await expect(page.getByText('The launch handoff is still the constraint.')).toHaveCount(0);
});

test('offline retry, microphone denial, reduced motion, keyboard flow, scaling, and safe areas', async ({
  browserName,
  context,
  page,
}) => {
  await context.setOffline(true);
  const thought = 'Keep this writing through an offline failure.';
  await page.getByRole('textbox', { name: 'Idea, context, or response' }).fill(thought);
  await page.getByRole('button', { name: 'Send input' }).click();
  await expect(page.getByText(thought, { exact: true })).toBeVisible();
  const recovery = page.getByRole('group', { name: 'Saved thought recovery' });
  await expect(recovery).toContainText('Not sent');
  await context.setOffline(false);
  await recovery.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText(
    'Which concrete signal would show the launch handoff is working?',
  )).toBeVisible();

  await page.route('**/api/realtime/session', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      status: 200,
      body: JSON.stringify({
        value: 'ephemeral-test-key',
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      }),
    });
  });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () => Promise.reject(new DOMException('Denied for test.', 'NotAllowedError')),
      },
    });
  });
  await page.getByRole('button', { name: 'Start voice' }).click();
  await expect(page.getByRole('alert')).toContainText(/Microphone|Voice/iu);
  await expect(page.getByRole('textbox', { name: 'Idea, context, or response' })).toBeFocused();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('status', { name: 'Voice status' })).toHaveText(/Voice/iu);
  await page.addStyleTag({ content: ':root { font-size: 200% !important; }' });
  await expectNoHorizontalOverflow(page);

  await page.getByRole('textbox', { name: 'Idea, context, or response' }).focus();
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(page.getByRole('button', { name: 'Start voice' })).toBeFocused();
  const focusStyle = await page.getByRole('button', { name: 'Start voice' }).evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.outlineColor, style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(focusStyle.style).not.toBe('none');
  expect(focusStyle.width).toBeGreaterThanOrEqual(2);
  expect(focusStyle.color).not.toBe('transparent');
  await page.addStyleTag({
    content: ':root { --safe-area-top: 24px; --safe-area-right: 24px; --safe-area-bottom: 24px; --safe-area-left: 24px; }',
  });
  const dock = await page.locator('.interaction-dock').boundingBox();
  const viewport = page.viewportSize();
  expect(dock).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(dock?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((dock?.x ?? 0) + (dock?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0);
});

test('starter surface remains still under every motion preference', async ({ page }) => {
  const starter = page.locator('.starter-lead');
  await expect(starter).toBeVisible();
  expect(await starter.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.locator('.starter-cues[data-motion="static"]')).toBeVisible();
  const staticStyle = await page.locator('.starter-cues__item').first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { durationSeconds: Number.parseFloat(style.animationDuration), transform: style.transform };
  });
  expect(staticStyle.durationSeconds).toBeLessThanOrEqual(0.001);
  expect(staticStyle.transform).toBe('none');

  const composer = page.getByRole('textbox', { name: 'Idea, context, or response' });
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press('Tab');
    if (await composer.evaluate((element) => document.activeElement === element)) {
      break;
    }
  }
  await expect(composer).toBeFocused();
  const readComposerDatum = async () => page.locator('.composer').evaluate((element) => {
    const style = getComputedStyle(element, '::before');
    return {
      color: style.backgroundColor,
      height: Number.parseFloat(style.height),
    };
  });
  await expect.poll(async () => (await readComposerDatum()).height).toBeGreaterThanOrEqual(2);
  const composerDatum = await readComposerDatum();
  expect(composerDatum.height).toBeGreaterThanOrEqual(2);
  expect(composerDatum.color).not.toBe('transparent');

  await page.addStyleTag({ content: ':root { font-size: 200% !important; }' });
  const rows = await page.locator('.starter-cues__item').evaluateAll((elements) => (
    elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      return { bottom: bounds.bottom, height: bounds.height, top: bounds.top };
    })
  ));
  expect(rows).toHaveLength(3);
  for (const [index, row] of rows.entries()) {
    expect(row.height).toBeGreaterThanOrEqual(44);
    if (index > 0) {
      expect(row.top).toBeGreaterThanOrEqual((rows[index - 1]?.bottom ?? 0) - 1);
    }
  }
  await expectNoHorizontalOverflow(page);
});
