import {
  useRef,
  useState,
} from 'react';
import { Composer } from '../components/Composer';
import { StarterDeck } from '../components/StarterDeck';
import { ThreadActions } from '../components/ThreadActions';
import { ThreadHeader } from '../components/ThreadHeader';
import { Transcript } from '../components/Transcript';
import type { Turn } from '../domain/contracts';
import {
  useSpecular,
  type SpecularDependencies,
} from './use-specular';

export interface AppProps {
  dependencies?: SpecularDependencies;
}

function latestSpecularTurn(turns: readonly Turn[]): Turn | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.role === 'specular') {
      return turn;
    }
  }
  return null;
}

export function App({ dependencies }: AppProps) {
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const specular = useSpecular(dependencies);
  const hasConversation = specular.thread !== null
    && (specular.turns.length > 0 || specular.pendingUserTurn !== null);
  const latestTurn = latestSpecularTurn(specular.turns);
  const challengeState = specular.activity === 'challenge'
    || latestTurn?.operation === 'challenge';
  const conclusionState = specular.activity === 'conclusion' || specular.conclusion !== null;
  const stateClass = conclusionState
    ? 'app-shell--conclusion'
    : challengeState
      ? 'app-shell--challenge'
      : 'app-shell--inquiry';

  const focusComposer = () => {
    specular.clearNotice();
    composerRef.current?.focus({ preventScroll: true });
  };

  const announceVoiceAffordance = () => {
    specular.clearNotice();
  };

  const announceCapsules = () => {
    specular.clearNotice();
  };

  return (
    <main
      className={`app-shell ${stateClass}${composerFocused ? ' app-shell--settled' : ''}`}
      data-testid="specular-app"
    >
      <div aria-hidden="true" className="spectral-atmosphere" />
      <ThreadHeader onOpenCapsules={announceCapsules} thread={specular.thread} />

      <section
        aria-label={hasConversation ? 'Active conversation' : 'Start a thought'}
        className="conversation-plane"
      >
        {hasConversation ? (
          <Transcript
            pendingUserTurn={specular.pendingUserTurn}
            turns={specular.turns}
          />
        ) : (
          <StarterDeck onActivate={focusComposer} />
        )}
      </section>

      <div className="interaction-dock">
        <Composer
          busy={!specular.initialized
            || specular.activity === 'submit'
            || specular.activity === 'retry'}
          onFocusChange={setComposerFocused}
          onSubmit={specular.submit}
          onValueChange={specular.setDraft}
          onVoice={announceVoiceAffordance}
          ref={composerRef}
          value={specular.draft}
        />

        {hasConversation ? (
          <ThreadActions
            activity={specular.activity}
            onChallenge={specular.challenge}
            onDraftConclusion={specular.draftConclusion}
          />
        ) : null}

        {specular.error === null ? null : (
          <div aria-live="assertive" className="error-notice" role="alert">
            <p>{specular.error.message}</p>
          </div>
        )}

        {specular.canRetry ? (
          <div
            aria-label="Saved thought recovery"
            aria-live="polite"
            className="recovery-notice"
            role="status"
          >
            <span>Your saved thought is ready to retry.</span>
            <button
              className="retry-button touch-target"
              disabled={specular.activity === 'retry'}
              onClick={specular.retry}
              type="button"
            >
              {specular.activity === 'retry' ? 'Retrying…' : 'Retry saved thought'}
            </button>
          </div>
        ) : null}

        <div aria-atomic="true" aria-live="polite" className="status-notice" role="status">
          {specular.notice}
        </div>
        <p className="sr-only" aria-live="polite">
          {specular.initialized ? '' : 'Loading your private local thread.'}
        </p>
      </div>
    </main>
  );
}
