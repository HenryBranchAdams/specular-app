import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBrowserSession } from './session';

const authenticated = {
  authenticated: true,
  email: 'writer@example.com',
  cacheNamespace: 'account:writer',
  signOutUrl: '/signout-with-chatgpt?return_to=%2F',
} as const;

describe('browser session verification', () => {
  afterEach(() => {
    globalThis.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('does not treat a stored prior session as authentication on a cold offline launch', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(authenticated), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))));
    await expect(loadBrowserSession()).resolves.toEqual(authenticated);

    vi.spyOn(globalThis.navigator, 'onLine', 'get').mockReturnValue(false);
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));

    await expect(loadBrowserSession()).rejects.toThrow('offline');
  });

  it('clears cached identity when the server reports an anonymous session', async () => {
    globalThis.localStorage.setItem('specular-authenticated-session', JSON.stringify(authenticated));
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      authenticated: false,
      signInUrl: '/signin-with-chatgpt?return_to=%2F',
    }), { status: 401, headers: { 'content-type': 'application/json' } }))));

    await expect(loadBrowserSession()).resolves.toMatchObject({ authenticated: false });
    expect(globalThis.localStorage.getItem('specular-authenticated-session')).toBeNull();
  });

  it('accepts a successful synthetic anonymous session without opening private content', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      authenticated: false,
      signInUrl: '/signin-with-chatgpt?return_to=%2F',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))));

    await expect(loadBrowserSession()).resolves.toEqual({
      authenticated: false,
      signInUrl: '/signin-with-chatgpt?return_to=%2F',
    });
  });
});
