import { expect, test } from '@playwright/test';
import { installThinkingMocks, openSpecular, writeThought } from './helpers';

test('Library distinguishes publication loading, empty, failure, retry, and revoke states', async ({ page }) => {
  await installThinkingMocks(page);
  await page.unroute('**/api/shares');
  let listState: 'pending-empty' | 'failure' | 'ready' = 'pending-empty';
  let releaseList: (() => void) | undefined;
  const pendingList = new Promise<void>((resolve) => { releaseList = resolve; });
  let releaseRevoke: (() => void) | undefined;
  const pendingRevoke = new Promise<void>((resolve) => { releaseRevoke = resolve; });

  await page.route('**/api/shares', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    if (listState === 'pending-empty') await pendingList;
    if (listState === 'failure') {
      await route.fulfill({ contentType: 'application/json', status: 503, body: JSON.stringify({ error: 'unavailable' }) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({
      snapshots: listState === 'ready'
        ? [{ slug: 'abcdefghijklmnop', title: 'A published edge', createdAt: 1_800_000_000_000, revokedAt: null }]
        : [],
    }) });
  });
  await page.route('**/api/shares/abcdefghijklmnop', async (route) => {
    await pendingRevoke;
    await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({ revoked: true }) });
  });

  await openSpecular(page);
  const trigger = page.getByRole('button', { name: 'Library', exact: true });
  await trigger.click();
  const library = page.getByRole('dialog', { name: 'Document library' });
  await expect(library.getByLabel('Published links status')).toContainText('Loading published links');
  releaseList?.();
  await expect(library.getByText('No published links yet.')).toBeVisible();

  await library.getByRole('button', { name: 'Close library' }).click();
  listState = 'failure';
  await trigger.click();
  await expect(library.getByRole('alert')).toContainText('could not load your published links');

  listState = 'ready';
  await library.getByRole('button', { name: 'Retry published links' }).click();
  await expect(library.getByText('A published edge')).toBeVisible();
  await library.getByRole('button', { name: 'Revoke' }).click();
  await expect(library.getByRole('button', { name: 'Revoking…' })).toBeDisabled();
  releaseRevoke?.();
  await expect(library.getByLabel('Library status')).toHaveText('Published link revoked.');
  await expect(library.getByText('Revoked', { exact: true })).toBeVisible();
});

test('snapshot publication and revocation expose action-specific progress and success', async ({ page }) => {
  await installThinkingMocks(page);
  await page.unroute('**/api/shares');
  await page.unroute('**/api/shares/*');
  let releasePublish: (() => void) | undefined;
  const pendingPublish = new Promise<void>((resolve) => { releasePublish = resolve; });
  let releaseRevoke: (() => void) | undefined;
  const pendingRevoke = new Promise<void>((resolve) => { releaseRevoke = resolve; });

  await page.route('**/api/shares', async (route) => {
    await pendingPublish;
    await route.fulfill({ contentType: 'application/json', status: 201, body: JSON.stringify({ url: '/s/abcdefghijklmnop' }) });
  });
  await page.route('**/api/shares/abcdefghijklmnop', async (route) => {
    await pendingRevoke;
    await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({ revoked: true }) });
  });

  await openSpecular(page);
  await page.getByRole('textbox', { name: 'Document title' }).fill('A deliberate publication');
  await writeThought(page, 'Publication should expose what Specular is doing without implying completion early.');
  await page.getByRole('button', { name: 'Create snapshot' }).click();
  const snapshot = page.getByRole('dialog', { name: 'Snapshot editor' });

  await snapshot.getByRole('button', { name: 'Publish page' }).click();
  await expect(snapshot.getByRole('button', { name: 'Publishing page…' })).toBeDisabled();
  releasePublish?.();
  await expect(snapshot.getByLabel('Snapshot status')).toHaveText('Page published. Link ready to copy.');

  await snapshot.getByRole('button', { name: 'Revoke link' }).click();
  await expect(snapshot.getByRole('button', { name: 'Revoking link…' })).toBeDisabled();
  releaseRevoke?.();
  await expect(snapshot.getByLabel('Snapshot status')).toHaveText('Published link revoked.');
  await expect(snapshot.getByRole('button', { name: 'Copy link' })).toHaveCount(0);
});
