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
import { StorageRecovery } from './StorageRecovery';

afterEach(cleanup);

describe('StorageRecovery', () => {
  it('keeps reset locked after export failure and unlocks only after a successful download', async () => {
    const failedDownload = vi.fn().mockRejectedValue(new Error('private stack detail'));
    const successfulDownload = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { rerender } = render(
      <StorageRecovery
        onDownloadRecovery={failedDownload}
        onReset={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Your local data needs attention' })).toBeVisible();
    expect(screen.getByText(/local changes are paused/i)).toBeVisible();
    const reset = screen.getByRole('button', { name: 'Reset local data' });
    expect(reset).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Download recovery copy' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The recovery copy could not be downloaded. Your local data was not changed.',
    );
    expect(document.body).not.toHaveTextContent('private stack detail');
    expect(reset).toBeDisabled();

    rerender(
      <StorageRecovery
        onDownloadRecovery={successfulDownload}
        onReset={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Download recovery copy' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Recovery copy downloaded.');
    expect(reset).toBeEnabled();
  });

  it('allows deliberate continuation without a copy but still confirms permanent reset', async () => {
    const onReset = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <StorageRecovery
        onDownloadRecovery={vi.fn()}
        onReset={onReset}
      />,
    );

    await user.click(screen.getByRole('button', {
      name: 'Continue without a recovery copy',
    }));
    const reset = screen.getByRole('button', { name: 'Reset local data' });
    expect(reset).toBeEnabled();
    await user.click(reset);

    const dialog = screen.getByRole('alertdialog', { name: /All local data/u });
    expect(dialog).toHaveTextContent(/cannot be undone/i);
    expect(onReset).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Permanently reset local data' }));
    expect(onReset).toHaveBeenCalledOnce();
  });
});
