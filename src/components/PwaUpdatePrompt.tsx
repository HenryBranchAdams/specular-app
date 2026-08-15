import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { prepareForApplicationReload } from '../pwa/reload-safety';

type PromptKind = 'offline' | 'update' | null;

export function PwaUpdatePrompt({
  prepareForUpdate = prepareForApplicationReload,
}: {
  prepareForUpdate?: () => Promise<void>;
}) {
  const [promptKind, setPromptKind] = useState<PromptKind>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const { updateServiceWorker } = useRegisterSW({
    onNeedRefresh() {
      setPromptKind('update');
    },
    onOfflineReady() {
      setPromptKind('offline');
    },
  });

  if (promptKind === null) {
    return null;
  }

  const updateAvailable = promptKind === 'update';

  return (
    <div
      aria-label={updateAvailable ? 'Application update' : 'Offline availability'}
      aria-live="polite"
      className="pwa-prompt"
      role="status"
    >
      <p className="pwa-prompt__message">
        {updateAvailable
          ? 'A new version of Specular is ready.'
          : 'Specular is ready to work offline.'}
      </p>
      {updateError === null ? null : <p className="pwa-prompt__error" role="alert">{updateError}</p>}
      <div className="pwa-prompt__actions">
        {updateAvailable ? (
          <button
            className="pwa-prompt__button pwa-prompt__button--primary touch-target"
            disabled={updating}
            onClick={() => {
              setUpdating(true);
              setUpdateError(null);
              void prepareForUpdate()
                .then(() => updateServiceWorker(true))
                .catch((error: unknown) => {
                  setUpdateError(error instanceof Error ? error.message : 'Specular could not safely prepare this update.');
                })
                .finally(() => { setUpdating(false); });
            }}
            type="button"
          >
            {updating ? 'Preparing…' : 'Update now'}
          </button>
        ) : null}
        <button
          className="pwa-prompt__button touch-target"
          onClick={() => {
            setPromptKind(null);
          }}
          type="button"
        >
          {updateAvailable ? 'Later' : 'Dismiss'}
        </button>
      </div>
    </div>
  );
}
