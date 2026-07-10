import {
  useId,
  useRef,
  useState,
} from 'react';
import { useModalFocus } from './use-modal-focus';

export interface ConfirmDeleteDialogProps {
  artifactTitle: string;
  confirmLabel: string;
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  restoreFocusTo: HTMLElement | null;
}

export function ConfirmDeleteDialog({
  artifactTitle,
  confirmLabel,
  confirmDisabled = false,
  onCancel,
  onConfirm,
  restoreFocusTo,
}: ConfirmDeleteDialogProps) {
  const titleId = useId();
  const warningId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const confirmingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useModalFocus({
    containerRef: modalRef,
    initialFocusRef: cancelRef,
    onEscape: () => {
      if (!confirmingRef.current) {
        onCancel();
      }
    },
    restoreFocusTo,
  });

  const confirm = async () => {
    if (confirmingRef.current || confirmDisabled) {
      return;
    }
    confirmingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onCancel();
    } catch {
      confirmingRef.current = false;
      setPending(false);
      setError('The deletion could not be completed. Nothing else was changed.');
    }
  };

  return (
    <div
      aria-describedby={warningId}
      aria-labelledby={titleId}
      aria-modal="true"
      className="confirm-delete"
      ref={modalRef}
      role="alertdialog"
    >
      <div className="confirm-delete__surface">
        <h2 id={titleId}>Permanently delete “{artifactTitle}”?</h2>
        <p id={warningId}>
          This permanently removes this local content. This action cannot be undone.
        </p>
        {error === null ? null : <p role="alert">{error}</p>}
        <div className="confirm-delete__actions">
          <button
            className="confirm-delete__cancel touch-target"
            disabled={pending}
            onClick={onCancel}
            ref={cancelRef}
            type="button"
          >
            Cancel
          </button>
          <button
            className="confirm-delete__confirm touch-target"
            disabled={pending || confirmDisabled}
            onClick={() => { void confirm(); }}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
