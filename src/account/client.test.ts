import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteHostedAccount,
  downloadAccountArchive,
  downloadDeviceRecovery,
} from './client';
import { createInitialWorkspace } from '../thinking/model';

describe('account archive and deletion client', () => {
  let click: ReturnType<typeof vi.spyOn>;
  let createObjectURL: ReturnType<typeof vi.spyOn>;
  let downloadedBlob: Blob | null;

  beforeEach(() => {
    click = vi.spyOn(globalThis.HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    downloadedBlob = null;
    createObjectURL = vi.spyOn(globalThis.URL, 'createObjectURL').mockImplementation((blob) => {
      if (blob instanceof Blob) downloadedBlob = blob;
      return 'blob:account-download';
    });
    vi.spyOn(globalThis.URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('downloads the server-authoritative archive through the protected route', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('archive', { status: 200 })));
    vi.stubGlobal('fetch', fetch);

    await downloadAccountArchive();

    expect(fetch).toHaveBeenCalledWith('/api/archive', undefined);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
  });

  it('creates a device recovery without interlocutor annotations', async () => {
    const workspace = createInitialWorkspace(1_800_000_000_000);
    workspace.annotations.push({
      id: 'annotation:private',
      documentId: workspace.documents[0]?.id ?? 'document:missing',
      blockId: workspace.blocks[0]?.id ?? 'block:missing',
      focus: 'The authored focus',
      move: 'reflect',
      mirror: 'Ephemeral interlocutor material',
      directions: [{ label: 'Continue', prompt: 'Continue in your own words.', move: 'reflect' }],
      referencedBlockIds: [],
      sources: [],
      calibration: [],
      status: 'open',
      createdAt: 1_800_000_000_000,
      updatedAt: 1_800_000_000_000,
    });

    downloadDeviceRecovery(workspace);

    expect(downloadedBlob).toBeInstanceOf(Blob);
    if (!(downloadedBlob instanceof Blob)) throw new Error('Expected a device recovery blob.');
    const archiveBlob = downloadedBlob;
    const archiveText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new Error('Device recovery did not contain text.'));
      }, { once: true });
      reader.addEventListener('error', () => { reject(reader.error ?? new Error('Could not read recovery.')); }, { once: true });
      reader.readAsText(archiveBlob);
    });
    expect(archiveText).toContain('"format": "specular-device-recovery"');
    expect(archiveText).not.toContain('Ephemeral interlocutor material');
    expect(click).toHaveBeenCalledOnce();
  });

  it('sends account deletion only with explicit mutation intent', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetch);

    await deleteHostedAccount();

    expect(fetch).toHaveBeenCalledWith('/api/account', {
      method: 'DELETE',
      headers: { 'x-specular-intent': 'mutate' },
    });
  });

  it('keeps archive and deletion failures explicit', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 503 }))));

    await expect(downloadAccountArchive()).rejects.toThrow('prepare your archive');
    await expect(deleteHostedAccount()).rejects.toThrow('delete this account workspace');
  });
});
