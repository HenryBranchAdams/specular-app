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
  description?: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  restoreFocusTo: HTMLElement | null;
  title?: string;
}

export function ConfirmDeleteDialog({
  artifactTitle,
  confirmLabel,
  confirmDisabled = false,
  description = 'This permanently removes this local content. This action cannot be undone.',
  onCancel,
  onConfirm,
  restoreFocusTo,
  title,
}: ConfirmDeleteDialogProps) {
  const titleId = useId();
  const warningId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDialogElement>(null);
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
      setError('The action could not be completed. Nothing else was changed.');
    }
  };

  return (
    <dialog
      aria-describedby={warningId}
      aria-labelledby={titleId}
      className="confirm-delete"
      open
      ref={modalRef}
      role="alertdialog"
    >
      <div className="confirm-delete__surface">
        <h2 id={titleId}>{title ?? `Permanently delete “${artifactTitle}”?`}</h2>
        <p id={warningId}>{description}</p>
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
    </dialog>
  );
}
