import { afterEach, describe, expect, it, vi } from 'vitest';
import { releaseServiceWorkersForPlatformAuth } from './platform-auth-navigation';

describe('platform auth navigation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('unregisters every current-origin service worker before platform auth navigation', async () => {
    const firstUnregister = vi.fn(() => Promise.resolve(true));
    const secondUnregister = vi.fn(() => Promise.resolve(true));
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistrations: vi.fn(() => Promise.resolve([
          { unregister: firstUnregister },
          { unregister: secondUnregister },
        ])),
      },
    });

    await releaseServiceWorkersForPlatformAuth();

    expect(firstUnregister).toHaveBeenCalledOnce();
    expect(secondUnregister).toHaveBeenCalledOnce();
  });

  it('does not block sign out when a browser refuses to remove one stale registration', async () => {
    const successfulUnregister = vi.fn(() => Promise.resolve(true));
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistrations: vi.fn(() => Promise.resolve([
          { unregister: vi.fn(() => Promise.reject(new Error('browser refused'))) },
          { unregister: successfulUnregister },
        ])),
      },
    });

    await expect(releaseServiceWorkersForPlatformAuth()).resolves.toBeUndefined();
    expect(successfulUnregister).toHaveBeenCalledOnce();
  });

  it('does not block sign out when registrations cannot be inspected', async () => {
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistrations: vi.fn(() => Promise.reject(new Error('browser refused'))),
      },
    });

    await expect(releaseServiceWorkersForPlatformAuth()).resolves.toBeUndefined();
  });

  it('is a no-op when service workers are unavailable', async () => {
    vi.stubGlobal('navigator', {});

    await expect(releaseServiceWorkersForPlatformAuth()).resolves.toBeUndefined();
  });
});
