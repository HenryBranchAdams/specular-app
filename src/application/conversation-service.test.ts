import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ChallengeResult,
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
  setup: 'Let us make the boundary concrete.',
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

function validConclusion(turnId: TurnId): WorkingConclusionResult {
  return {
    kind: 'working_conclusion',
    thesis: 'A smaller reversible launch best preserves learning.',
    insights: [
      'Coordination is the immediate constraint.',
      'Reversibility protects the learning loop.',
      'The first cohort can expose the decision boundary.',
    ],
    observations: ['Prior launches stalled during handoff.'],
    tensions: ['Speed may reduce stakeholder confidence.'],
    caveats: ['The thread contains no customer interview evidence.'],
    provenance: [{ turnId, excerpt: 'The handoff is where the launch gets stuck.' }],
  };
}

type NextQuestionHandler = (context: ThreadContext) => Promise<NextQuestionResult>;
type ChallengeHandler = (context: ThreadContext) => Promise<ChallengeResult>;
type ConclusionHandler = (context: ThreadContext) => Promise<WorkingConclusionResult>;

class CompleteTestQuestioningProvider implements QuestioningProvider {
  nextQuestionHandler: NextQuestionHandler = () => Promise.resolve(VALID_QUESTION);
  challengeHandler: ChallengeHandler = () => Promise.resolve(VALID_CHALLENGE);
  conclusionHandler: ConclusionHandler = (context) => {
    const sourceTurnId = context.turns.find((turn) => turn.role === 'user')?.id
      ?? turnIdSchema.parse('turn-1');
    return Promise.resolve(validConclusion(sourceTurnId));
  };

  nextQuestion(context: ThreadContext): Promise<NextQuestionResult> {
    return this.nextQuestionHandler(context);
  }

  challenge(context: ThreadContext): Promise<ChallengeResult> {
    return this.challengeHandler(context);
  }

  draftConclusion(context: ThreadContext): Promise<WorkingConclusionResult> {
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
  repositories: LocalRepositories;
  service: ConversationService;
}

async function createServiceFixture(): Promise<ServiceFixture> {
  const repositories = await createLocalRepositories('local', new IDBFactory());
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
  return { client, repositories, service };
}

function unwrap<T>(result: ServiceResult<T>): T {
  if (!result.ok) {
    throw new Error(`Expected success, received ${result.error.code}.`);
  }
  return result.value;
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
  while (openRepositories.length > 0) {
    openRepositories.pop()?.close();
  }
});

describe('ConversationService orchestration', () => {
  it('makes the pending user write durable before dispatch and persists accepted output afterward', async () => {
    const { client, repositories, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('A launch decision'));
    const response = createDeferred<NextQuestionResult>();
    const callOrder: string[] = [];
    const baseTurns = repositories.turns;
    const recordingRepositories: LocalRepositories = {
      ...repositories,
      turns: {
        get: (id) => baseTurns.get(id),
        listByThread: (threadId) => baseTurns.listByThread(threadId),
        async put(turn) {
          await baseTurns.put(turn);
          if (turn.role === 'user' && turn.deliveryState === 'pending') {
            callOrder.push('pending-write-complete');
          }
        },
      },
    };
    const recordingService = new ConversationService({
      repositories: recordingRepositories,
      client,
      ids: createIdGenerator(),
      now: createClock(2_000),
      telemetry: new ProductTelemetry(repositories.preferences, { now: createClock(3_000) }),
    });
    client.nextQuestionHandler = (context) => {
      callOrder.push('network-dispatched');
      expect(context.turns.at(-1)).toMatchObject({
        role: 'user',
        content: 'The handoff is where the launch gets stuck.',
        deliveryState: 'pending',
      });
      return response.promise;
    };

    const pendingSubmission = recordingService.submitUserTurn(
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
      content: 'Let us make the boundary concrete.\n\nWhich customer would notice the launch change first?',
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
    expect(concluded.output).toMatchObject({
      kind: 'working_conclusion',
      editState: 'generated',
    });
    expect(concluded.responseTurn.operation).toBe('conclusion');
    expect((await repositories.threads.get(thread.id))?.provisionalConclusion).toEqual(
      concluded.output,
    );
  });

  it('preserves an edited provisional conclusion on the same thread when digging deeper', async () => {
    const { repositories, service } = await createServiceFixture();
    const thread = unwrap(await service.startThread('Keep digging'));
    await service.submitUserTurn(thread.id, 'The handoff creates the uncertainty.');
    const drafted = unwrap(await service.draftConclusion(thread.id));
    const edited: WorkingConclusion = {
      ...drafted.output,
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
      ...drafted.output,
      thesis: 'The user-edited thesis replaces the provider wording.',
      caveats: ['The source range is intentionally inclusive.'],
      editState: 'generated',
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
      conclusion: drafted.output,
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
