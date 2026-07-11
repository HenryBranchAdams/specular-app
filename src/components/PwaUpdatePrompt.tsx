import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

type PromptKind = 'offline' | 'update' | null;

export function PwaUpdatePrompt() {
  const [promptKind, setPromptKind] = useState<PromptKind>(null);
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
      <div className="pwa-prompt__actions">
        {updateAvailable ? (
          <button
            className="pwa-prompt__button pwa-prompt__button--primary touch-target"
            onClick={() => {
              void updateServiceWorker(true);
            }}
            type="button"
          >
            Update now
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
