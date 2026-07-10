import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ConversationService,
  type ChallengeOperationResult,
  type ConclusionOperationResult,
  type ServiceResult,
  type SubmittedTurnResult,
} from '../application/conversation-service';
import { HttpQuestioningClient } from '../application/http-questioning-client';
import { OWNER_SCOPE } from '../domain/contracts';
import type {
  SpecularError,
  Thread,
  ThreadId,
  Turn,
  TurnId,
  WorkingConclusion,
} from '../domain/contracts';
import { createLocalRepositories } from '../storage/indexed-db';
import type { LocalRepositories } from '../storage/repositories';

export type ConversationBoundary = Pick<
  ConversationService,
  'challenge' | 'draftConclusion' | 'retryTurn' | 'startThread' | 'submitUserTurn'
>;

export interface SpecularDependencies {
  repositories: Pick<LocalRepositories, 'threads' | 'turns'>;
  service: ConversationBoundary;
}

type Activity = 'challenge' | 'conclusion' | 'retry' | 'submit' | null;

export interface PendingUserTurn {
  content: string;
  modality: 'text';
}

export interface SpecularViewModel {
  activity: Activity;
  conclusion: WorkingConclusion | null;
  draft: string;
  error: SpecularError | null;
  initialized: boolean;
  notice: string | null;
  pendingUserTurn: PendingUserTurn | null;
  thread: Thread | null;
  turns: Turn[];
}

export interface UseSpecularResult extends SpecularViewModel {
  canRetry: boolean;
  challenge: () => void;
  clearNotice: () => void;
  draftConclusion: () => void;
  retry: () => void;
  setDraft: (value: string) => void;
  submit: () => void;
}

interface OwnedDependencies extends SpecularDependencies {
  close(): void;
}

const STORAGE_ERROR: SpecularError = {
  code: 'storage_failure',
  message: 'Specular could not load your private local thread.',
  retryable: true,
};

function newestActiveThread(threads: readonly Thread[]): Thread | null {
  let newest: Thread | null = null;
  for (const thread of threads) {
    if (
      thread.lifecycleState === 'active'
      && (newest === null || thread.updatedAt > newest.updatedAt)
    ) {
      newest = thread;
    }
  }
  return newest;
}

function orderedUniqueTurns(current: readonly Turn[], incoming: readonly Turn[]): Turn[] {
  const byId = new Map<TurnId, Turn>();
  for (const turn of current) {
    byId.set(turn.id, turn);
  }
  for (const turn of incoming) {
    byId.set(turn.id, turn);
  }
  return [...byId.values()].sort((left, right) => left.position - right.position);
}

function latestRetryableTurnId(turns: readonly Turn[]): TurnId | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (
      turn?.role === 'user'
      && turn.operation === 'next_question'
      && (turn.deliveryState === 'failed' || turn.deliveryState === 'pending')
    ) {
      return turn.id;
    }
  }
  return null;
}

async function createProductionDependencies(): Promise<OwnedDependencies> {
  const repositories = await createLocalRepositories(OWNER_SCOPE);
  return {
    repositories,
    service: new ConversationService({
      repositories,
      client: new HttpQuestioningClient(),
    }),
    close() {
      repositories.close();
    },
  };
}

async function loadActiveConversation(
  dependencies: SpecularDependencies,
): Promise<{ thread: Thread | null; turns: Turn[] }> {
  const thread = newestActiveThread(await dependencies.repositories.threads.list());
  if (thread === null) {
    return { thread: null, turns: [] };
  }
  return {
    thread,
    turns: await dependencies.repositories.turns.listByThread(thread.id),
  };
}

export function useSpecular(
  injectedDependencies?: SpecularDependencies,
): UseSpecularResult {
  const dependenciesRef = useRef<SpecularDependencies | null>(injectedDependencies ?? null);
  const [view, setView] = useState<SpecularViewModel>({
    activity: null,
    conclusion: null,
    draft: '',
    error: null,
    initialized: false,
    notice: null,
    pendingUserTurn: null,
    thread: null,
    turns: [],
  });

  useEffect(() => {
    const lifecycle = { active: true };
    const isActive = () => lifecycle.active;
    let ownedDependencies: OwnedDependencies | null = null;

    async function initialize(): Promise<void> {
      try {
        const dependencies = injectedDependencies ?? await createProductionDependencies();
        if (injectedDependencies === undefined) {
          ownedDependencies = dependencies as OwnedDependencies;
        }
        if (!isActive()) {
          ownedDependencies?.close();
          ownedDependencies = null;
          return;
        }
        dependenciesRef.current = dependencies;
        const conversation = await loadActiveConversation(dependencies);
        if (!isActive()) {
          return;
        }
        setView((current) => ({
          ...current,
          initialized: true,
          thread: conversation.thread,
          turns: conversation.turns,
        }));
      } catch {
        if (isActive()) {
          setView((current) => ({
            ...current,
            error: STORAGE_ERROR,
            initialized: true,
          }));
        }
      }
    }

    void initialize();
    return () => {
      lifecycle.active = false;
      dependenciesRef.current = null;
      ownedDependencies?.close();
    };
  }, [injectedDependencies]);

  const setDraft = useCallback((draft: string) => {
    setView((current) => ({ ...current, draft, notice: null }));
  }, []);

  const clearNotice = useCallback(() => {
    setView((current) => ({ ...current, notice: null }));
  }, []);

  const refreshTurns = useCallback(async (
    dependencies: SpecularDependencies,
    threadId: ThreadId,
  ): Promise<Turn[]> => dependencies.repositories.turns.listByThread(threadId), []);

  const submit = useCallback(() => {
    const dependencies = dependenciesRef.current;
    const content = view.draft.trim();
    if (dependencies === null || content.length === 0 || view.activity !== null) {
      return;
    }

    setView((current) => ({
      ...current,
      activity: 'submit',
      draft: '',
      error: null,
      notice: null,
      pendingUserTurn: { content, modality: 'text' },
    }));

    void (async () => {
      let thread = view.thread;
      if (thread === null) {
        const started = await dependencies.service.startThread();
        if (!started.ok) {
          setView((current) => ({
            ...current,
            activity: null,
            draft: current.draft.length === 0 ? content : current.draft,
            error: started.error,
            pendingUserTurn: null,
          }));
          return;
        }
        thread = started.value;
        setView((current) => ({ ...current, thread }));
      }

      const result = await dependencies.service.submitUserTurn(thread.id, content, 'text');
      if (result.ok) {
        setView((current) => ({
          ...current,
          activity: null,
          pendingUserTurn: null,
          thread: result.value.thread,
          turns: orderedUniqueTurns(current.turns, [
            result.value.userTurn,
            result.value.responseTurn,
          ]),
        }));
        return;
      }

      let turns: Turn[];
      try {
        turns = await refreshTurns(dependencies, thread.id);
      } catch {
        turns = view.turns;
      }
      setView((current) => ({
        ...current,
        activity: null,
        draft: latestRetryableTurnId(turns) === null && current.draft.length === 0
          ? content
          : current.draft,
        error: result.error,
        pendingUserTurn: null,
        thread,
        turns,
      }));
    })();
  }, [refreshTurns, view.activity, view.draft, view.thread, view.turns]);

  const retry = useCallback(() => {
    const dependencies = dependenciesRef.current;
    const turnId = latestRetryableTurnId(view.turns);
    if (dependencies === null || turnId === null || view.activity !== null) {
      return;
    }

    setView((current) => ({
      ...current,
      activity: 'retry',
      error: null,
    }));

    void (async () => {
      const result: ServiceResult<SubmittedTurnResult> =
        await dependencies.service.retryTurn(turnId);
      if (result.ok) {
        setView((current) => ({
          ...current,
          activity: null,
          thread: result.value.thread,
          turns: orderedUniqueTurns(current.turns, [
            result.value.userTurn,
            result.value.responseTurn,
          ]),
        }));
        return;
      }
      const threadId = view.thread?.id;
      const turns = threadId === undefined
        ? view.turns
        : await refreshTurns(dependencies, threadId).catch(() => view.turns);
      setView((current) => ({
        ...current,
        activity: null,
        error: result.error,
        turns,
      }));
    })();
  }, [refreshTurns, view.activity, view.thread?.id, view.turns]);

  const challenge = useCallback(() => {
    const dependencies = dependenciesRef.current;
    const thread = view.thread;
    if (dependencies === null || thread === null || view.activity !== null) {
      return;
    }
    setView((current) => ({
      ...current,
      activity: 'challenge',
      error: null,
      notice: null,
    }));

    void (async () => {
      const result: ServiceResult<ChallengeOperationResult> =
        await dependencies.service.challenge(thread.id);
      if (!result.ok) {
        setView((current) => ({
          ...current,
          activity: null,
          error: result.error,
        }));
        return;
      }
      setView((current) => ({
        ...current,
        activity: null,
        thread: result.value.thread,
        turns: orderedUniqueTurns(current.turns, [result.value.responseTurn]),
      }));
    })();
  }, [view.activity, view.thread]);

  const draftConclusion = useCallback(() => {
    const dependencies = dependenciesRef.current;
    const thread = view.thread;
    if (dependencies === null || thread === null || view.activity !== null) {
      return;
    }
    setView((current) => ({
      ...current,
      activity: 'conclusion',
      error: null,
      notice: null,
    }));

    void (async () => {
      const result: ServiceResult<ConclusionOperationResult> =
        await dependencies.service.draftConclusion(thread.id);
      if (!result.ok) {
        setView((current) => ({
          ...current,
          activity: null,
          error: result.error,
        }));
        return;
      }
      setView((current) => ({
        ...current,
        activity: null,
        conclusion: result.value.output,
        notice: 'Conclusion draft ready.',
        thread: result.value.thread,
      }));
    })();
  }, [view.activity, view.thread]);

  return {
    ...view,
    canRetry: latestRetryableTurnId(view.turns) !== null,
    challenge,
    clearNotice,
    draftConclusion,
    retry,
    setDraft,
    submit,
  };
}
