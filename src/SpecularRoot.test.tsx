import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpecularRoot } from './SpecularRoot';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  globalThis.history.replaceState({}, '', '/');
});

describe('Specular root routing', () => {
  it('renders a public snapshot without opening the private session boundary', async () => {
    globalThis.history.replaceState({}, '', '/s/abcdefghijklmnop');
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      title: 'A public synthetic snapshot',
      createdAt: 1_800_000_000_000,
      blocks: [],
    }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    render(<SpecularRoot />);

    expect(await screen.findByRole('heading', { name: 'A public synthetic snapshot' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Sign in with ChatGPT' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/shares/abcdefghijklmnop', undefined);
    expect(fetchMock).not.toHaveBeenCalledWith('/api/session', expect.anything());
  });
});
