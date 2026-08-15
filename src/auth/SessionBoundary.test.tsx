import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionBoundary } from './SessionBoundary';
import { reportAuthenticationLost } from './authentication-loss';

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

  it('revalidates before a restored page can keep showing private content', async () => {
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

    fireEvent(globalThis.window, new Event('pageshow'));

    expect(await screen.findByRole('link', { name: 'Sign in with ChatGPT' })).toBeVisible();
    expect(screen.queryByText('private workspace content')).not.toBeInTheDocument();
    await waitFor(() => { expect(loadSession).toHaveBeenCalledTimes(2); });
  });

  it('shields private content immediately when a protected request loses authentication', async () => {
    const neverResolves = new Promise<never>(() => undefined);
    const loadSession = vi.fn()
      .mockResolvedValueOnce({
        authenticated: true as const,
        email: 'writer@example.com',
        cacheNamespace: 'account:writer',
        signOutUrl: '/signout-with-chatgpt?return_to=%2F',
      })
      .mockReturnValueOnce(neverResolves);
    render(
      <SessionBoundary loadSession={loadSession}>
        {() => <p>private workspace content</p>}
      </SessionBoundary>,
    );
    expect(await screen.findByText('private workspace content')).toBeVisible();

    act(() => { reportAuthenticationLost(); });

    expect(await screen.findByRole('link', { name: 'Sign in with ChatGPT' })).toBeVisible();
    expect(screen.queryByText('private workspace content')).not.toBeInTheDocument();
    await waitFor(() => { expect(loadSession).toHaveBeenCalledTimes(2); });
  });

  it('keeps an already verified open workspace available during a temporary disconnection', async () => {
    const loadSession = vi.fn()
      .mockResolvedValueOnce({
        authenticated: true as const,
        email: 'writer@example.com',
        cacheNamespace: 'account:writer',
        signOutUrl: '/signout-with-chatgpt?return_to=%2F',
      })
      .mockRejectedValueOnce(new TypeError('offline'));
    render(
      <SessionBoundary loadSession={loadSession}>
        {() => <p>private workspace content</p>}
      </SessionBoundary>,
    );
    expect(await screen.findByText('private workspace content')).toBeVisible();
    vi.spyOn(globalThis.navigator, 'onLine', 'get').mockReturnValue(false);

    fireEvent.focus(globalThis.window);

    expect(screen.getByText('private workspace content')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(loadSession).toHaveBeenCalledOnce();
  });
});
