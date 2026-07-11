import { useRef, useState } from 'react';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';

export interface StorageRecoveryProps {
  onDownloadRecovery: () => Promise<void>;
  onReset: () => Promise<void>;
}

type RecoveryNotice =
  | { kind: 'error'; message: string }
  | { kind: 'status'; message: string }
  | null;

export function StorageRecovery({
  onDownloadRecovery,
  onReset,
}: StorageRecoveryProps) {
  const resetRef = useRef<HTMLButtonElement>(null);
  const [downloadPending, setDownloadPending] = useState(false);
  const [resetUnlocked, setResetUnlocked] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [notice, setNotice] = useState<RecoveryNotice>(null);

  const download = async () => {
    if (downloadPending) {
      return;
    }
    setDownloadPending(true);
    setNotice(null);
    try {
      await onDownloadRecovery();
      setResetUnlocked(true);
      setNotice({ kind: 'status', message: 'Recovery copy downloaded.' });
    } catch {
      setNotice({
        kind: 'error',
        message: 'The recovery copy could not be downloaded. Your local data was not changed.',
      });
    } finally {
      setDownloadPending(false);
    }
  };

  return (
    <main className="storage-recovery">
      <section aria-labelledby="storage-recovery-title" className="storage-recovery__surface">
        <h1 id="storage-recovery-title">Your local data needs attention</h1>
        <p>
          Local changes are paused to protect the information already on this device.
        </p>
        <p>
          Download a recovery copy before deciding whether to reset this local data.
        </p>

        <div className="storage-recovery__actions">
          <button
            className="storage-recovery__download touch-target"
            disabled={downloadPending}
            onClick={() => { void download(); }}
            type="button"
          >
            {downloadPending ? 'Preparing recovery copy…' : 'Download recovery copy'}
          </button>
          <button
            className="storage-recovery__reset touch-target"
            disabled={!resetUnlocked || downloadPending}
            onClick={() => { setConfirmingReset(true); }}
            ref={resetRef}
            type="button"
          >
            Reset local data
          </button>
          <button
            className="storage-recovery__continue touch-target"
            disabled={downloadPending}
            onClick={() => {
              setResetUnlocked(true);
              setNotice({
                kind: 'status',
                message: 'Reset unlocked without a recovery copy.',
              });
            }}
            type="button"
          >
            Continue without a recovery copy
          </button>
        </div>

        <p className="storage-recovery__warning">
          Reset permanently deletes the local data on this device and cannot be undone.
        </p>
        {notice === null ? null : notice.kind === 'error' ? (
          <p aria-live="assertive" role="alert">{notice.message}</p>
        ) : (
          <p aria-live="polite" role="status">{notice.message}</p>
        )}
      </section>

      {confirmingReset ? (
        <ConfirmDeleteDialog
          artifactTitle="All local data"
          confirmLabel="Permanently reset local data"
          onCancel={() => { setConfirmingReset(false); }}
          onConfirm={onReset}
          restoreFocusTo={resetRef.current}
        />
      ) : null}
    </main>
  );
}
