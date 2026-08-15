import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionBoundary } from './SessionBoundary';

afterEach(cleanup);

describe('authenticated workspace boundary', () => {
  it('never renders private workspace content for an anonymous session', async () => {
    render(
      <SessionBoundary loadSession={vi.fn(() => Promise.resolve({
        authenticated: false as const,
        signInUrl: '/signin-with-chatgpt?return_to=%2F',
      }))}>
        {() => <p>private workspace content</p>}
      </SessionBoundary>,
    );

    expect(await screen.findByRole('link', { name: 'Sign in with ChatGPT' })).toHaveAttribute(
      'href',
      '/signin-with-chatgpt?return_to=%2F',
    );
    expect(screen.queryByText('private workspace content')).not.toBeInTheDocument();
  });

  it('renders the workspace only after a signed-in session is confirmed', async () => {
    render(
      <SessionBoundary loadSession={vi.fn(() => Promise.resolve({
        authenticated: true as const,
        email: 'writer@example.com',
        cacheNamespace: 'account:writer',
        signOutUrl: '/signout-with-chatgpt?return_to=%2F',
      }))}>
        {(session) => <p>Workspace for {session.email}</p>}
      </SessionBoundary>,
    );

    expect(await screen.findByText('Workspace for writer@example.com')).toBeVisible();
  });

  it('fails closed when the session cannot be verified', async () => {
    render(
      <SessionBoundary loadSession={vi.fn(() => Promise.reject(new Error('offline')))}>
        {() => <p>private workspace content</p>}
      </SessionBoundary>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('could not verify your ChatGPT session');
    expect(screen.queryByText('private workspace content')).not.toBeInTheDocument();
  });

  it('locks private content when a focused window no longer has the same authenticated session', async () => {
    const loadSession = vi.fn()
      .mockResolvedValueOnce({
        authenticated: true as const,
        email: 'writer@example.com',
        cacheNamespace: 'account:writer',
        signOutUrl: '/signout-with-chatgpt?return_to=%2F',
      })
      .mockResolvedValueOnce({
        authenticated: false as const,
        signInUrl: '/signin-with-chatgpt?return_to=%2F',
      });
    render(
      <SessionBoundary loadSession={loadSession}>
        {() => <p>private workspace content</p>}
      </SessionBoundary>,
    );
    expect(await screen.findByText('private workspace content')).toBeVisible();

    fireEvent.focus(globalThis.window);

    expect(await screen.findByRole('link', { name: 'Sign in with ChatGPT' })).toBeVisible();
    expect(screen.queryByText('private workspace content')).not.toBeInTheDocument();
    await waitFor(() => { expect(loadSession).toHaveBeenCalledTimes(2); });
  });
});
