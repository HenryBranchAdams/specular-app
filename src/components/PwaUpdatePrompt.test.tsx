/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  act,
  cleanup,
  render,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import { PwaUpdatePrompt } from './PwaUpdatePrompt';

const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');

function remFontSize(selector: string): number {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const rule = new RegExp(`${escapedSelector}\\s*\\{[^}]*font-size:\\s*(\\d+(?:\\.\\d+)?)rem;`, 'u');
  const match = styles.match(rule);
  if (match?.[1] === undefined) {
    throw new Error(`Expected ${selector} to declare a rem font size.`);
  }
  return Number.parseFloat(match[1]);
}

const pwaHarness = vi.hoisted(() => ({
  options: undefined as RegisterSWOptions | undefined,
  updateServiceWorker: vi.fn(() => Promise.resolve()),
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW(options?: RegisterSWOptions) {
    pwaHarness.options = options;
    return {
      needRefresh: [false, vi.fn()],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: pwaHarness.updateServiceWorker,
    };
  },
}));

function announceNeedRefresh(): void {
  act(() => {
    pwaHarness.options?.onNeedRefresh?.();
  });
}

function announceOfflineReady(): void {
  act(() => {
    pwaHarness.options?.onOfflineReady?.();
  });
}

describe('PwaUpdatePrompt', () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  beforeEach(() => {
    pwaHarness.options = undefined;
    pwaHarness.updateServiceWorker.mockClear();
  });

  it('keeps prompt messages at the minimum body type size', () => {
    expect(remFontSize('.pwa-prompt__message')).toBeGreaterThanOrEqual(1);
  });

  it('keeps prompt controls at the minimum body type size', () => {
    expect(remFontSize('.pwa-prompt__button')).toBeGreaterThanOrEqual(1);
  });

  it('uses a compact overlay without reflowing the application shell', () => {
    expect(styles).not.toContain('#root:has(.pwa-prompt)');
    expect(styles).toMatch(/\.pwa-prompt\s*\{[^}]*bottom:/u);
    expect(styles).toContain('env(safe-area-inset-bottom');
    expect(styles).toMatch(/\.pwa-prompt__button\s*\{[^}]*white-space:\s*nowrap;/u);
  });

  it('offers an accessible update choice without stealing focus', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Keep working</button>
        <PwaUpdatePrompt />
      </>,
    );

    const keepWorking = screen.getByRole('button', { name: 'Keep working' });
    keepWorking.focus();
    announceNeedRefresh();

    expect(screen.getByRole('status', { name: 'Application update' })).toBeVisible();
    expect(screen.getByText('Update available')).toBeVisible();
    expect(screen.getByText(/saves your current work before refreshing/iu)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Update now' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Later' })).toBeVisible();
    expect(keepWorking).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('status', { name: 'Application update' })).not.toBeInTheDocument();

    announceNeedRefresh();
    await user.click(screen.getByRole('button', { name: 'Update now' }));

    expect(pwaHarness.updateServiceWorker).toHaveBeenCalledOnce();
    expect(pwaHarness.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('announces offline readiness and lets the user dismiss it', async () => {
    const user = userEvent.setup();
    render(<PwaUpdatePrompt />);

    announceOfflineReady();

    expect(screen.getByRole('status', { name: 'Offline availability' })).toBeVisible();
    expect(screen.getByText('Available offline')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('status', { name: 'Offline availability' })).not.toBeInTheDocument();
    expect(pwaHarness.updateServiceWorker).not.toHaveBeenCalled();
  });

  it('does not announce offline readiness while the private workspace is unavailable', () => {
    render(<PwaUpdatePrompt workspaceAvailable={false} />);

    announceOfflineReady();

    expect(screen.queryByRole('status', { name: 'Offline availability' })).not.toBeInTheDocument();
  });

  it('automatically clears the nonessential offline confirmation', () => {
    vi.useFakeTimers();
    render(<PwaUpdatePrompt workspaceAvailable />);
    announceOfflineReady();

    expect(screen.getByRole('status', { name: 'Offline availability' })).toBeVisible();
    act(() => { vi.advanceTimersByTime(6_000); });
    expect(screen.queryByRole('status', { name: 'Offline availability' })).not.toBeInTheDocument();
  });

  it('does not activate an update until the workspace safety check succeeds', async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    const prepareForUpdate = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    render(<PwaUpdatePrompt prepareForUpdate={prepareForUpdate} />);
    announceNeedRefresh();

    await user.click(screen.getByRole('button', { name: 'Update now' }));
    expect(screen.getByRole('button', { name: 'Preparing…' })).toBeDisabled();
    expect(pwaHarness.updateServiceWorker).not.toHaveBeenCalled();

    release?.();
    await vi.waitFor(() => { expect(pwaHarness.updateServiceWorker).toHaveBeenCalledWith(true); });
  });

  it('keeps the current version active when workspace preparation fails', async () => {
    const user = userEvent.setup();
    render(<PwaUpdatePrompt prepareForUpdate={() => Promise.reject(new Error('Pause dictation before updating.'))} />);
    announceNeedRefresh();

    await user.click(screen.getByRole('button', { name: 'Update now' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Pause dictation before updating.');
    expect(pwaHarness.updateServiceWorker).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Update now' })).toBeEnabled();
  });
});
