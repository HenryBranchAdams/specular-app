/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useRef, useState } from 'react';
import {
  cleanup,
  render,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { MAX_TITLE_LENGTH } from '../domain/schemas';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';

const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');
const SCROLLABLE_CONFIRM_OVERLAY_PATTERN =
  /\.confirm-delete\s*\{[^}]*overflow-y:\s*auto;/su;
const SAFELY_CENTERED_CONFIRM_OVERLAY_PATTERN =
  /\.confirm-delete\s*\{[^}]*(?:align-items:\s*safe center;[^}]*justify-items:\s*center;|place-items:\s*safe center center;)/su;
const BOUNDED_SCROLLABLE_CONFIRM_SURFACE_PATTERN =
  /\.confirm-delete__surface\s*\{[^}]*max-height:\s*100%;[^}]*overflow-y:\s*auto;/su;

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resolver: (() => void) | undefined;
  return {
    promise: new Promise<void>((resolve) => {
      resolver = resolve;
    }),
    resolve() {
      resolver?.();
    },
  };
}

afterEach(cleanup);

describe('ConfirmDeleteDialog', () => {
  it('names the artifact, warns irreversibly, cancels with Escape, and restores focus', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      const triggerRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button
            aria-hidden="false"
            onClick={() => { setOpen(true); }}
            ref={triggerRef}
            type="button"
          >
            Delete capsule
          </button>
          {open ? (
            <ConfirmDeleteDialog
              artifactTitle="Decision clarity"
              confirmLabel="Permanently delete capsule"
              onCancel={() => { setOpen(false); }}
              onConfirm={() => Promise.resolve()}
              restoreFocusTo={triggerRef.current}
            />
          ) : null}
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Delete capsule' });
    await user.click(trigger);

    const dialog = screen.getByRole('alertdialog', { name: /Decision clarity/u });
    expect(dialog).toHaveTextContent('Decision clarity');
    expect(dialog).toHaveTextContent(/cannot be undone/i);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Permanently delete capsule' });
    expect(trigger).toHaveAttribute('aria-hidden', 'true');
    expect(trigger).toHaveAttribute('inert');
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-hidden', 'false');
    expect(trigger).not.toHaveAttribute('inert');
  });

  it('fires confirmation once and disables both actions while deletion is pending', async () => {
    const deletion = deferred();
    const onConfirm = vi.fn(() => deletion.promise);
    const user = userEvent.setup();
    render(
      <ConfirmDeleteDialog
        artifactTitle="All local content"
        confirmLabel="Permanently delete all local content"
        pendingLabel="Deleting all local content…"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        restoreFocusTo={null}
      />,
    );

    const confirm = screen.getByRole('button', {
      name: 'Permanently delete all local content',
    });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    await user.click(confirm);
    await user.click(confirm);

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(confirm).toBeDisabled();
    expect(cancel).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deleting all local content…' })).toBeDisabled();
    deletion.resolve();
  });

  it('reports an action-specific recoverable failure', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDeleteDialog
        artifactTitle="Hosted workspace"
        confirmLabel="Delete account data"
        errorMessage="Specular could not delete this account workspace. Nothing was removed."
        onCancel={vi.fn()}
        onConfirm={() => Promise.reject(new Error('Synthetic failure'))}
        restoreFocusTo={null}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete account data' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('could not delete this account workspace');
    expect(screen.getByRole('button', { name: 'Delete account data' })).toBeEnabled();
  });

  it('keeps both actions reachable at 320px and 200% text with a maximum-length title', () => {
    const maximumTitle = 'A'.repeat(MAX_TITLE_LENGTH);
    render(
      <div style={{ fontSize: '200%', width: '320px' }}>
        <ConfirmDeleteDialog
          artifactTitle={maximumTitle}
          confirmLabel="Permanently delete capsule"
          onCancel={vi.fn()}
          onConfirm={() => Promise.resolve()}
          restoreFocusTo={null}
        />
      </div>,
    );

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent(maximumTitle);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Permanently delete capsule' })).toBeVisible();
    expect(styles).toMatch(SCROLLABLE_CONFIRM_OVERLAY_PATTERN);
    expect(styles).toMatch(SAFELY_CENTERED_CONFIRM_OVERLAY_PATTERN);
    expect(styles).toMatch(BOUNDED_SCROLLABLE_CONFIRM_SURFACE_PATTERN);
  });
});
