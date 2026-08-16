import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, installThinkingMocks, openSpecular, writeThought } from './helpers';

test.beforeEach(async ({ page }) => {
  await installThinkingMocks(page);
  await openSpecular(page);
});

test('blank blocks can be deleted and starters stay behind contextual help', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Explore what I think' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Writing starters' }).click();
  await page.getByRole('button', { name: 'Explore what I think' }).click();
  await expect(page.getByRole('textbox', { name: 'Thought writing block' })).toHaveAttribute(
    'placeholder',
    'Begin with the part you can almost say, but not quite.',
  );

  await page.getByRole('button', { name: 'New block' }).click();
  await expect(page.getByRole('textbox', { name: 'Thought writing block' })).toHaveCount(2);
  const extraBlock = page.getByRole('textbox', { name: 'Thought writing block' }).last().locator('xpath=ancestor::article[1]');
  await extraBlock.getByRole('button', { name: 'Delete block' }).click();
  await expect(page.getByRole('textbox', { name: 'Thought writing block' })).toHaveCount(1);
});

test('writing, reflection, branching, connections, snapshot, and local recovery form one workflow', async ({ page }) => {
  const title = 'Attention without certainty';
  const first = 'Attention can justify another look without becoming proof.';
  const second = 'The obligation is to continue looking, not to pretend the answer is settled.';

  await page.getByRole('textbox', { name: 'Document title' }).fill(title);
  await writeThought(page, first);
  await page.getByRole('button', { name: 'Reflect' }).click();
  await expect(page.getByText(/separating attention from certainty/iu)).toBeVisible();
  await page.getByRole('button', { name: /What exactly can attention justify/iu }).click();

  await expect(page.getByText('Working from')).toBeVisible();
  await expect(page.getByText('What exactly can attention justify if it cannot justify certainty?')).toBeVisible();
  await writeThought(page, second);

  await page.getByRole('button', { name: 'Connections' }).click();
  await expect(page.getByRole('region', { name: 'Connections' }).getByText(first)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Connections' }).getByText(second)).toBeVisible();
  await page.getByRole('button', { name: 'Document' }).click();

  await page.getByRole('button', { name: 'Create snapshot' }).click();
  const snapshot = page.getByRole('dialog', { name: 'Snapshot editor' });
  await expect(snapshot.getByRole('heading', { name: title }).first()).toBeVisible();
  await snapshot.getByRole('button', { name: 'Publish page' }).click();
  await expect(snapshot.getByRole('button', { name: 'Copy link' })).toBeVisible();
  await snapshot.getByRole('button', { name: 'Close snapshot' }).click();

  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Document title' })).toHaveValue(title);
  await expect(page.getByRole('textbox', { name: 'Thought writing block' }).first()).toHaveValue(first);
  await expect(page.getByRole('textbox', { name: 'Thought writing block' }).last()).toHaveValue(second);
  await expectNoHorizontalOverflow(page);
});

test('source metadata remains distinct from authored prose and exports with a snapshot', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Document title' }).fill('A source and my response');
  await page.getByRole('button', { name: 'Attach source' }).click();
  await writeThought(page, 'The source gives attention a role that is weaker than proof but stronger than indifference.');
  await page.getByRole('textbox', { name: 'Reference title' }).fill('Example source');
  await page.getByRole('textbox', { name: 'Reference author' }).fill('A. Writer');
  await page.getByRole('textbox', { name: 'Reference URL' }).fill('https://example.com/source');

  await page.getByRole('button', { name: 'Create snapshot' }).click();
  const snapshot = page.getByRole('dialog', { name: 'Snapshot editor' });
  await expect(snapshot.getByRole('textbox', { name: 'Snapshot title' })).toHaveCSS('border-top-color', 'rgb(95, 98, 102)');
  expect(await snapshot.getByRole('checkbox').first().evaluate((element) => getComputedStyle(element).accentColor)).toBe('rgb(2, 116, 182)');
  const download = page.waitForEvent('download');
  await snapshot.getByRole('button', { name: 'Markdown' }).click();
  expect((await download).suggestedFilename()).toBe('a-source-and-my-response.md');
});

test('workspace scope and dormancy remain explicit user controls', async ({ page }) => {
  await writeThought(page, 'The first document has one thought.');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('combobox', { name: 'Dormancy period' }).selectOption('30');
  await page.getByRole('button', { name: 'New document' }).click();
  await writeThought(page, 'The second document carries another thought.');
  await page.getByRole('button', { name: 'Connections' }).click();
  const connections = page.getByRole('region', { name: 'Connections' });
  await expect(connections.getByText('The first document has one thought.')).toHaveCount(0);
  await connections.getByRole('combobox', { name: 'Connections scope' }).selectOption('workspace');
  await expect(connections.getByText('The first document has one thought.')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('drawer and snapshot remain operable in a narrow-height viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await writeThought(page, 'A compact viewport still needs every author action.');

  const libraryTrigger = page.getByRole('button', { name: 'Library' });
  await libraryTrigger.click();
  const library = page.getByRole('dialog', { name: 'Document library' });
  await expect(library.getByRole('button', { name: 'Close library' })).toBeFocused();
  await expect(library.getByRole('button', { name: 'New document' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(libraryTrigger).toBeFocused();

  const snapshotTrigger = page.getByRole('button', { name: 'Create snapshot' });
  await snapshotTrigger.click();
  const snapshot = page.getByRole('dialog', { name: 'Snapshot editor' });
  await expect(snapshot.getByRole('button', { name: 'Close snapshot' })).toBeFocused();
  await expect(snapshot.getByRole('button', { name: 'Publish page' })).toBeAttached();
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await expect(snapshotTrigger).toBeFocused();
});
