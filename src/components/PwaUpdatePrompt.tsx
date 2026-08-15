import { useEffect, useState, type FocusEvent } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { prepareForApplicationReload } from '../pwa/reload-safety';

type PromptKind = 'offline' | 'update' | null;

export interface PwaPromptSurfaceProps {
  kind: Exclude<PromptKind, null>;
  onDismiss: () => void;
  onPauseChange?: (paused: boolean) => void;
  onUpdate: () => void;
  updateError?: string | null;
  updating?: boolean;
}

export function PwaPromptSurface({
  kind,
  onDismiss,
  onPauseChange,
  onUpdate,
  updateError = null,
  updating = false,
}: PwaPromptSurfaceProps) {
  const updateAvailable = kind === 'update';
  return (
    <div
      aria-label={updateAvailable ? 'Application update' : 'Offline availability'}
      aria-live="polite"
      className={`pwa-prompt pwa-prompt--${kind}`}
      data-ui-surface="pwa-status"
      onBlur={(event: FocusEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onPauseChange?.(false);
      }}
      onFocus={() => { onPauseChange?.(true); }}
      onMouseEnter={() => { onPauseChange?.(true); }}
      onMouseLeave={() => { onPauseChange?.(false); }}
      role="status"
    >
      <div className="pwa-prompt__content">
        <strong>{updateAvailable ? 'Update available' : 'Available offline'}</strong>
        <p className="pwa-prompt__message">
          {updateAvailable
            ? 'Specular saves your current work before refreshing.'
            : 'You can keep writing if your connection drops.'}
        </p>
        {updateError === null ? null : <p className="pwa-prompt__error" role="alert">{updateError}</p>}
      </div>
      <div className="pwa-prompt__actions">
        {updateAvailable ? (
          <button
            className="pwa-prompt__button pwa-prompt__button--primary touch-target"
            disabled={updating}
            onClick={onUpdate}
            type="button"
          >
            {updating ? 'Preparing…' : 'Update now'}
          </button>
        ) : null}
        <button className="pwa-prompt__button touch-target" onClick={onDismiss} type="button">
          {updateAvailable ? 'Later' : 'Dismiss'}
        </button>
      </div>
    </div>
  );
}

export function PwaUpdatePrompt({
  prepareForUpdate = prepareForApplicationReload,
  workspaceAvailable = true,
}: {
  prepareForUpdate?: () => Promise<void>;
  workspaceAvailable?: boolean;
}) {
  const [promptKind, setPromptKind] = useState<PromptKind>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [offlinePaused, setOfflinePaused] = useState(false);
  const { updateServiceWorker } = useRegisterSW({
    onNeedRefresh() {
      setPromptKind('update');
    },
    onOfflineReady() {
      if (workspaceAvailable) setPromptKind('offline');
    },
  });

  useEffect(() => {
    if (promptKind !== 'offline' || offlinePaused) return undefined;
    const timer = globalThis.setTimeout(() => { setPromptKind(null); }, 6_000);
    return () => { globalThis.clearTimeout(timer); };
  }, [offlinePaused, promptKind]);

  if (promptKind === null) {
    return null;
  }

  return (
    <PwaPromptSurface
      kind={promptKind}
      onDismiss={() => { setPromptKind(null); }}
      onPauseChange={setOfflinePaused}
      onUpdate={() => {
        setUpdating(true);
        setUpdateError(null);
        void prepareForUpdate()
          .then(() => updateServiceWorker(true))
          .catch((error: unknown) => {
            setUpdateError(error instanceof Error ? error.message : 'Specular could not safely prepare this update.');
          })
          .finally(() => { setUpdating(false); });
      }}
      updateError={updateError}
      updating={updating}
    />
  );
}
