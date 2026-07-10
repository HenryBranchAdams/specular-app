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
  type VoiceExchangeResult,
} from '../application/conversation-service';
import { HttpQuestioningClient } from '../application/http-questioning-client';
import { OWNER_SCOPE } from '../domain/contracts';
import type {
  Capsule,
  CapsuleId,
  SpecularError,
  Thread,
  ThreadId,
  Turn,
  TurnId,
  WorkingConclusion,
} from '../domain/contracts';
import {
  createExportFilename,
  createRecoveryFilename,
  serializeExport,
  serializeRecoverySnapshot,
  type RecoverySnapshot,
} from '../storage/export';
import {
  StorageMigrationError,
  createLocalRepositories,
  exportRecoverySnapshot as readRecoverySnapshot,
  resetLocalDatabase,
} from '../storage/indexed-db';
import type { LocalRepositories } from '../storage/repositories';
import {
  downloadJsonFile,
  type DownloadFile,
} from './download';

export type ConversationBoundary = Pick<
  ConversationService,
  | 'acceptVoiceExchange'
  | 'challenge'
  | 'deleteAll'
  | 'deleteCapsule'
  | 'deleteThread'
  | 'draftConclusion'
  | 'exportAll'
  | 'finishThread'
  | 'keepDigging'
  | 'retryTurn'
  | 'saveCapsule'
  | 'startThread'
  | 'submitUserTurn'
  | 'updateCapsule'
>;

export interface SpecularDependencies {
  repositories: Pick<LocalRepositories, 'capsules' | 'threads' | 'turns'>;
  service: ConversationBoundary;
}

export interface SpecularRuntimeDependencies extends SpecularDependencies {
  close(): void;
}

export interface SpecularRuntime {
  createDependencies(): Promise<SpecularRuntimeDependencies>;
  exportRecoverySnapshot(): Promise<RecoverySnapshot>;
  resetLocalData(): Promise<void>;
}

type Activity =
  | 'challenge'
  | 'conclusion'
  | 'delete'
  | 'export'
  | 'finish'
  | 'keep'
  | 'retry'
  | 'save'
  | 'submit'
  | 'update'
  | null;

export interface PendingUserTurn {
  content: string;
  modality: 'text';
}

export interface SpecularViewModel {
  activity: Activity;
  capsules: Capsule[];
  conclusion: WorkingConclusion | null;
  draft: string;
  error: SpecularError | null;
  initialized: boolean;
  notice: string | null;
  pendingUserTurn: PendingUserTurn | null;
  recoveryRequired: boolean;
  thread: Thread | null;
  turns: Turn[];
}

export interface UseSpecularResult extends SpecularViewModel {
  acceptVoiceExchange: (
    threadId: ThreadId,
    userTranscript: string,
    assistantTranscript: string,
  ) => Promise<boolean>;
  canRetry: boolean;
  challenge: () => void;
  clearNotice: () => void;
  deleteAll: () => Promise<void>;
  deleteCapsule: (capsuleId: CapsuleId) => Promise<void>;
  deleteThread: (threadId: ThreadId) => Promise<void>;
  downloadRecovery: () => Promise<void>;
  draftConclusion: () => void;
  exportArchive: () => Promise<void>;
  finish: (conclusion: WorkingConclusion) => void;
  keepDigging: (conclusion: WorkingConclusion) => void;
  resetLocalData: () => Promise<void>;
  retry: () => void;
  saveCapsule: (conclusion: WorkingConclusion) => void;
  setDraft: (value: string) => void;
  submit: () => void;
  updateCapsule: (
    capsuleId: CapsuleId,
    conclusion: WorkingConclusion,
  ) => Promise<void>;
}

const STORAGE_ERROR: SpecularError = {
  code: 'storage_failure',
  message: 'Specular could not load your private local thread.',
  retryable: true,
};

const STORAGE_UPDATE_ERROR: SpecularError = {
  code: 'storage_failure',
  message: 'Specular could not update local storage.',
  retryable: true,
};

function initialView(overrides: Partial<SpecularViewModel> = {}): SpecularViewModel {
  return {
    activity: null,
    capsules: [],
    conclusion: null,
    draft: '',
    error: null,
    initialized: false,
    notice: null,
    pendingUserTurn: null,
    recoveryRequired: false,
    thread: null,
    turns: [],
    ...overrides,
  };
}

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

function newestCapsules(capsules: readonly Capsule[]): Capsule[] {
  return [...capsules].sort((left, right) => right.createdAt - left.createdAt);
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

const productionRuntime: SpecularRuntime = {
  async createDependencies() {
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
  },
  exportRecoverySnapshot: () => readRecoverySnapshot(OWNER_SCOPE),
  resetLocalData: () => resetLocalDatabase(OWNER_SCOPE),
};

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
  runtime: SpecularRuntime = productionRuntime,
  downloadFile: DownloadFile = downloadJsonFile,
): UseSpecularResult {
  const dependenciesRef = useRef<SpecularDependencies | null>(injectedDependencies ?? null);
  const [runtimeGeneration, setRuntimeGeneration] = useState(0);
  const [view, setView] = useState<SpecularViewModel>(() => initialView());

  useEffect(() => {
    const lifecycle = { active: true };
    const isActive = () => lifecycle.active;
    let ownedDependencies: SpecularRuntimeDependencies | null = null;

    async function initialize(): Promise<void> {
      try {
        const dependencies = injectedDependencies ?? await runtime.createDependencies();
        if (injectedDependencies === undefined) {
          ownedDependencies = dependencies as SpecularRuntimeDependencies;
        }
        if (!isActive()) {
          ownedDependencies?.close();
          ownedDependencies = null;
          return;
        }
        dependenciesRef.current = dependencies;
        const [conversation, capsules] = await Promise.all([
          loadActiveConversation(dependencies),
          dependencies.repositories.capsules.list(),
        ]);
        if (!isActive()) {
          return;
        }
        setView((current) => ({
          ...current,
          capsules: newestCapsules(capsules),
          error: null,
          initialized: true,
          recoveryRequired: false,
          thread: conversation.thread,
          turns: conversation.turns,
        }));
      } catch (error) {
        if (!isActive()) {
          return;
        }
        dependenciesRef.current = null;
        if (error instanceof StorageMigrationError) {
          setView(initialView({ initialized: true, recoveryRequired: true }));
          return;
        }
        setView((current) => ({
          ...current,
          error: STORAGE_ERROR,
          initialized: true,
        }));
      }
    }

    void initialize();
    return () => {
      lifecycle.active = false;
      dependenciesRef.current = null;
      ownedDependencies?.close();
    };
  }, [injectedDependencies, runtime, runtimeGeneration]);

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

  const acceptVoiceExchange = useCallback(async (
    threadId: ThreadId,
    userTranscript: string,
    assistantTranscript: string,
  ): Promise<boolean> => {
    const dependencies = dependenciesRef.current;
    if (dependencies === null) {
      return false;
    }

    const result: ServiceResult<VoiceExchangeResult> =
      await dependencies.service.acceptVoiceExchange(
        threadId,
        userTranscript,
        assistantTranscript,
      );
    if (!result.ok) {
      setView((current) => ({ ...current, error: result.error }));
      return false;
    }

    setView((current) => current.thread?.id === threadId
      ? {
          ...current,
          error: null,
          thread: result.value.thread,
          turns: orderedUniqueTurns(current.turns, [
            result.value.userTurn,
            result.value.responseTurn,
          ]),
        }
      : current);
    return true;
  }, []);

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

    setView((current) => ({ ...current, activity: 'retry', error: null }));
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
        setView((current) => ({ ...current, activity: null, error: result.error }));
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
        setView((current) => ({ ...current, activity: null, error: result.error }));
        return;
      }
      setView((current) => ({
        ...current,
        activity: null,
        conclusion: result.value.output,
        notice: 'Conclusion draft ready.',
        thread: result.value.thread,
        turns: orderedUniqueTurns(current.turns, [result.value.responseTurn]),
      }));
    })();
  }, [view.activity, view.thread]);

  const keepDigging = useCallback((conclusion: WorkingConclusion) => {
    const dependencies = dependenciesRef.current;
    const thread = view.thread;
    if (dependencies === null || thread === null || view.activity !== null) {
      return;
    }
    setView((current) => ({ ...current, activity: 'keep', error: null, notice: null }));
    void (async () => {
      const result = await dependencies.service.keepDigging(thread.id, conclusion);
      if (!result.ok) {
        setView((current) => ({ ...current, activity: null, error: result.error }));
        return;
      }
      setView((current) => ({
        ...current,
        activity: null,
        conclusion: null,
        notice: 'Conclusion kept with this thread.',
        thread: result.value,
      }));
    })();
  }, [view.activity, view.thread]);

  const saveCapsule = useCallback((conclusion: WorkingConclusion) => {
    const dependencies = dependenciesRef.current;
    const thread = view.thread;
    if (dependencies === null || thread === null || view.activity !== null) {
      return;
    }
    setView((current) => ({ ...current, activity: 'save', error: null, notice: null }));
    void (async () => {
      let turns: Turn[];
      try {
        turns = await dependencies.repositories.turns.listByThread(thread.id);
      } catch {
        setView((current) => ({
          ...current,
          activity: null,
          error: STORAGE_UPDATE_ERROR,
        }));
        return;
      }
      const first = turns[0];
      const last = turns.at(-1);
      if (first === undefined || last === undefined) {
        setView((current) => ({
          ...current,
          activity: null,
          error: STORAGE_UPDATE_ERROR,
        }));
        return;
      }
      const result = await dependencies.service.saveCapsule({
        threadId: thread.id,
        title: thread.title,
        conclusion,
        sourceTurnRange: { startTurnId: first.id, endTurnId: last.id },
      });
      if (!result.ok) {
        setView((current) => ({ ...current, activity: null, error: result.error }));
        return;
      }
      setView((current) => ({
        ...current,
        activity: null,
        capsules: newestCapsules([
          ...current.capsules.filter((capsule) => capsule.id !== result.value.id),
          result.value,
        ]),
        notice: 'Capsule saved.',
      }));
    })();
  }, [view.activity, view.thread]);

  const finish = useCallback((conclusion: WorkingConclusion) => {
    const dependencies = dependenciesRef.current;
    const thread = view.thread;
    if (dependencies === null || thread === null || view.activity !== null) {
      return;
    }
    setView((current) => ({ ...current, activity: 'finish', error: null, notice: null }));
    void (async () => {
      const kept = await dependencies.service.keepDigging(thread.id, conclusion);
      if (!kept.ok) {
        setView((current) => ({ ...current, activity: null, error: kept.error }));
        return;
      }
      const finished = await dependencies.service.finishThread(thread.id);
      if (!finished.ok) {
        setView((current) => ({
          ...current,
          activity: null,
          error: finished.error,
          thread: kept.value,
        }));
        return;
      }
      setView((current) => ({
        ...current,
        activity: null,
        conclusion: null,
        draft: '',
        notice: 'Thread finished. Start a fresh thought when you are ready.',
        pendingUserTurn: null,
        thread: finished.value,
        turns: [],
      }));
    })();
  }, [view.activity, view.thread]);

  const updateCapsule = useCallback(async (
    capsuleId: CapsuleId,
    conclusion: WorkingConclusion,
  ): Promise<void> => {
    const dependencies = dependenciesRef.current;
    if (dependencies === null) {
      throw new Error('Local storage is unavailable.');
    }
    setView((current) => ({ ...current, activity: 'update', error: null, notice: null }));
    const result = await dependencies.service.updateCapsule(capsuleId, conclusion);
    if (!result.ok) {
      setView((current) => ({ ...current, activity: null, error: result.error }));
      throw new Error(result.error.message);
    }
    setView((current) => ({
      ...current,
      activity: null,
      capsules: newestCapsules(current.capsules.map((capsule) => (
        capsule.id === result.value.id ? result.value : capsule
      ))),
      notice: 'Capsule updated.',
    }));
  }, []);

  const exportArchive = useCallback(async (): Promise<void> => {
    const dependencies = dependenciesRef.current;
    if (dependencies === null) {
      throw new Error('Local storage is unavailable.');
    }
    setView((current) => ({ ...current, activity: 'export', error: null, notice: null }));
    const result = await dependencies.service.exportAll();
    if (!result.ok) {
      setView((current) => ({ ...current, activity: null, error: result.error }));
      throw new Error(result.error.message);
    }
    try {
      downloadFile(
        serializeExport(result.value),
        createExportFilename(result.value.exportedAt),
      );
      setView((current) => ({ ...current, activity: null, notice: 'Export downloaded.' }));
    } catch {
      setView((current) => ({
        ...current,
        activity: null,
        error: STORAGE_UPDATE_ERROR,
      }));
      throw new Error('The export could not be downloaded.');
    }
  }, [downloadFile]);

  const deleteCapsule = useCallback(async (capsuleId: CapsuleId): Promise<void> => {
    const dependencies = dependenciesRef.current;
    if (dependencies === null) {
      throw new Error('Local storage is unavailable.');
    }
    setView((current) => ({ ...current, activity: 'delete', error: null, notice: null }));
    const result = await dependencies.service.deleteCapsule(capsuleId);
    if (!result.ok) {
      setView((current) => ({ ...current, activity: null, error: result.error }));
      throw new Error(result.error.message);
    }
    setView((current) => ({
      ...current,
      activity: null,
      capsules: current.capsules.filter((capsule) => capsule.id !== capsuleId),
      notice: 'Capsule permanently deleted.',
    }));
  }, []);

  const deleteThread = useCallback(async (threadId: ThreadId): Promise<void> => {
    const dependencies = dependenciesRef.current;
    if (dependencies === null) {
      throw new Error('Local storage is unavailable.');
    }
    setView((current) => ({ ...current, activity: 'delete', error: null, notice: null }));
    const result = await dependencies.service.deleteThread(threadId);
    if (!result.ok) {
      setView((current) => ({ ...current, activity: null, error: result.error }));
      throw new Error(result.error.message);
    }
    setView((current) => current.thread?.id === threadId
      ? {
          ...current,
          activity: null,
          conclusion: null,
          draft: '',
          notice: 'Thread permanently deleted.',
          pendingUserTurn: null,
          thread: null,
          turns: [],
        }
      : {
          ...current,
          activity: null,
          notice: 'Thread permanently deleted.',
        });
  }, []);

  const deleteAll = useCallback(async (): Promise<void> => {
    const dependencies = dependenciesRef.current;
    if (dependencies === null) {
      throw new Error('Local storage is unavailable.');
    }
    setView((current) => ({ ...current, activity: 'delete', error: null, notice: null }));
    const result = await dependencies.service.deleteAll();
    if (!result.ok) {
      setView((current) => ({ ...current, activity: null, error: result.error }));
      throw new Error(result.error.message);
    }
    setView(initialView({
      initialized: true,
      notice: 'All local content permanently deleted.',
    }));
  }, []);

  const downloadRecovery = useCallback(async (): Promise<void> => {
    const snapshot = await runtime.exportRecoverySnapshot();
    downloadFile(
      serializeRecoverySnapshot(snapshot),
      createRecoveryFilename(snapshot.exportedAt),
    );
  }, [downloadFile, runtime]);

  const resetLocalData = useCallback(async (): Promise<void> => {
    await runtime.resetLocalData();
    dependenciesRef.current = null;
    setView(initialView({
      notice: 'Local data reset.',
      recoveryRequired: true,
    }));
    setRuntimeGeneration((generation) => generation + 1);
  }, [runtime]);

  return {
    ...view,
    acceptVoiceExchange,
    canRetry: latestRetryableTurnId(view.turns) !== null,
    challenge,
    clearNotice,
    deleteAll,
    deleteCapsule,
    deleteThread,
    downloadRecovery,
    draftConclusion,
    exportArchive,
    finish,
    keepDigging,
    resetLocalData,
    retry,
    saveCapsule,
    setDraft,
    submit,
    updateCapsule,
  };
}
