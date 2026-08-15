import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createInitialWorkspace } from './thinking/model';

describe('production Specular bootstrap', () => {
  it('renders the canonical human-owned thinking document after authentication', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (path === '/api/session') {
        return Promise.resolve(new Response(JSON.stringify({
          authenticated: true,
          email: 'writer@example.com',
          cacheNamespace: 'account:test',
          signOutUrl: '/signout-with-chatgpt?return_to=%2F',
        }), { status: 200 }));
      }
      if (path === '/api/workspace') {
        return Promise.resolve(new Response(JSON.stringify({ revision: 0, workspace: createInitialWorkspace(1_800_000_000_000) }), { status: 200 }));
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    }));
    await import('./main');

    expect(await screen.findByRole('button', { name: 'Specular' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Document title' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Thought writing block' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reflect' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Connections' })).toBeVisible();
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
  });
});
