/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  act,
  render,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  beforeEach,
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
    expect(screen.getByText('A new version of Specular is ready.')).toBeVisible();
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
    expect(screen.getByText('Specular is ready to work offline.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('status', { name: 'Offline availability' })).not.toBeInTheDocument();
    expect(pwaHarness.updateServiceWorker).not.toHaveBeenCalled();
  });
});
