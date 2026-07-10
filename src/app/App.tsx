import {
  useCallback,
  useRef,
  useState,
} from 'react';
import { CapsuleLibrary } from '../components/CapsuleLibrary';
import { Composer } from '../components/Composer';
import { ConclusionEditor } from '../components/ConclusionEditor';
import { StarterDeck } from '../components/StarterDeck';
import { StorageRecovery } from '../components/StorageRecovery';
import { ThreadActions } from '../components/ThreadActions';
import { ThreadHeader } from '../components/ThreadHeader';
import { Transcript } from '../components/Transcript';
import type { Turn } from '../domain/contracts';
import type { CompletedRealtimeExchange } from '../voice/realtime-client';
import {
  useVoice,
  type VoiceControllerFactory,
} from '../voice/use-voice';
import type { DownloadFile } from './download';
import {
  useSpecular,
  type SpecularDependencies,
  type SpecularRuntime,
} from './use-specular';

export interface AppProps {
  dependencies?: SpecularDependencies;
  downloadFile?: DownloadFile;
  runtime?: SpecularRuntime;
  voiceControllerFactory?: VoiceControllerFactory;
  voiceEnabled?: boolean;
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

export function App({
  dependencies,
  downloadFile,
  runtime,
  voiceControllerFactory,
  voiceEnabled = import.meta.env.VITE_ENABLE_REALTIME === 'true',
}: AppProps) {
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const capsuleButtonRef = useRef<HTMLButtonElement>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const [capsulesOpen, setCapsulesOpen] = useState(false);
  const specular = useSpecular(dependencies, runtime, downloadFile);
  const closeCapsules = useCallback(() => { setCapsulesOpen(false); }, []);

  const focusComposer = useCallback(() => {
    specular.clearNotice();
    composerRef.current?.focus({ preventScroll: true });
  }, [specular.clearNotice]);

  const acceptVoiceExchange = useCallback((exchange: CompletedRealtimeExchange) => (
    specular.acceptVoiceExchange(
      exchange.threadId,
      exchange.userTranscript,
      exchange.assistantTranscript,
    )
  ), [specular.acceptVoiceExchange]);

  const voice = useVoice({
    acceptExchange: acceptVoiceExchange,
    ...(voiceControllerFactory === undefined ? {} : { controllerFactory: voiceControllerFactory }),
    enabled: voiceEnabled && specular.activity === null && specular.conclusion === null,
    onFocusRequest: focusComposer,
    thread: specular.thread,
    turns: specular.turns,
  });

  const toggleVoice = useCallback(() => {
    specular.clearNotice();
    if (voice.status === 'listening') {
      voice.stop();
      return;
    }
    if (voice.status === 'idle' || voice.status === 'failure') {
      voice.start();
    }
  }, [specular.clearNotice, voice]);

  if (specular.recoveryRequired) {
    return (
      <StorageRecovery
        onDownloadRecovery={specular.downloadRecovery}
        onReset={specular.resetLocalData}
      />
    );
  }

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
  const conclusionAction = specular.activity === 'keep'
    || specular.activity === 'save'
    || specular.activity === 'finish'
    ? specular.activity
    : null;

  const openCapsules = () => {
    specular.clearNotice();
    setCapsulesOpen(true);
  };

  const conclusionIdentity = specular.thread === null || specular.conclusion === null
    ? 'no-conclusion'
    : `${specular.thread.id}:${specular.conclusion.provenance
      .map((source) => source.turnId)
      .join(':')}`;

  return (
    <main
      className={`app-shell ${stateClass}${composerFocused ? ' app-shell--settled' : ''}`}
      data-testid="specular-app"
    >
      <div aria-hidden="true" className="spectral-atmosphere" />
      {specular.initialized ? (
        <ThreadHeader
          capsuleButtonRef={capsuleButtonRef}
          onOpenCapsules={openCapsules}
          thread={specular.thread}
        />
      ) : (
        <div aria-hidden="true" className="thread-header" />
      )}

      <section
        aria-busy={!specular.initialized}
        aria-label={specular.conclusion === null
          ? hasConversation ? 'Active conversation' : 'Start a thought'
          : 'Edit conclusion'}
        className={`conversation-plane${specular.conclusion === null
          ? ''
          : ' conversation-plane--editor'}`}
      >
        {specular.conclusion !== null ? (
          <ConclusionEditor
            conclusion={specular.conclusion}
            key={conclusionIdentity}
            onFinish={specular.finish}
            onKeepDigging={specular.keepDigging}
            onSaveCapsule={specular.saveCapsule}
            pendingAction={conclusionAction}
          />
        ) : !specular.initialized ? (
          <div aria-hidden="true" className="conversation-loading" />
        ) : hasConversation ? (
          <Transcript
            pendingUserTurn={specular.pendingUserTurn}
            turns={specular.turns}
          />
        ) : (
          <StarterDeck onActivate={focusComposer} />
        )}
      </section>

      {specular.conclusion === null ? (
        <div className="interaction-dock">
          <Composer
            busy={!specular.initialized
              || specular.activity === 'submit'
              || specular.activity === 'retry'}
            onFocusChange={setComposerFocused}
            onSubmit={specular.submit}
            onValueChange={specular.setDraft}
            onVoice={toggleVoice}
            ref={composerRef}
            value={specular.draft}
            {...(voiceEnabled ? { voice: { error: voice.error, status: voice.status } } : {})}
          />

          {hasConversation ? (
            <ThreadActions
              activity={specular.activity}
              disabled={voice.status === 'connecting' || voice.status === 'listening'}
              onChallenge={specular.challenge}
              onDraftConclusion={specular.draftConclusion}
            />
          ) : null}

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
        </div>
      ) : null}

      <div className="application-status">
        {specular.error === null ? null : (
          <div aria-live="assertive" className="error-notice" role="alert">
            <p>{specular.error.message}</p>
          </div>
        )}
        <div aria-atomic="true" aria-live="polite" className="status-notice" role="status">
          {specular.notice}
        </div>
        <p className="sr-only" aria-live="polite">
          {specular.initialized ? '' : 'Loading your private local thread.'}
        </p>
      </div>

      <CapsuleLibrary
        busy={specular.activity !== null}
        capsules={specular.capsules}
        currentThread={specular.thread === null
          ? null
          : { id: specular.thread.id, title: specular.thread.title }}
        onClose={closeCapsules}
        onDeleteAll={specular.deleteAll}
        onDeleteCapsule={specular.deleteCapsule}
        onDeleteThread={specular.deleteThread}
        onExport={specular.exportArchive}
        onUpdateCapsule={specular.updateCapsule}
        open={capsulesOpen}
        triggerRef={capsuleButtonRef}
      />
    </main>
  );
}
