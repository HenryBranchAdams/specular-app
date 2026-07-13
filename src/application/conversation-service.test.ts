import {
  IDBFactory,
  IDBObjectStore as FakeIdbObjectStore,
} from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ChallengeResult,
  ImmediateSafetyResult,
  NextQuestionResult,
  QuestioningProvider,
  Thread,
  ThreadContext,
  ThreadId,
  ThreadUnderstanding,
  Turn,
  TurnId,
  WorkingConclusion,
  WorkingConclusionResult,
} from '../domain/contracts';
import {
  MAX_CONTEXT_TURNS,
  MAX_TURN_CONTENT_LENGTH,
  threadContextSchema,
  threadIdSchema,
  threadSchema,
  turnIdSchema,
  turnSchema,
} from '../domain/schemas';
import { createLocalRepositories } from '../storage/indexed-db';
import type { LocalRepositories } from '../storage/repositories';
import {
  ConversationService,
  type ConversationIdGenerator,
  type ServiceResult,
} from './conversation-service';
import {
  MAX_THREAD_CONTEXT_PAYLOAD_LENGTH,
  buildThreadContext,
} from './context-builder';
import {
  HttpQuestioningClient,
  QuestioningClientError,
} from './http-questioning-client';
import {
  ProductTelemetry,
  type ProductTelemetryEventName,
} from './product-telemetry';

const EMPTY_UNDERSTANDING: ThreadUnderstanding = {
  claims: [],
  observations: [],
  stakeholders: [],
  contexts: [],
  distinctions: [],
  tensions: [],
  exploredBlindSpots: [],
  unexploredBlindSpots: [],
};

const UPDATED_UNDERSTANDING: ThreadUnderstanding = {
  ...EMPTY_UNDERSTANDING,
  claims: ['A smaller launch may preserve learning.'],
  stakeholders: ['The first customer cohort.'],
};

const VALID_QUESTION: NextQuestionResult = {
  kind: 'question',
  question: 'Which customer would notice the launch change first?',
  understanding: UPDATED_UNDERSTANDING,
};

const VALID_CHALLENGE: ChallengeResult = {
  kind: 'blind_spot',
  question: 'Which person bears the cost if the launch assumption is wrong?',
};

interface Deferred<T> {
  promise: Promise<T>;
  reject(error: unknown): void;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  const resolvers: {
    reject?: (error: unknown) => void;
    resolve?: (value: T | PromiseLike<T>) => void;
  } = {};
  const promise = new Promise<T>((resolve, reject) => {
    resolvers.resolve = resolve;
    resolvers.reject = reject;
  });

  return {
    promise,
    reject(error) {
      if (resolvers.reject === undefined) {
        throw new Error('Deferred reject resolver was not initialized.');
      }
      resolvers.reject(error);
    },
    resolve(value) {
      if (resolvers.resolve === undefined) {
        throw new Error('Deferred resolve resolver was not initialized.');
      }
      resolvers.resolve(value);
    },
  };
}

function abortOnNthPut(storeName: string, occurrence: number): void {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- restored with the object-store receiver below.
  const originalPut = FakeIdbObjectStore.prototype.put;
  let matches = 0;
  vi.spyOn(FakeIdbObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    const request = key === undefined
      ? originalPut.call(this, value)
      : originalPut.call(this, value, key);
    if (this.name === storeName) {
      matches += 1;
      if (matches === occurrence) {
        this.transaction.abort();
      }
    }
    return request;
  });
}

function validConclusion(
  turnId: TurnId,
  content = 'The handoff is where the launch gets stuck.',
): WorkingConclusionResult {
  const firstWord = content.split(/\s/u)[0];
  if (firstWord === undefined || firstWord === content) {
    throw new Error('Conclusion fixtures need at least two distinct exact excerpts.');
  }
  return {
    kind: 'working_conclusion',
    thesis: content,
    insights: [firstWord],
    observations: [],
    tensions: [],
    caveats: [],
    provenance: [
      { turnId, excerpt: content },
      { turnId, excerpt: firstWord },
    ],
  };
}

const IMMEDIATE_SAFETY: ImmediateSafetyResult = {
  kind: 'immediate_safety',
  guidance: 'Contact immediate support now.',
  question: 'Can you contact one trusted person now?',
};

type NextQuestionHandler = (
  context: ThreadContext,
) => Promise<NextQuestionResult | ImmediateSafetyResult>;
type ChallengeHandler = (
  context: ThreadContext,
) => Promise<ChallengeResult | ImmediateSafetyResult>;
type ConclusionHandler = (
  context: ThreadContext,
) => Promise<WorkingConclusionResult | ImmediateSafetyResult>;

class CompleteTestQuestioningProvider implements QuestioningProvider {
  nextQuestionHandler: NextQuestionHandler = () => Promise.resolve(VALID_QUESTION);
  challengeHandler: ChallengeHandler = () => Promise.resolve(VALID_CHALLENGE);
  conclusionHandler: ConclusionHandler = (context) => {
    const sourceTurn = context.turns.find((turn) => turn.role === 'user');
    return sourceTurn === undefined
      ? Promise.reject(new Error('Gathering needs one accepted user turn.'))
      : Promise.resolve(validConclusion(sourceTurn.id, sourceTurn.content));
  };

  nextQuestion(context: ThreadContext): Promise<NextQuestionResult | ImmediateSafetyResult> {
    return this.nextQuestionHandler(context);
  }

  challenge(context: ThreadContext): Promise<ChallengeResult | ImmediateSafetyResult> {
    return this.challengeHandler(context);
  }

  draftConclusion(
    context: ThreadContext,
  ): Promise<WorkingConclusionResult | ImmediateSafetyResult> {
    return this.conclusionHandler(context);
  }
}

function createIdGenerator(): ConversationIdGenerator {
  let threadCount = 0;
  let turnCount = 0;
  let capsuleCount = 0;

  return {
    threadId() {
      threadCount += 1;
      return threadIdSchema.parse(`thread-${String(threadCount)}`);
    },
    turnId() {
      turnCount += 1;
      return turnIdSchema.parse(`turn-${String(turnCount)}`);
    },
    capsuleId() {
      capsuleCount += 1;
      return `capsule-${String(capsuleCount)}` as ReturnType<ConversationIdGenerator['capsuleId']>;
    },
  };
}

function createClock(start = 1_000): () => number {
  let current = start;
  return () => {
    current += 1;
    return current;
  };
}

interface ServiceFixture {
  client: CompleteTestQuestioningProvider;
  indexedDBFactory: IDBFactory;
  repositories: LocalRepositories;
  service: ConversationService;
}

async function createServiceFixture(): Promise<ServiceFixture> {
  const indexedDBFactory = new IDBFactory();
  const repositories = await createLocalRepositories('local', indexedDBFactory);
  const client = new CompleteTestQuestioningProvider();
  const now = createClock();
  const telemetry = new ProductTelemetry(repositories.preferences, { now });
  const service = new ConversationService({
    repositories,
    client,
    ids: createIdGenerator(),
    now,
    telemetry,
  });
  openRepositories.push(repositories);
  return { client, indexedDBFactory, repositories, service };
}

function unwrap<T>(result: ServiceResult<T>): T {
  if (!result.ok) {
    throw new Error(`Expected success, received ${result.error.code}.`);
  }
  return result.value;
}

function workingConclusion(
  output: WorkingConclusion | ImmediateSafetyResult,
): WorkingConclusion {
  if (output.kind === 'immediate_safety') {
    throw new Error('Expected gathered notes, received immediate safety guidance.');
  }
  return output;
}

function nextQuestion(
  output: NextQuestionResult | ImmediateSafetyResult,
): NextQuestionResult {
  if (output.kind === 'immediate_safety') {
    throw new Error('Expected a next question, received immediate safety guidance.');
  }
  return output;
}

function makeThread(id: ThreadId, turnIds: TurnId[], overrides: Partial<Thread> = {}): Thread {
  return threadSchema.parse({
    id,
    ownerScope: 'local',
    title: `Thread ${id}`,
    lifecycleState: 'active',
    createdAt: 10,
    updatedAt: 20,
    turnIds,
    understanding: EMPTY_UNDERSTANDING,
    ...overrides,
  });
}

function makeTurn(
  id: TurnId,
  threadId: ThreadId,
  position: number,
  content = `Turn ${String(position)}`,
): Turn {
  return turnSchema.parse({
    id,
    ownerScope: 'local',
    threadId,
    role: position % 2 === 0 ? 'user' : 'specular',
    content,
    modality: 'text',
    createdAt: 100 + position,
    position,
    operation: 'next_question',
    deliveryState: 'accepted',
  });
}

const openRepositories: LocalRepositories[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (openRepositories.length > 0) {
    openRepositories.pop()?.close();
  }
});

describe('ConversationService orchestration', () => {
  it('atomically accepts one ordered voice exchange after existing turns without a provider call', async () => {
    const {
      client,
      indexedDBFactory,
      repositories,
      service,
    } = await createServiceFixture();
    const thread = unwrap(await service.startThread('Shared voice thread'));
    const existing = unwrap(await service.submitUserTurn(
      thread.id,
      'The launch handoff is still the constraint.',
    ));
    const nextQuestion = vi.spyOn(client, 'nextQuestion');

    const exchange = unwrap(await service.acceptVoiceExchange(
      thread.id,
      'The support team hears the uncertainty first.',
      'Which launch assumption needs the strongest evidence first?',
    ));

    expect(nextQuestion).not.toHaveBeenCalled();
    expect(exchange.userTurn).toMatchObject({
      ownerScope: 'local',
      threadId: thread.id,
      role: 'user',
      content: 'The support team hears the uncertainty first.',
      modality: 'voice',
      position: 2,
      operation: 'next_question',
      deliveryState: 'accepted',
    });
    expect(exchange.responseTurn).toMatchObject({
      ownerScope: 'local',
      threadId: thread.id,
      role: 'specular',
      content: 'Which launch assumption needs the strongest evidence first?',
      modality: 'voice',
      position: 3,
      operation: 'next_question',
      deliveryState: 'accepted',
    });
    expect(exchange.thread).toMatchObject({
      id: thread.id,
      understanding: existing.thread.understanding,
      turnIds: [
        existing.userTurn.id,
        existing.responseTurn.id,
        exchange.userTurn.id,
        exchange.responseTurn.id,
      ],
    });
    expect(exchange.thread.updatedAt).toBeGreaterThan(existing.thread.updatedAt);
    expect(await repositories.turns.listByThread(thread.id)).toEqual([
      existing.userTurn,
      existing.responseTurn,
      exchange.userTurn,
      exchange.responseTurn,
    ]);
    expect(await repositories.threads.get(thread.id)).toEqual(exchange.thread);

    repositories.close();
    const reopened = await createLocalRepositories('local', indexedDBFactory);
    openRepositories.push(reopened);
    expect(await reopened.turns.listByThread(thread.id)).toEqual([
      existing.userTurn,
      existing.responseTurn,
      exchange.userTurn,
      exchange.responseTurn,
    ]);
    expect(await reopened.threads.get(thread.id)).toEqual(exchange.thread);
  });

  it.each([
    { label: 'empty', transcript: '' },
    { label: 'whitespace-only', transcript: '   ' },
    { label: 'oversized', transcript: 'x'.repeat(MAX_TURN_CONTENT_LENGTH + 1) },
  ])('rejects a $label final user voice transcript without writing', async ({ transcript }) => {
    const { repositories, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('Invalid voice input'));
    const acceptExchange = vi.spyOn(repositories.conversation, 'acceptExchange');

    const result = await service.acceptVoiceExchange(
      thread.id,
      transcript,
      'Which launch assumption needs the strongest evidence first?',
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_output' } });
    expect(acceptExchange).not.toHaveBeenCalled();
    expect(await repositories.turns.listByThread(thread.id)).toEqual([]);
    expect((await repositories.threads.get(thread.id))?.turnIds).toEqual([]);
  });

  it.each([
    { label: 'empty', transcript: '' },
    { label: 'invalid', transcript: 'This transcript contains no question.' },
    { label: 'why-question', transcript: 'Why does the launch assumption matter?' },
    {
      label: 'multi-question',
      transcript: 'Which assumption is weakest? Which evidence would change the decision?',
    },
    {
      label: 'over-28-word',
      transcript: `${Array.from({ length: 29 }, () => 'boundary').join(' ')}?`,
    },
    { label: 'oversized', transcript: `${'x'.repeat(MAX_TURN_CONTENT_LENGTH)}?` },
  ])('rejects a $label final assistant voice transcript without writing', async ({ transcript }) => {
    const { repositories, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('Invalid voice response'));
    const acceptExchange = vi.spyOn(repositories.conversation, 'acceptExchange');

    const result = await service.acceptVoiceExchange(
      thread.id,
      'The support team hears the uncertainty first.',
      transcript,
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_output' } });
    expect(acceptExchange).not.toHaveBeenCalled();
    expect(await repositories.turns.listByThread(thread.id)).toEqual([]);
    expect((await repositories.threads.get(thread.id))?.turnIds).toEqual([]);
  });

  it('rejects missing, inactive, and wrong-owner threads without writing', async () => {
    const { repositories, service } = await createServiceFixture();
    const active = unwrap(await service.startThread('Voice ownership'));
    const inactive = threadSchema.parse({
      ...active,
      lifecycleState: 'completed',
      completedAt: active.updatedAt + 1,
    });
    await repositories.threads.put(inactive);
    const acceptExchange = vi.spyOn(repositories.conversation, 'acceptExchange');
    const validUser = 'The support team hears the uncertainty first.';
    const validAssistant = 'Which launch assumption needs the strongest evidence first?';

    const missing = await service.acceptVoiceExchange(
      threadIdSchema.parse('missing-thread'),
      validUser,
      validAssistant,
    );
    const completed = await service.acceptVoiceExchange(active.id, validUser, validAssistant);
    vi.spyOn(repositories.threads, 'get').mockResolvedValueOnce({
      ...active,
      ownerScope: 'another-owner',
    } as unknown as Thread);
    const wrongOwner = await service.acceptVoiceExchange(active.id, validUser, validAssistant);

    for (const result of [missing, completed, wrongOwner]) {
      expect(result).toMatchObject({ ok: false, error: { code: 'storage_failure' } });
    }
    expect(acceptExchange).not.toHaveBeenCalled();
    expect(await repositories.turns.listByThread(active.id)).toEqual([]);
  });

  it('rolls back both voice turns when the atomic accepted exchange fails', async () => {
    const { repositories, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('Atomic voice exchange'));
    abortOnNthPut('turns', 2);

    const result = await service.acceptVoiceExchange(
      thread.id,
      'The support team hears the uncertainty first.',
      'Which launch assumption needs the strongest evidence first?',
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'storage_failure' } });
    expect(await repositories.turns.listByThread(thread.id)).toEqual([]);
    expect((await repositories.threads.get(thread.id))?.turnIds).toEqual([]);
  });

  it('feeds accepted voice turns into the existing Challenge and conclusion contexts', async () => {
    const { client, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('Voice context'));
    const exchange = unwrap(await service.acceptVoiceExchange(
      thread.id,
      'The support team hears the uncertainty first.',
      'Which launch assumption needs the strongest evidence first?',
    ));
    let challengeContext: ThreadContext | undefined;
    let conclusionContext: ThreadContext | undefined;
    client.challengeHandler = (context) => {
      challengeContext = context;
      return Promise.resolve(VALID_CHALLENGE);
    };
    client.conclusionHandler = (context) => {
      conclusionContext = context;
      return Promise.resolve(validConclusion(
        exchange.userTurn.id,
        exchange.userTurn.content,
      ));
    };

    unwrap(await service.challenge(thread.id));
    unwrap(await service.draftConclusion(thread.id));

    expect(challengeContext?.operation).toBe('challenge');
    expect(challengeContext?.turns.slice(0, 2)).toEqual([
      exchange.userTurn,
      exchange.responseTurn,
    ]);
    expect(conclusionContext?.operation).toBe('conclusion');
    expect(conclusionContext?.turns).toEqual(expect.arrayContaining([
      exchange.userTurn,
      exchange.responseTurn,
    ]));
  });

  it('rolls back the full pending exchange and does not dispatch after a write failure', async () => {
    const { client, repositories, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('Atomic pending exchange'));
    let providerDispatched = false;
    client.nextQuestionHandler = () => {
      providerDispatched = true;
      return Promise.resolve(VALID_QUESTION);
    };
    abortOnNthPut('threads', 1);

    const result = await service.submitUserTurn(thread.id, 'This write must be all or nothing.');

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'storage_failure' },
    });
    expect(providerDispatched).toBe(false);
    expect(await repositories.turns.listByThread(thread.id)).toEqual([]);
    expect((await repositories.threads.get(thread.id))?.turnIds).toEqual([]);
  });

  it('rolls back an accepted exchange failure and preserves one retryable user turn', async () => {
    const { repositories, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('Atomic accepted exchange'));
    abortOnNthPut('threads', 2);

    const result = await service.submitUserTurn(thread.id, 'Preserve this once for retry.');

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'storage_failure' },
    });
    const failedTurns = await repositories.turns.listByThread(thread.id);
    expect(failedTurns).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'Preserve this once for retry.',
        deliveryState: 'failed',
      }),
    ]);
    expect((await repositories.threads.get(thread.id))?.understanding).toEqual(
      EMPTY_UNDERSTANDING,
    );

    vi.restoreAllMocks();
    const retried = unwrap(await service.retryTurn(failedTurns[0]?.id ?? turnIdSchema.parse('missing')));
    expect(retried.output).toEqual(VALID_QUESTION);
    expect((await repositories.turns.listByThread(thread.id)).filter(
      (turn) => turn.role === 'user',
    )).toHaveLength(1);
  });

  it('rolls back completion when the fresh replacement thread cannot commit', async () => {
    const { repositories, service } = await createServiceFixture();
    const oldThread = unwrap(await service.startThread('Atomic finish'));
    abortOnNthPut('threads', 2);

    const result = await service.finishThread(oldThread.id);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'storage_failure' },
    });
    const storedOldThread = await repositories.threads.get(oldThread.id);
    expect(storedOldThread?.lifecycleState).toBe('active');
    expect(storedOldThread?.completedAt).toBeUndefined();
    expect((await repositories.threads.list()).map((thread) => thread.id)).toEqual([
      oldThread.id,
    ]);
  });

  it('makes the pending user write durable before dispatch and persists accepted output afterward', async () => {
    const { client, repositories, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('A launch decision'));
    const response = createDeferred<NextQuestionResult>();
    const callOrder: string[] = [];
    client.nextQuestionHandler = async (context) => {
      const [storedTurns, storedThread] = await Promise.all([
        repositories.turns.listByThread(thread.id),
        repositories.threads.get(thread.id),
      ]);
      if (
        storedTurns.at(-1)?.deliveryState === 'pending'
        && storedThread?.turnIds.at(-1) === storedTurns.at(-1)?.id
      ) {
        callOrder.push('pending-write-complete');
      }
      callOrder.push('network-dispatched');
      expect(context.turns.at(-1)).toMatchObject({
        role: 'user',
        content: 'The handoff is where the launch gets stuck.',
        deliveryState: 'pending',
      });
      return response.promise;
    };

    const pendingSubmission = service.submitUserTurn(
      thread.id,
      'The handoff is where the launch gets stuck.',
    );

    await expect.poll(() => callOrder).toEqual([
      'pending-write-complete',
      'network-dispatched',
    ]);
    const turnsBeforeResponse = await repositories.turns.listByThread(thread.id);
    expect(turnsBeforeResponse).toHaveLength(1);
    expect(turnsBeforeResponse[0]).toMatchObject({
      role: 'user',
      deliveryState: 'pending',
    });
    expect((await repositories.threads.get(thread.id))?.understanding).toEqual(
      EMPTY_UNDERSTANDING,
    );

    response.resolve(VALID_QUESTION);
    const submission = unwrap(await pendingSubmission);
    expect(submission.output).toEqual(VALID_QUESTION);

    const turnsAfterResponse = await repositories.turns.listByThread(thread.id);
    expect(turnsAfterResponse).toHaveLength(2);
    expect(turnsAfterResponse[0]).toMatchObject({
      role: 'user',
      deliveryState: 'accepted',
    });
    expect(turnsAfterResponse[1]).toMatchObject({
      role: 'specular',
      operation: 'next_question',
      deliveryState: 'accepted',
      content: 'Which customer would notice the launch change first?',
    });
    expect((await repositories.threads.get(thread.id))?.understanding).toEqual(
      UPDATED_UNDERSTANDING,
    );
  });

  it('rejects invalid output without persisting it and retries the same user turn', async () => {
    const { client, repositories, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('A product claim'));
    client.nextQuestionHandler = () => Promise.resolve({
      kind: 'question',
      question: 'Why does that matter?',
      understanding: UPDATED_UNDERSTANDING,
    });

    const failed = await service.submitUserTurn(thread.id, 'The promise feels too broad.');

    expect(failed).toMatchObject({
      ok: false,
      error: { code: 'invalid_output', retryable: true },
    });
    const failedTurns = await repositories.turns.listByThread(thread.id);
    expect(failedTurns).toHaveLength(1);
    expect(failedTurns[0]).toMatchObject({
      role: 'user',
      content: 'The promise feels too broad.',
      deliveryState: 'failed',
    });
    expect((await repositories.threads.get(thread.id))?.understanding).toEqual(
      EMPTY_UNDERSTANDING,
    );

    client.nextQuestionHandler = () => Promise.resolve(VALID_QUESTION);
    const retried = unwrap(await service.retryTurn(failedTurns[0]?.id ?? turnIdSchema.parse('missing')));

    expect(retried.output).toEqual(VALID_QUESTION);
    const retriedTurns = await repositories.turns.listByThread(thread.id);
    expect(retriedTurns.filter((turn) => turn.role === 'user')).toHaveLength(1);
    expect(retriedTurns.filter((turn) => turn.content === 'The promise feels too broad.')).toHaveLength(1);
    expect(retriedTurns).toHaveLength(2);
  });

  it('keeps timed-out writing failed and retryable without fabricating a response', async () => {
    const { client, repositories, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('An offline-safe thought'));
    client.nextQuestionHandler = () => Promise.reject(new QuestioningClientError('timeout'));

    const result = await service.submitUserTurn(thread.id, 'Keep this exact writing.');

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'timeout', retryable: true },
    });
    expect(await repositories.turns.listByThread(thread.id)).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'Keep this exact writing.',
        deliveryState: 'failed',
      }),
    ]);
  });

  it.each(['offline', 'provider_unavailable'] as const)(
    'preserves failed writing for the typed %s application error',
    async (code) => {
      const { client, repositories, service } = await createServiceFixture();
      const thread = unwrap(await service.startThread(`Typed ${code}`));
      client.nextQuestionHandler = () => Promise.reject(new QuestioningClientError(code));

      const result = await service.submitUserTurn(thread.id, 'Keep this writing retryable.');

      expect(result).toMatchObject({
        ok: false,
        error: { code, retryable: true },
      });
      expect(await repositories.turns.listByThread(thread.id)).toEqual([
        expect.objectContaining({
          role: 'user',
          content: 'Keep this writing retryable.',
          deliveryState: 'failed',
        }),
      ]);
    },
  );

  it('runs Challenge and conclusion only through their explicit operations', async () => {
    const { repositories, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('Explicit operations'));
    const submitted = unwrap(await service.submitUserTurn(thread.id, 'A small launch seems safer.'));

    expect(submitted.output.kind).toBe('question');
    expect((await repositories.threads.get(thread.id))?.provisionalConclusion).toBeUndefined();
    expect((await repositories.turns.listByThread(thread.id)).map((turn) => turn.operation)).toEqual([
      'next_question',
      'next_question',
    ]);

    const challenged = unwrap(await service.challenge(thread.id));
    expect(challenged.output).toEqual(VALID_CHALLENGE);
    expect(challenged.responseTurn.operation).toBe('challenge');
    expect((await repositories.threads.get(thread.id))?.provisionalConclusion).toBeUndefined();

    const concluded = unwrap(await service.draftConclusion(thread.id));
    const conclusion = workingConclusion(concluded.output);
    expect(conclusion).toMatchObject({
      kind: 'working_conclusion',
      editState: 'organized',
    });
    expect(concluded.responseTurn.operation).toBe('conclusion');
    expect((await repositories.threads.get(thread.id))?.provisionalConclusion).toEqual(
      conclusion,
    );
  });

  it('accepts an immediate-safety next response while preserving understanding', async () => {
    const { client, repositories, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('Safety interruption'));
    await service.submitUserTurn(thread.id, 'A smaller launch may preserve learning.');
    client.nextQuestionHandler = () => Promise.resolve(IMMEDIATE_SAFETY);

    const submitted = unwrap(await service.submitUserTurn(
      thread.id,
      'I need immediate support for this moment.',
    ));

    expect(submitted.output).toEqual(IMMEDIATE_SAFETY);
    expect(submitted.userTurn.deliveryState).toBe('accepted');
    expect(submitted.responseTurn.content).toBe(
      `${IMMEDIATE_SAFETY.guidance}\n\n${IMMEDIATE_SAFETY.question}`,
    );
    expect(submitted.responseTurn.operation).toBe('next_question');
    expect(submitted.thread.understanding).toEqual(UPDATED_UNDERSTANDING);
    expect((await repositories.threads.get(thread.id))?.understanding).toEqual(
      UPDATED_UNDERSTANDING,
    );
  });

  it('persists immediate-safety challenge guidance without replacing a conclusion', async () => {
    const { client, repositories, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('Safety challenge'));
    await service.submitUserTurn(thread.id, 'The handoff is still uncertain.');
    const drafted = unwrap(await service.draftConclusion(thread.id));
    const conclusion = workingConclusion(drafted.output);
    client.challengeHandler = () => Promise.resolve(IMMEDIATE_SAFETY);

    const challenged = unwrap(await service.challenge(thread.id));

    expect(challenged.output).toEqual(IMMEDIATE_SAFETY);
    expect(challenged.responseTurn.content).toBe(
      `${IMMEDIATE_SAFETY.guidance}\n\n${IMMEDIATE_SAFETY.question}`,
    );
    expect(challenged.responseTurn.operation).toBe('next_question');
    expect((await repositories.threads.get(thread.id))?.provisionalConclusion).toEqual(
      conclusion,
    );
  });

  it('persists immediate-safety gathering guidance without a provisional conclusion', async () => {
    const { client, repositories, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('Safety gathering'));
    await service.submitUserTurn(thread.id, 'The handoff is still uncertain.');
    client.conclusionHandler = () => Promise.resolve(IMMEDIATE_SAFETY);

    const gathered = unwrap(await service.draftConclusion(thread.id));

    expect(gathered.output).toEqual(IMMEDIATE_SAFETY);
    expect(gathered.responseTurn.content).toBe(
      `${IMMEDIATE_SAFETY.guidance}\n\n${IMMEDIATE_SAFETY.question}`,
    );
    expect(gathered.responseTurn.operation).toBe('next_question');
    expect(gathered.thread.provisionalConclusion).toBeUndefined();
    expect((await repositories.threads.get(thread.id))?.provisionalConclusion).toBeUndefined();
    expect(JSON.stringify(gathered.output)).not.toContain('provenance');
  });

  it('rejects gathered notes whose provenance points to Specular-authored text', async () => {
    const { client, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('Authorship boundary'));
    await service.submitUserTurn(thread.id, 'The handoff is where ownership disappears.');
    client.conclusionHandler = (context) => {
      const specularTurn = context.turns.find((turn) => turn.role === 'specular');
      if (specularTurn === undefined) {
        return Promise.reject(new Error('Expected a Specular turn.'));
      }
      return Promise.resolve(validConclusion(specularTurn.id));
    };

    await expect(service.draftConclusion(thread.id)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_output' },
    });
  });

  it('preserves an edited provisional conclusion on the same thread when digging deeper', async () => {
    const { repositories, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('Keep digging'));
    await service.submitUserTurn(thread.id, 'The handoff creates the uncertainty.');
    const drafted = unwrap(await service.draftConclusion(thread.id));
    const edited: WorkingConclusion = {
      ...workingConclusion(drafted.output),
      thesis: 'My edited thesis keeps the uncertainty visible.',
      insights: [
        'The handoff remains the constraint.',
        'The user chooses a reversible step.',
        'The evidence boundary stays explicit.',
      ],
      editState: 'edited',
      editedAt: 99,
    };

    const updated = unwrap(await service.keepDigging(thread.id, edited));

    expect(updated.id).toBe(thread.id);
    expect(updated.provisionalConclusion).toMatchObject({
      thesis: 'My edited thesis keeps the uncertainty visible.',
      insights: edited.insights,
      editState: 'edited',
    });
    expect((await repositories.threads.list()).map((stored) => stored.id)).toEqual([thread.id]);
  });

  it('saves user-edited capsule content with the exact inclusive source range', async () => {
    const { repositories, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('Capsule source'));
    const submission = unwrap(await service.submitUserTurn(thread.id, 'The handoff is the constraint.'));
    const drafted = unwrap(await service.draftConclusion(thread.id));
    const edited: WorkingConclusion = {
      ...workingConclusion(drafted.output),
      thesis: 'The user-edited thesis replaces the provider wording.',
      caveats: ['The source range is intentionally inclusive.'],
      editState: 'organized',
    };

    const capsule = unwrap(await service.saveCapsule({
      threadId: thread.id,
      title: 'A reversible launch',
      conclusion: edited,
      sourceTurnRange: {
        startTurnId: submission.userTurn.id,
        endTurnId: drafted.responseTurn.id,
      },
    }));

    expect(capsule).toMatchObject({
      title: 'A reversible launch',
      sourceThreadId: thread.id,
      sourceTurnRange: {
        startTurnId: submission.userTurn.id,
        endTurnId: drafted.responseTurn.id,
      },
      conclusion: {
        thesis: 'The user-edited thesis replaces the provider wording.',
        caveats: ['The source range is intentionally inclusive.'],
        editState: 'edited',
      },
    });
    expect(await repositories.capsules.get(capsule.id)).toEqual(capsule);
  });

  it('atomically saves the edited conclusion and finishes into a fresh thread', async () => {
    const { repositories, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('Reversible launch decision'));
    const submission = unwrap(await service.submitUserTurn(
      thread.id,
      'The launch handoff is still the constraint.',
    ));
    const drafted = unwrap(await service.draftConclusion(thread.id));

    const completed = unwrap(await service.saveAndFinish({
      threadId: thread.id,
      title: thread.title,
      conclusion: {
        ...workingConclusion(drafted.output),
        thesis: 'One observable ownership signal should define the handoff.',
      },
      sourceTurnRange: {
        startTurnId: submission.userTurn.id,
        endTurnId: drafted.responseTurn.id,
      },
    }));

    expect(completed.capsule).toMatchObject({
      title: thread.title,
      sourceThreadId: thread.id,
      conclusion: {
        thesis: 'One observable ownership signal should define the handoff.',
        editState: 'edited',
      },
    });
    expect(await repositories.capsules.get(completed.capsule.id)).toEqual(completed.capsule);
    expect(await repositories.threads.get(thread.id)).toMatchObject({
      lifecycleState: 'completed',
      provisionalConclusion: {
        thesis: 'One observable ownership signal should define the handoff.',
      },
    });
    expect(completed.thread).toMatchObject({
      lifecycleState: 'active',
      title: 'New topic',
      turnIds: [],
    });
  });

  it('starts continued and branched threads from a capsule without hidden global memory', async () => {
    const { repositories, service } = await createServiceFixture();
    const source = unwrap(await service.startThread('Observable launch ownership'));
    const submission = unwrap(await service.submitUserTurn(
      source.id,
      'The handoff needs one observable ownership signal.',
    ));
    const drafted = unwrap(await service.draftConclusion(source.id));
    const capsule = unwrap(await service.saveCapsule({
      threadId: source.id,
      title: source.title,
      conclusion: workingConclusion(drafted.output),
      sourceTurnRange: {
        startTurnId: submission.userTurn.id,
        endTurnId: drafted.responseTurn.id,
      },
    }));

    const continued = unwrap(await service.startFromCapsule(capsule.id, 'continue'));
    const branched = unwrap(await service.startFromCapsule(capsule.id, 'branch'));

    expect(continued).toMatchObject({
      title: capsule.title,
      understanding: nextQuestion(submission.output).understanding,
      provisionalConclusion: capsule.conclusion,
      turnIds: [],
    });
    expect(branched).toMatchObject({
      title: capsule.title + ' — branch',
      understanding: nextQuestion(submission.output).understanding,
      provisionalConclusion: capsule.conclusion,
      turnIds: [],
    });
    expect(continued.id).not.toBe(source.id);
    expect(branched.id).not.toBe(source.id);
    expect(branched.id).not.toBe(continued.id);
    expect(await repositories.turns.listByThread(continued.id)).toEqual([]);
    expect(await repositories.turns.listByThread(branched.id)).toEqual([]);
  });

  it('updates only editable capsule content while preserving identity and provenance', async () => {
    const { repositories, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('Editable capsule source'));
    const submission = unwrap(await service.submitUserTurn(
      thread.id,
      'The source remains attached to this exact thread.',
    ));
    const drafted = unwrap(await service.draftConclusion(thread.id));
    const capsule = unwrap(await service.saveCapsule({
      threadId: thread.id,
      title: 'Stable capsule title',
      conclusion: workingConclusion(drafted.output),
      sourceTurnRange: {
        startTurnId: submission.userTurn.id,
        endTurnId: drafted.responseTurn.id,
      },
    }));

    const updated = unwrap(await service.updateCapsule(capsule.id, {
      ...capsule.conclusion,
      thesis: 'The edited capsule remains provisional and locally owned.',
      insights: [
        'The source identity stays stable.',
        'The edit remains local.',
        'The original range remains inspectable.',
      ],
    }));

    expect(updated).toMatchObject({
      id: capsule.id,
      ownerScope: capsule.ownerScope,
      title: capsule.title,
      createdAt: capsule.createdAt,
      sourceThreadId: capsule.sourceThreadId,
      sourceTurnRange: capsule.sourceTurnRange,
      conclusion: {
        thesis: 'The edited capsule remains provisional and locally owned.',
        provenance: capsule.conclusion.provenance,
        editState: 'edited',
      },
    });
    expect(updated.updatedAt).toBeGreaterThan(capsule.updatedAt);
    expect(updated.conclusion.editedAt).toBe(updated.updatedAt);
    expect(await repositories.capsules.get(capsule.id)).toEqual(updated);
  });

  it('keeps a retained capsule editable after its source thread is permanently deleted', async () => {
    const { repositories, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('Durable capsule source'));
    const submission = unwrap(await service.submitUserTurn(
      thread.id,
      'The capsule must outlive the inquiry that produced it.',
    ));
    const drafted = unwrap(await service.draftConclusion(thread.id));
    const capsule = unwrap(await service.saveCapsule({
      threadId: thread.id,
      title: 'Independent retained capsule',
      conclusion: workingConclusion(drafted.output),
      sourceTurnRange: {
        startTurnId: submission.userTurn.id,
        endTurnId: drafted.responseTurn.id,
      },
    }));

    unwrap(await service.deleteThread(thread.id));
    const updated = unwrap(await service.updateCapsule(capsule.id, {
      ...capsule.conclusion,
      thesis: 'The retained capsule remains useful after its source is removed.',
    }));

    expect(updated).toMatchObject({
      id: capsule.id,
      ownerScope: capsule.ownerScope,
      title: capsule.title,
      createdAt: capsule.createdAt,
      sourceThreadId: capsule.sourceThreadId,
      sourceTurnRange: capsule.sourceTurnRange,
      conclusion: {
        thesis: 'The retained capsule remains useful after its source is removed.',
      },
    });
    expect(updated.conclusion.provenance).toEqual(capsule.conclusion.provenance);
    expect(await repositories.capsules.get(capsule.id)).toEqual(updated);
    expect(await repositories.threads.get(thread.id)).toBeUndefined();
    expect(await repositories.turns.listByThread(thread.id)).toEqual([]);
  });

  it('rejects an orphaned capsule edit when a retained source id belongs to another thread', async () => {
    const { repositories, service } = await createServiceFixture();
    const sourceThread = unwrap(await service.startThread('Orphan source'));
    const submission = unwrap(await service.submitUserTurn(
      sourceThread.id,
      'This exact source id must not be reassigned across threads.',
    ));
    const drafted = unwrap(await service.draftConclusion(sourceThread.id));
    const capsule = unwrap(await service.saveCapsule({
      threadId: sourceThread.id,
      title: 'Cross-thread guard',
      conclusion: workingConclusion(drafted.output),
      sourceTurnRange: {
        startTurnId: submission.userTurn.id,
        endTurnId: drafted.responseTurn.id,
      },
    }));
    unwrap(await service.deleteThread(sourceThread.id));
    const foreignThread = unwrap(await service.startThread('Foreign thread'));
    await repositories.turns.put(turnSchema.parse({
      ...submission.userTurn,
      threadId: foreignThread.id,
    }));

    const result = await service.updateCapsule(capsule.id, {
      ...capsule.conclusion,
      thesis: 'This edit must not cross a thread boundary.',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'storage_failure' } });
    expect(await repositories.capsules.get(capsule.id)).toEqual(capsule);
  });

  it('rejects a capsule edit whose provenance no longer resolves inside its source range', async () => {
    const { repositories, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('Validated capsule source'));
    const submission = unwrap(await service.submitUserTurn(thread.id, 'Keep the range exact.'));
    const drafted = unwrap(await service.draftConclusion(thread.id));
    const capsule = unwrap(await service.saveCapsule({
      threadId: thread.id,
      title: 'Validated capsule',
      conclusion: workingConclusion(drafted.output),
      sourceTurnRange: {
        startTurnId: submission.userTurn.id,
        endTurnId: drafted.responseTurn.id,
      },
    }));

    const result = await service.updateCapsule(capsule.id, {
      ...capsule.conclusion,
      provenance: [{
        turnId: turnIdSchema.parse('turn-outside-source-range'),
        excerpt: 'This source does not exist in the capsule thread.',
      }],
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'storage_failure' } });
    expect(await repositories.capsules.get(capsule.id)).toEqual(capsule);
  });

  it('finishes the old thread and returns a fresh unrelated empty thread', async () => {
    const { repositories, service } = await createServiceFixture();
    const oldThread = unwrap(await service.startThread('Old line'));
    await service.submitUserTurn(oldThread.id, 'The old line contains private context.');
    await service.draftConclusion(oldThread.id);

    const freshThread = unwrap(await service.finishThread(oldThread.id));

    expect(freshThread).toMatchObject({
      lifecycleState: 'active',
      turnIds: [],
      understanding: EMPTY_UNDERSTANDING,
    });
    expect(freshThread.id).not.toBe(oldThread.id);
    expect(freshThread.provisionalConclusion).toBeUndefined();
    expect(await repositories.turns.listByThread(freshThread.id)).toEqual([]);
    const completedThread = await repositories.threads.get(oldThread.id);
    expect(completedThread?.lifecycleState).toBe('completed');
    expect(typeof completedThread?.completedAt).toBe('number');
  });

  it('delegates export and permanent deletion to the owner-scoped repositories', async () => {
    const { repositories, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('Delete me'));
    const submitted = unwrap(await service.submitUserTurn(thread.id, 'Keep deletion owner-scoped.'));
    const drafted = unwrap(await service.draftConclusion(thread.id));
    const capsule = unwrap(await service.saveCapsule({
      threadId: thread.id,
      title: 'Delete this capsule',
      conclusion: workingConclusion(drafted.output),
      sourceTurnRange: {
        startTurnId: submitted.userTurn.id,
        endTurnId: drafted.responseTurn.id,
      },
    }));

    const archive = unwrap(await service.exportAll());
    expect(archive.threads.map((stored) => stored.id)).toEqual([thread.id]);
    expect(archive.capsules.map((stored) => stored.id)).toEqual([capsule.id]);

    unwrap(await service.deleteCapsule(capsule.id));
    unwrap(await service.deleteThread(thread.id));
    expect(await repositories.capsules.list()).toEqual([]);
    expect(await repositories.threads.list()).toEqual([]);
    expect(await repositories.turns.listByThread(thread.id)).toEqual([]);

    unwrap(await service.startThread('Delete all'));
    unwrap(await service.deleteAll());
    expect((await repositories.export.exportAll()).threads).toEqual([]);
  });

  it('maps repository failures to a concise typed storage error', async () => {
    const { repositories, service } = await createServiceFixture();
    repositories.close();

    const result = await service.startThread('Cannot persist after close');

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'storage_failure',
        message: 'Specular could not update local storage.',
        retryable: true,
      },
    });
  });
});

describe('buildThreadContext', () => {
  it('uses only the selected thread with ordered capped turns and retained provenance ids', async () => {
    const repositories = await createLocalRepositories('local', new IDBFactory());
    openRepositories.push(repositories);
    const selectedId = threadIdSchema.parse('thread-selected');
    const otherId = threadIdSchema.parse('thread-other');
    const selectedTurns = Array.from({ length: MAX_CONTEXT_TURNS + 5 }, (_, position) => {
      const id = turnIdSchema.parse(`selected-turn-${String(position)}`);
      return makeTurn(id, selectedId, position);
    });
    const otherTurn = makeTurn(turnIdSchema.parse('other-turn-1'), otherId, 0, 'Foreign context');
    const provenanceTurn = selectedTurns.at(-1);
    if (provenanceTurn === undefined) {
      throw new Error('Expected selected turn fixture.');
    }
    const provisionalConclusion: WorkingConclusion = {
      ...validConclusion(provenanceTurn.id),
      editState: 'edited',
      editedAt: 30,
    };
    await repositories.threads.put(makeThread(
      selectedId,
      selectedTurns.map((turn) => turn.id),
      { provisionalConclusion },
    ));
    await repositories.threads.put(makeThread(otherId, [otherTurn.id]));
    await Promise.all(selectedTurns.map((turn) => repositories.turns.put(turn)));
    await repositories.turns.put(otherTurn);

    const context = await buildThreadContext(selectedId, 'conclusion', repositories);

    expect(context.thread.id).toBe(selectedId);
    expect(context.turns).toHaveLength(MAX_CONTEXT_TURNS);
    expect(context.turns[0]?.position).toBe(5);
    expect(context.turns.at(-1)?.position).toBe(MAX_CONTEXT_TURNS + 4);
    expect(context.turns.map((turn) => turn.threadId)).toEqual(
      Array.from({ length: MAX_CONTEXT_TURNS }, () => selectedId),
    );
    expect(context.turns.some((turn) => turn.content === 'Foreign context')).toBe(false);
    expect(context.provisionalConclusion?.provenance).toEqual(provisionalConclusion.provenance);
  });

  it('caps the total serialized payload while retaining every included turn id', async () => {
    const repositories = await createLocalRepositories('local', new IDBFactory());
    openRepositories.push(repositories);
    const threadId = threadIdSchema.parse('thread-large-context');
    const turns = Array.from({ length: 60 }, (_, position) => makeTurn(
      turnIdSchema.parse(`large-turn-${String(position)}`),
      threadId,
      position,
      String(position).padStart(2, '0') + 'x'.repeat(MAX_TURN_CONTENT_LENGTH - 2),
    ));
    await repositories.threads.put(makeThread(threadId, turns.map((turn) => turn.id)));
    await Promise.all(turns.map((turn) => repositories.turns.put(turn)));

    const context = await buildThreadContext(threadId, 'next_question', repositories);

    expect(JSON.stringify(context).length).toBeLessThanOrEqual(MAX_THREAD_CONTEXT_PAYLOAD_LENGTH);
    expect(context.turns.length).toBeLessThan(turns.length);
    expect(context.turns.at(-1)?.id).toBe(turns.at(-1)?.id);
    expect(context.turns.every((turn) => turn.id.length > 0)).toBe(true);
  });
});

describe('ProductTelemetry', () => {
  it('defaults off, stores only fixed local events after opt-in, and clears on opt-out', async () => {
    const repositories = await createLocalRepositories('local', new IDBFactory());
    openRepositories.push(repositories);
    const timestamps = [10, 20, 30];
    const telemetry = new ProductTelemetry(repositories.preferences, {
      now: () => timestamps.shift() ?? 40,
    });
    type RecordAcceptsOnlyEventName = Parameters<ProductTelemetry['record']> extends [
      ProductTelemetryEventName,
    ] ? true : false;
    const recordAcceptsOnlyEventName: RecordAcceptsOnlyEventName = true;

    expect(recordAcceptsOnlyEventName).toBe(true);
    await repositories.preferences.put('productTelemetryEvents', [
      { name: 'turn_sent', timestamp: 1 },
    ]);
    await telemetry.record('thread_started');
    expect(await telemetry.isEnabled()).toBe(false);
    expect(await repositories.preferences.get('telemetryEnabled')).toBe(false);
    expect(await repositories.preferences.get('productTelemetryEvents')).toBeUndefined();
    expect(await telemetry.listEvents()).toEqual([]);

    await telemetry.setEnabled(true);
    await telemetry.record('thread_started');
    await telemetry.record('recoverable_error');
    expect(await telemetry.listEvents()).toEqual([
      { name: 'thread_started', timestamp: 10 },
      { name: 'recoverable_error', timestamp: 20 },
    ]);
    expect(Object.keys((await telemetry.listEvents())[0] ?? {}).sort()).toEqual([
      'name',
      'timestamp',
    ]);

    await expect(
      telemetry.record('authored content is not an event' as ProductTelemetryEventName),
    ).rejects.toThrow(/telemetry event/u);
    await telemetry.setEnabled(false);
    expect(await telemetry.listEvents()).toEqual([]);
    expect(await repositories.preferences.get('productTelemetryEvents')).toBeUndefined();
  });

  it('keeps opt-out final when another instance records concurrently', async () => {
    const factory = new IDBFactory();
    const recordingRepositories = await createLocalRepositories('local', factory);
    const disablingRepositories = await createLocalRepositories('local', factory);
    openRepositories.push(recordingRepositories, disablingRepositories);
    const disablingTelemetry = new ProductTelemetry(disablingRepositories.preferences);
    let optOut: Promise<void> | undefined;
    const recordingTelemetry = new ProductTelemetry(recordingRepositories.preferences, {
      now: () => {
        optOut = disablingTelemetry.setEnabled(false);
        return 50;
      },
    });
    await recordingTelemetry.setEnabled(true);

    await recordingTelemetry.record('turn_sent');
    await optOut;

    expect(await recordingRepositories.preferences.get('telemetryEnabled')).toBe(false);
    expect(
      await recordingRepositories.preferences.get('productTelemetryEvents'),
    ).toBeUndefined();
  });
});

describe('HttpQuestioningClient', () => {
  const context = threadContextSchema.parse({
    thread: { id: 'thread-http' },
    turns: [],
    understanding: EMPTY_UNDERSTANDING,
    operation: 'next_question',
  });

  it('posts typed context to the operation endpoint and validates the accepted response', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const client = new HttpQuestioningClient({
      baseUrl: 'https://specular.example/api/operations/',
      fetch: (input, init) => {
        capturedUrl = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
        capturedInit = init;
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          value: VALID_QUESTION,
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }));
      },
    });

    const result = await client.nextQuestion(context);

    expect(result).toEqual(VALID_QUESTION);
    expect(capturedUrl).toBe('https://specular.example/api/operations/next-question');
    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.headers).toEqual({ 'content-type': 'application/json' });
    const capturedBody = capturedInit?.body;
    if (typeof capturedBody !== 'string') {
      throw new Error('Expected a serialized HTTP request body.');
    }
    expect(JSON.parse(capturedBody)).toEqual({ context });
  });

  it.each(['next_question', 'challenge', 'conclusion'] as const)(
    'returns immediate safety from a successful %s envelope',
    async (operation) => {
      const operationContext = threadContextSchema.parse({
        ...context,
        operation,
      });
      const client = new HttpQuestioningClient({
        fetch: () => Promise.resolve(new Response(JSON.stringify({
          ok: true,
          value: IMMEDIATE_SAFETY,
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),
      });

      const result = operation === 'next_question'
        ? await client.nextQuestion(operationContext)
        : operation === 'challenge'
          ? await client.challenge(operationContext)
          : await client.draftConclusion(operationContext);

      expect(result).toEqual(IMMEDIATE_SAFETY);
    },
  );

  it('preserves typed server failures and rejects invalid success output', async () => {
    const rateLimited = new HttpQuestioningClient({
      fetch: () => Promise.resolve(new Response(JSON.stringify({
        ok: false,
        error: {
          code: 'rate_limited',
          message: 'Please retry shortly.',
          retryable: true,
          requestId: 'request-42',
        },
      }), { status: 429 })),
    });

    await expect(rateLimited.nextQuestion(context)).rejects.toMatchObject({
      code: 'rate_limited',
      requestId: 'request-42',
    });

    const invalid = new HttpQuestioningClient({
      fetch: () => Promise.resolve(new Response(JSON.stringify({
        ok: true,
        value: {
          kind: 'question',
          question: 'Why does that matter?',
          understanding: EMPTY_UNDERSTANDING,
        },
      }), { status: 200 })),
    });
    await expect(invalid.nextQuestion(context)).rejects.toMatchObject({
      code: 'invalid_output',
    });
  });

  it('maps offline preflight and unavailable-provider fetch failures', async () => {
    let offlineFetchInvoked = false;
    const offline = new HttpQuestioningClient({
      isOnline: () => false,
      fetch: () => {
        offlineFetchInvoked = true;
        return Promise.reject(new Error('Fetch must not run while offline.'));
      },
    });
    await expect(offline.nextQuestion(context)).rejects.toMatchObject({ code: 'offline' });
    expect(offlineFetchInvoked).toBe(false);

    const unavailable = new HttpQuestioningClient({
      isOnline: () => true,
      fetch: () => Promise.reject(new TypeError('Network failed.')),
    });
    await expect(unavailable.nextQuestion(context)).rejects.toMatchObject({
      code: 'provider_unavailable',
    });
  });

  it('aborts a stalled request and returns a typed timeout', async () => {
    const client = new HttpQuestioningClient({
      timeoutMs: 1,
      fetch: (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }),
    });

    await expect(client.nextQuestion(context)).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('keeps the timeout active while reading a stalled response body', async () => {
    const client = new HttpQuestioningClient({
      timeoutMs: 5,
      fetch: (_input, init) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener('abort', () => {
              controller.error(new DOMException('Aborted', 'AbortError'));
            });
          },
        });
        return Promise.resolve(new Response(stream, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }));
      },
    });

    const outcome = await Promise.race([
      client.nextQuestion(context).catch((error: unknown) => error),
      new Promise<'still-pending'>((resolve) => {
        setTimeout(() => { resolve('still-pending'); }, 40);
      }),
    ]);

    expect(outcome).toMatchObject({ code: 'timeout' });
  });
});
