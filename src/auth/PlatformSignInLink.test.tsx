import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformSignInLink } from './PlatformSignInLink';

afterEach(cleanup);

describe('PlatformSignInLink', () => {
  it('releases stale service workers before navigating to ChatGPT sign in', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const prepareForNavigation = vi.fn(() => {
      order.push('prepare');
      return Promise.resolve();
    });
    const navigate = vi.fn(() => { order.push('navigate'); });
    render(
      <PlatformSignInLink
        href="/signin-with-chatgpt?return_to=%2F"
        navigate={navigate}
        prepareForNavigation={prepareForNavigation}
      >
        Sign in with ChatGPT
      </PlatformSignInLink>,
    );

    await user.click(screen.getByRole('link', { name: 'Sign in with ChatGPT' }));

    expect(prepareForNavigation).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('/signin-with-chatgpt?return_to=%2F');
    expect(order).toEqual(['prepare', 'navigate']);
  });

  it('still attempts sign in if stale-worker cleanup is unavailable', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(
      <PlatformSignInLink
        href="/signin-with-chatgpt?return_to=%2F"
        navigate={navigate}
        prepareForNavigation={() => Promise.reject(new Error('unavailable'))}
      >
        Sign in with ChatGPT
      </PlatformSignInLink>,
    );

    await user.click(screen.getByRole('link', { name: 'Sign in with ChatGPT' }));

    expect(navigate).toHaveBeenCalledWith('/signin-with-chatgpt?return_to=%2F');
  });

  it('leaves modified link clicks to the browser', () => {
    const prepareForNavigation = vi.fn(() => Promise.resolve());
    const navigate = vi.fn();
    render(
      <PlatformSignInLink
        href="/signin-with-chatgpt?return_to=%2F"
        navigate={navigate}
        prepareForNavigation={prepareForNavigation}
      >
        Sign in with ChatGPT
      </PlatformSignInLink>,
    );

    const link = screen.getByRole('link', { name: 'Sign in with ChatGPT' });
    link.addEventListener('click', (event) => { event.preventDefault(); }, { once: true });
    fireEvent.click(link, { metaKey: true });

    expect(prepareForNavigation).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not launch duplicate sign-in handoffs after repeated taps', async () => {
    let finishPreparation: (() => void) | undefined;
    const prepareForNavigation = vi.fn(() => new Promise<void>((resolve) => { finishPreparation = resolve; }));
    const navigate = vi.fn();
    render(
      <PlatformSignInLink
        href="/signin-with-chatgpt?return_to=%2F"
        navigate={navigate}
        prepareForNavigation={prepareForNavigation}
      >
        Sign in with ChatGPT
      </PlatformSignInLink>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Sign in with ChatGPT' }));
    fireEvent.click(screen.getByRole('link', { name: 'Opening ChatGPT…' }));
    finishPreparation?.();

    await waitFor(() => { expect(navigate).toHaveBeenCalledOnce(); });
    expect(prepareForNavigation).toHaveBeenCalledOnce();
  });
});
