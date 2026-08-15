import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeAuthenticationLost } from './authentication-loss';
import { protectedFetch } from './protected-fetch';

describe('protected HTTP requests', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('reports authentication loss before returning a 401 response', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 401 }))));
    const lost = vi.fn();
    const unsubscribe = subscribeAuthenticationLost(lost);

    const response = await protectedFetch('/api/workspace');

    expect(response.status).toBe(401);
    expect(lost).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('can treat a stale workspace generation as authentication loss', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 410 }))));
    const lost = vi.fn();
    const unsubscribe = subscribeAuthenticationLost(lost);

    await protectedFetch('/api/workspace', undefined, [401, 410]);

    expect(lost).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
