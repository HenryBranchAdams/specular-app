import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HttpSharePublisher,
  loadPublishedSnapshot,
  SnapshotAuthenticationRequiredError,
  type PublishedSnapshot,
} from './share-client';

const snapshot: PublishedSnapshot = {
  title: 'A deliberate projection',
  createdAt: 1_800_000_000_000,
  blocks: [{ id: 'block:one', content: 'Canonical writing.', kind: 'thought', references: [] }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('snapshot sharing client', () => {
  it('sends the selected visibility separately from the published writing payload', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(new Response(JSON.stringify({ url: '/s/abcdefghijklmnop' }), { status: 201 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await new HttpSharePublisher().publish(snapshot, 'public');

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.body).toBe(JSON.stringify({ snapshot, visibility: 'public' }));
  });

  it('loads public writing without invoking the protected-session fetch boundary', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(snapshot), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadPublishedSnapshot('abcdefghijklmnop')).resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledWith('/api/shares/abcdefghijklmnop');
  });

  it('distinguishes a signed-in snapshot from an unavailable link', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: 'authentication_required' }), { status: 401 }))));

    await expect(loadPublishedSnapshot('abcdefghijklmnop')).rejects.toBeInstanceOf(SnapshotAuthenticationRequiredError);
  });
});
