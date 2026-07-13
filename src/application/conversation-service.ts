import {
  OWNER_SCOPE,
  assertNever,
} from '../domain/contracts';
import type {
  Capsule,
  CapsuleId,
  ChallengeResult,
  ImmediateSafetyResult,
  Modality,
  NextQuestionResult,
  Operation,
  QuestioningProvider,
  RequestId,
  SourceTurnRange,
  SpecularError,
  SpecularErrorCode,
  Thread,
  ThreadId,
  Turn,
  TurnId,
  WorkingConclusion,
} from '../domain/contracts';
import {
  MAX_TITLE_LENGTH,
  MAX_TURN_CONTENT_LENGTH,
  capsuleIdSchema,
  capsuleSchema,
  threadIdSchema,
  threadSchema,
  turnIdSchema,
  turnSchema,
  workingConclusionSchema,
} from '../domain/schemas';
import {
  ProductValidationError,
  validateConclusionAuthorship,
  validateOperationResponse,
  validateOperationResult,
} from '../domain/validators';
import type { SpecularExport } from '../storage/export';
import type { LocalRepositories } from '../storage/repositories';
import { buildThreadContext } from './context-builder';
import { QuestioningClientError } from './http-questioning-client';
import {
  ProductTelemetry,
  type ProductTelemetryEventName,
} from './product-telemetry';

export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SpecularError };

export interface ConversationIdGenerator {
  threadId(): ThreadId;
  turnId(): TurnId;
  capsuleId(): CapsuleId;
}

export interface SubmittedTurnResult {
  thread: Thread;
  userTurn: Turn;
  responseTurn: Turn;
  output: NextQuestionResult | ImmediateSafetyResult;
}

export interface VoiceExchangeResult {
  thread: Thread;
  userTurn: Turn;
  responseTurn: Turn;
}

export interface ChallengeOperationResult {
  thread: Thread;
  responseTurn: Turn;
  output: ChallengeResult | ImmediateSafetyResult;
}

export interface ConclusionOperationResult {
  thread: Thread;
  responseTurn: Turn;
  output: WorkingConclusion | ImmediateSafetyResult;
}

export interface SaveCapsuleInput {
  threadId: ThreadId;
  title: string;
  conclusion: WorkingConclusion;
  sourceTurnRange: SourceTurnRange;
}

export interface SaveAndFinishResult {
  capsule: Capsule;
  thread: Thread;
}

export type CapsuleThreadMode = 'branch' | 'continue';

export interface ConversationServiceOptions {
  repositories: LocalRepositories;
  client: QuestioningProvider;
  ids?: ConversationIdGenerator;
  now?: () => number;
  telemetry?: ProductTelemetry;
}

function defaultIdGenerator(): ConversationIdGenerator {
  return {
    threadId: () => threadIdSchema.parse(`thread:${globalThis.crypto.randomUUID()}`),
    turnId: () => turnIdSchema.parse(`turn:${globalThis.crypto.randomUUID()}`),
    capsuleId: () => capsuleIdSchema.parse(`capsule:${globalThis.crypto.randomUUID()}`),
  };
}

function success<T>(value: T): ServiceResult<T> {
  return { ok: true, value };
}

function errorMessage(code: SpecularErrorCode): string {
  switch (code) {
    case 'offline':
      return "You're offline. Your writing is saved and ready to retry.";
    case 'timeout':
      return 'The request timed out. Your writing is saved and ready to retry.';
    case 'provider_unavailable':
      return 'Specular is temporarily unavailable. Your writing is saved.';
    case 'invalid_output':
      return 'Specular could not form a valid response. Please retry.';
    case 'rate_limited':
      return 'Specular is receiving too many requests. Please retry shortly.';
    case 'storage_failure':
      return 'Specular could not update local storage.';
    default:
      return assertNever(code);
  }
}

function serviceError(code: SpecularErrorCode, requestId?: RequestId): SpecularError {
  const base = {
    code,
    message: errorMessage(code),
    retryable: true,
  } as const;
  return requestId === undefined ? base : { ...base, requestId };
}

function failure<T>(code: SpecularErrorCode, requestId?: RequestId): ServiceResult<T> {
  return { ok: false, error: serviceError(code, requestId) };
}

function normalizeTitle(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return (normalized === undefined || normalized.length === 0 ? fallback : normalized)
    .slice(0, MAX_TITLE_LENGTH);
}

function nextQuestionContent(output: NextQuestionResult): string {
  return output.setup === undefined
    ? output.question
    : `${output.setup}\n\n${output.question}`;
}

function challengeContent(output: ChallengeResult): string {
  switch (output.kind) {
    case 'blind_spot':
      return output.question;
    case 'counter_position':
      return `${output.counterPosition}\n\n${output.question}`;
    default:
      return assertNever(output);
  }
}

function immediateSafetyContent(output: ImmediateSafetyResult): string {
  return `${output.guidance}\n\n${output.question}`;
}

function providerError(error: unknown): SpecularError {
  if (error instanceof QuestioningClientError) {
    return serviceError(error.code, error.requestId);
  }
  if (error instanceof ProductValidationError) {
    return serviceError('invalid_output');
  }
  return serviceError('provider_unavailable');
}

function nextPosition(turns: Turn[]): number {
  return turns.reduce((maximum, turn) => Math.max(maximum, turn.position), -1) + 1;
}

function isBoundedFinalTranscript(value: string): boolean {
  return value.trim().length > 0 && value.length <= MAX_TURN_CONTENT_LENGTH;
}

function appendTurnId(turnIds: TurnId[], turnId: TurnId): TurnId[] {
  return turnIds.includes(turnId) ? turnIds : [...turnIds, turnId];
}

function hasAcceptedUserProvenance(conclusion: WorkingConclusion, turns: Turn[]): boolean {
  const turnIds = new Set(turns
    .filter((turn) => turn.role === 'user' && turn.deliveryState === 'accepted')
    .map((turn) => turn.id));
  return conclusion.provenance.every((source) => turnIds.has(source.turnId));
}

export class ConversationService {
  private readonly repositories: LocalRepositories;
  private readonly client: QuestioningProvider;
  private readonly ids: ConversationIdGenerator;
  private readonly now: () => number;
  private readonly telemetry: ProductTelemetry;

  constructor(options: ConversationServiceOptions) {
    this.repositories = options.repositories;
    this.client = options.client;
    this.ids = options.ids ?? defaultIdGenerator();
    this.now = options.now ?? Date.now;
    this.telemetry = options.telemetry
      ?? new ProductTelemetry(options.repositories.preferences, { now: this.now });
  }

  async startThread(title?: string): Promise<ServiceResult<Thread>> {
    const timestamp = this.now();
    try {
      const thread = threadSchema.parse({
        id: this.ids.threadId(),
        ownerScope: OWNER_SCOPE,
        title: normalizeTitle(title, 'New topic'),
        lifecycleState: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
        turnIds: [],
        understanding: {
          claims: [],
          observations: [],
          stakeholders: [],
          contexts: [],
          distinctions: [],
          tensions: [],
          exploredBlindSpots: [],
          unexploredBlindSpots: [],
        },
      });
      await this.repositories.threads.put(thread);
      await this.recordTelemetry('thread_started');
      return success(thread);
    } catch {
      return failure('storage_failure');
    }
  }

  async submitUserTurn(
    threadId: ThreadId,
    content: string,
    modality: Modality = 'text',
  ): Promise<ServiceResult<SubmittedTurnResult>> {
    let userTurn: Turn;
    try {
      const thread = await this.requireActiveThread(threadId);
      const turns = await this.repositories.turns.listByThread(threadId);
      userTurn = turnSchema.parse({
        id: this.ids.turnId(),
        ownerScope: OWNER_SCOPE,
        threadId,
        role: 'user',
        content,
        modality,
        createdAt: this.now(),
        position: nextPosition(turns),
        operation: 'next_question',
        deliveryState: 'pending',
      });
      const updatedThread = threadSchema.parse({
        ...thread,
        updatedAt: this.now(),
        turnIds: appendTurnId(thread.turnIds, userTurn.id),
      });
      await this.repositories.conversation.persistPendingTurn({
        thread: updatedThread,
        userTurn,
      });
    } catch {
      return failure('storage_failure');
    }

    await this.recordTelemetry('turn_sent');
    return this.completePendingUserTurn(userTurn);
  }

  async acceptVoiceExchange(
    threadId: ThreadId,
    userTranscript: string,
    assistantTranscript: string,
  ): Promise<ServiceResult<VoiceExchangeResult>> {
    if (
      !isBoundedFinalTranscript(userTranscript)
      || !isBoundedFinalTranscript(assistantTranscript)
    ) {
      return failure('invalid_output');
    }

    let thread: Thread;
    let turns: Turn[];
    try {
      thread = threadSchema.parse(await this.requireActiveThread(threadId));
      turns = await this.repositories.turns.listByThread(threadId);
    } catch {
      return failure('storage_failure');
    }

    let output: NextQuestionResult;
    try {
      output = validateOperationResult('next_question', {
        kind: 'question',
        question: assistantTranscript,
        understanding: thread.understanding,
      });
    } catch {
      return failure('invalid_output');
    }

    try {
      const timestamp = this.now();
      const userPosition = nextPosition(turns);
      const userTurn = turnSchema.parse({
        id: this.ids.turnId(),
        ownerScope: OWNER_SCOPE,
        threadId,
        role: 'user',
        content: userTranscript,
        modality: 'voice',
        createdAt: timestamp,
        position: userPosition,
        operation: 'next_question',
        deliveryState: 'accepted',
      });
      const responseTurn = turnSchema.parse({
        id: this.ids.turnId(),
        ownerScope: OWNER_SCOPE,
        threadId,
        role: 'specular',
        content: output.question,
        modality: 'voice',
        createdAt: timestamp,
        position: userPosition + 1,
        operation: 'next_question',
        deliveryState: 'accepted',
      });
      const updatedThread = threadSchema.parse({
        ...thread,
        updatedAt: timestamp,
        turnIds: appendTurnId(
          appendTurnId(thread.turnIds, userTurn.id),
          responseTurn.id,
        ),
      });
      await this.repositories.conversation.acceptExchange({
        thread: updatedThread,
        userTurn,
        responseTurn,
      });
      return success({ thread: updatedThread, userTurn, responseTurn });
    } catch {
      return failure('storage_failure');
    }
  }

  async retryTurn(turnId: TurnId): Promise<ServiceResult<SubmittedTurnResult>> {
    let pendingTurn: Turn;
    try {
      const stored = await this.repositories.turns.get(turnId);
      if (
        stored?.role !== 'user'
        || stored.operation !== 'next_question'
        || (stored.deliveryState !== 'failed' && stored.deliveryState !== 'pending')
      ) {
        return failure('storage_failure');
      }
      const thread = await this.requireActiveThread(stored.threadId);
      pendingTurn = turnSchema.parse({
        ...stored,
        deliveryState: 'pending',
      });
      const updatedThread = threadSchema.parse({
        ...thread,
        updatedAt: this.now(),
        turnIds: appendTurnId(thread.turnIds, pendingTurn.id),
      });
      await this.repositories.conversation.persistPendingTurn({
        thread: updatedThread,
        userTurn: pendingTurn,
      });
    } catch {
      return failure('storage_failure');
    }

    await this.recordTelemetry('turn_sent');
    return this.completePendingUserTurn(pendingTurn);
  }

  async challenge(threadId: ThreadId): Promise<ServiceResult<ChallengeOperationResult>> {
    let context;
    try {
      await this.requireActiveThread(threadId);
      context = await buildThreadContext(threadId, 'challenge', this.repositories);
    } catch {
      return failure('storage_failure');
    }
    await this.recordTelemetry('challenge_requested');

    let output: ChallengeResult | ImmediateSafetyResult;
    try {
      output = validateOperationResponse('challenge', await this.client.challenge(context));
    } catch (error) {
      const mapped = providerError(error);
      await this.recordTelemetry('recoverable_error');
      return { ok: false, error: mapped };
    }

    try {
      const thread = await this.requireActiveThread(threadId);
      const turns = await this.repositories.turns.listByThread(threadId);
      const responseTurn = this.createSpecularTurn(
        threadId,
        nextPosition(turns),
        output.kind === 'immediate_safety' ? 'next_question' : 'challenge',
        output.kind === 'immediate_safety'
          ? immediateSafetyContent(output)
          : challengeContent(output),
      );
      const updatedThread = threadSchema.parse({
        ...thread,
        updatedAt: this.now(),
        turnIds: appendTurnId(thread.turnIds, responseTurn.id),
      });
      await this.repositories.conversation.persistSpecularTurn({
        thread: updatedThread,
        responseTurn,
      });
      return success({ thread: updatedThread, responseTurn, output });
    } catch {
      return failure('storage_failure');
    }
  }

  async draftConclusion(threadId: ThreadId): Promise<ServiceResult<ConclusionOperationResult>> {
    let context;
    try {
      await this.requireActiveThread(threadId);
      context = await buildThreadContext(threadId, 'conclusion', this.repositories);
    } catch {
      return failure('storage_failure');
    }
    await this.recordTelemetry('conclusion_requested');

    let output: WorkingConclusion | ImmediateSafetyResult;
    try {
      const validated = validateOperationResponse(
        'conclusion',
        await this.client.draftConclusion(context),
      );
      if (validated.kind === 'immediate_safety') {
        output = validated;
      } else {
        output = workingConclusionSchema.parse({
          ...validateConclusionAuthorship(validated, context.turns),
          editState: 'organized',
        });
      }
    } catch (error) {
      const mapped = providerError(error);
      await this.recordTelemetry('recoverable_error');
      return { ok: false, error: mapped };
    }

    try {
      const thread = await this.requireActiveThread(threadId);
      const turns = await this.repositories.turns.listByThread(threadId);
      const responseTurn = this.createSpecularTurn(
        threadId,
        nextPosition(turns),
        output.kind === 'immediate_safety' ? 'next_question' : 'conclusion',
        output.kind === 'immediate_safety'
          ? immediateSafetyContent(output)
          : output.thesis,
      );
      const updatedThread = threadSchema.parse({
        ...thread,
        updatedAt: this.now(),
        turnIds: appendTurnId(thread.turnIds, responseTurn.id),
        ...(output.kind === 'immediate_safety'
          ? {}
          : { provisionalConclusion: output }),
      });
      await this.repositories.conversation.persistSpecularTurn({
        thread: updatedThread,
        responseTurn,
      });
      return success({ thread: updatedThread, responseTurn, output });
    } catch {
      return failure('storage_failure');
    }
  }

  async keepDigging(
    threadId: ThreadId,
    conclusion: WorkingConclusion,
  ): Promise<ServiceResult<Thread>> {
    try {
      const thread = await this.requireActiveThread(threadId);
      const turns = await this.repositories.turns.listByThread(threadId);
      const editedConclusion = workingConclusionSchema.parse({
        ...conclusion,
        editState: 'edited',
        editedAt: this.now(),
      });
      if (!hasAcceptedUserProvenance(editedConclusion, turns)) {
        return failure('storage_failure');
      }
      const updatedThread = threadSchema.parse({
        ...thread,
        updatedAt: this.now(),
        provisionalConclusion: editedConclusion,
      });
      await this.repositories.threads.put(updatedThread);
      return success(updatedThread);
    } catch {
      return failure('storage_failure');
    }
  }

  async saveCapsule(input: SaveCapsuleInput): Promise<ServiceResult<Capsule>> {
    try {
      const capsule = await this.buildCapsule(input);
      await this.repositories.capsules.put(capsule);
      await this.recordTelemetry('capsule_saved');
      return success(capsule);
    } catch {
      return failure('storage_failure');
    }
  }

  async saveAndFinish(
    input: SaveCapsuleInput,
  ): Promise<ServiceResult<SaveAndFinishResult>> {
    try {
      const thread = await this.requireActiveThread(input.threadId);
      const capsule = await this.buildCapsule(input);
      const timestamp = this.now();
      const completedThread = threadSchema.parse({
        ...thread,
        lifecycleState: 'completed',
        completedAt: timestamp,
        provisionalConclusion: capsule.conclusion,
        updatedAt: timestamp,
      });
      const freshThread = threadSchema.parse({
        id: this.ids.threadId(),
        ownerScope: OWNER_SCOPE,
        title: 'New topic',
        lifecycleState: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
        turnIds: [],
        understanding: {
          claims: [],
          observations: [],
          stakeholders: [],
          contexts: [],
          distinctions: [],
          tensions: [],
          exploredBlindSpots: [],
          unexploredBlindSpots: [],
        },
      });
      await this.repositories.conversation.finishAndStart({
        capsule,
        completedThread,
        freshThread,
      });
      await Promise.all([
        this.recordTelemetry('capsule_saved'),
        this.recordTelemetry('thread_started'),
      ]);
      return success({ capsule, thread: freshThread });
    } catch {
      return failure('storage_failure');
    }
  }

  async startFromCapsule(
    capsuleId: CapsuleId,
    mode: CapsuleThreadMode,
  ): Promise<ServiceResult<Thread>> {
    try {
      const capsule = await this.repositories.capsules.get(capsuleId);
      if (capsule === undefined) {
        return failure('storage_failure');
      }
      const sourceThread = await this.repositories.threads.get(capsule.sourceThreadId);
      let title: string;
      switch (mode) {
        case 'continue':
          title = capsule.title;
          break;
        case 'branch':
          title = capsule.title + ' — branch';
          break;
        default:
          return assertNever(mode);
      }
      const timestamp = this.now();
      const thread = threadSchema.parse({
        id: this.ids.threadId(),
        ownerScope: OWNER_SCOPE,
        title: normalizeTitle(title, 'New topic'),
        lifecycleState: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
        turnIds: [],
        understanding: sourceThread?.understanding ?? {
          claims: [],
          observations: [],
          stakeholders: [],
          contexts: [],
          distinctions: [],
          tensions: [],
          exploredBlindSpots: [],
          unexploredBlindSpots: [],
        },
        provisionalConclusion: capsule.conclusion,
      });
      await this.repositories.threads.put(thread);
      await this.recordTelemetry('thread_started');
      return success(thread);
    } catch {
      return failure('storage_failure');
    }
  }

  async updateCapsule(
    capsuleId: CapsuleId,
    conclusion: WorkingConclusion,
  ): Promise<ServiceResult<Capsule>> {
    try {
      const capsule = await this.repositories.capsules.get(capsuleId);
      if (capsule === undefined) {
        return failure('storage_failure');
      }
      const provenanceIsUnchanged = conclusion.provenance.length
        === capsule.conclusion.provenance.length
        && conclusion.provenance.every((source, index) => {
          const original = capsule.conclusion.provenance[index];
          return source.turnId === original?.turnId
            && source.excerpt === original.excerpt;
        });
      if (!provenanceIsUnchanged) {
        return failure('storage_failure');
      }

      const sourceThread = await this.repositories.threads.get(capsule.sourceThreadId);
      const turns = await this.repositories.turns.listByThread(capsule.sourceThreadId);
      if (sourceThread === undefined) {
        const retainedSourceIds = new Set<TurnId>([
          capsule.sourceTurnRange.startTurnId,
          capsule.sourceTurnRange.endTurnId,
          ...capsule.conclusion.provenance.map((source) => source.turnId),
        ]);
        const retainedSourceTurns = await Promise.all(
          [...retainedSourceIds].map((turnId) => this.repositories.turns.get(turnId)),
        );
        if (turns.length > 0 || retainedSourceTurns.some((turn) => turn !== undefined)) {
          return failure('storage_failure');
        }
      }
      if (sourceThread !== undefined) {
        const byId = new Map(turns.map((turn) => [turn.id, turn]));
        const start = byId.get(capsule.sourceTurnRange.startTurnId);
        const end = byId.get(capsule.sourceTurnRange.endTurnId);
        if (start === undefined || end === undefined || start.position > end.position) {
          return failure('storage_failure');
        }
        const provenanceIsWithinRange = capsule.conclusion.provenance.every((source) => {
          const turn = byId.get(source.turnId);
          return turn !== undefined
            && turn.position >= start.position
            && turn.position <= end.position;
        });
        if (!provenanceIsWithinRange) {
          return failure('storage_failure');
        }
      }

      const timestamp = this.now();
      const editedConclusion = workingConclusionSchema.parse({
        ...conclusion,
        provenance: capsule.conclusion.provenance,
        editState: 'edited',
        editedAt: timestamp,
      });
      const updated = capsuleSchema.parse({
        ...capsule,
        conclusion: editedConclusion,
        updatedAt: timestamp,
      });
      await this.repositories.capsules.put(updated);
      return success(updated);
    } catch {
      return failure('storage_failure');
    }
  }

  async finishThread(threadId: ThreadId): Promise<ServiceResult<Thread>> {
    try {
      const thread = await this.requireActiveThread(threadId);
      const timestamp = this.now();
      const completedThread = threadSchema.parse({
        ...thread,
        lifecycleState: 'completed',
        completedAt: timestamp,
        updatedAt: timestamp,
      });
      const freshThread = threadSchema.parse({
        id: this.ids.threadId(),
        ownerScope: OWNER_SCOPE,
        title: 'New topic',
        lifecycleState: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
        turnIds: [],
        understanding: {
          claims: [],
          observations: [],
          stakeholders: [],
          contexts: [],
          distinctions: [],
          tensions: [],
          exploredBlindSpots: [],
          unexploredBlindSpots: [],
        },
      });
      await this.repositories.conversation.finishAndStart({
        completedThread,
        freshThread,
      });
      await this.recordTelemetry('thread_started');
      return success(freshThread);
    } catch {
      return failure('storage_failure');
    }
  }

  async exportAll(): Promise<ServiceResult<SpecularExport>> {
    try {
      return success(await this.repositories.export.exportAll());
    } catch {
      return failure('storage_failure');
    }
  }

  async deleteThread(threadId: ThreadId): Promise<ServiceResult<void>> {
    try {
      await this.repositories.threads.delete(threadId);
      return success(undefined);
    } catch {
      return failure('storage_failure');
    }
  }

  async deleteCapsule(capsuleId: CapsuleId): Promise<ServiceResult<void>> {
    try {
      await this.repositories.capsules.delete(capsuleId);
      return success(undefined);
    } catch {
      return failure('storage_failure');
    }
  }

  async deleteAll(): Promise<ServiceResult<void>> {
    try {
      await this.repositories.export.deleteAll();
      return success(undefined);
    } catch {
      return failure('storage_failure');
    }
  }

  private async buildCapsule(input: SaveCapsuleInput): Promise<Capsule> {
    await this.requireActiveThread(input.threadId);
    const turns = await this.repositories.turns.listByThread(input.threadId);
    const byId = new Map(turns.map((turn) => [turn.id, turn]));
    const start = byId.get(input.sourceTurnRange.startTurnId);
    const end = byId.get(input.sourceTurnRange.endTurnId);
    if (start === undefined || end === undefined || start.position > end.position) {
      throw new Error('Capsule source range is invalid.');
    }

    const timestamp = this.now();
    const editedConclusion = workingConclusionSchema.parse({
      ...input.conclusion,
      editState: 'edited',
      editedAt: timestamp,
    });
    const provenanceIsWithinRange = editedConclusion.provenance.every((source) => {
      const turn = byId.get(source.turnId);
      return turn !== undefined
        && turn.position >= start.position
        && turn.position <= end.position;
    });
    if (!provenanceIsWithinRange) {
      throw new Error('Capsule provenance is outside the source range.');
    }

    return capsuleSchema.parse({
      id: this.ids.capsuleId(),
      ownerScope: OWNER_SCOPE,
      title: normalizeTitle(input.title, 'Saved conclusion'),
      createdAt: timestamp,
      updatedAt: timestamp,
      conclusion: editedConclusion,
      sourceThreadId: input.threadId,
      sourceTurnRange: input.sourceTurnRange,
    });
  }

  private async completePendingUserTurn(
    userTurn: Turn,
  ): Promise<ServiceResult<SubmittedTurnResult>> {
    let context;
    try {
      context = await buildThreadContext(userTurn.threadId, 'next_question', this.repositories);
    } catch {
      return this.failUserTurn(userTurn, serviceError('storage_failure'));
    }

    let output: NextQuestionResult | ImmediateSafetyResult;
    try {
      output = validateOperationResponse(
        'next_question',
        await this.client.nextQuestion(context),
      );
    } catch (error) {
      return this.failUserTurn(userTurn, providerError(error));
    }

    try {
      const thread = await this.requireActiveThread(userTurn.threadId);
      const turns = await this.repositories.turns.listByThread(userTurn.threadId);
      const acceptedUserTurn = turnSchema.parse({
        ...userTurn,
        deliveryState: 'accepted',
      });
      const responseTurn = this.createSpecularTurn(
        userTurn.threadId,
        nextPosition(turns),
        'next_question',
        output.kind === 'immediate_safety'
          ? immediateSafetyContent(output)
          : nextQuestionContent(output),
      );
      const updatedThread = threadSchema.parse({
        ...thread,
        updatedAt: this.now(),
        turnIds: appendTurnId(
          appendTurnId(thread.turnIds, acceptedUserTurn.id),
          responseTurn.id,
        ),
        understanding: output.kind === 'immediate_safety'
          ? context.understanding
          : output.understanding,
      });
      await this.repositories.conversation.acceptExchange({
        thread: updatedThread,
        userTurn: acceptedUserTurn,
        responseTurn,
      });
      return success({
        thread: updatedThread,
        userTurn: acceptedUserTurn,
        responseTurn,
        output,
      });
    } catch {
      return this.failUserTurn(userTurn, serviceError('storage_failure'));
    }
  }

  private async failUserTurn<T>(turn: Turn, error: SpecularError): Promise<ServiceResult<T>> {
    try {
      await this.repositories.turns.put(turnSchema.parse({
        ...turn,
        deliveryState: 'failed',
      }));
    } catch {
      return failure('storage_failure');
    }
    await this.recordTelemetry('recoverable_error');
    return { ok: false, error };
  }

  private createSpecularTurn(
    threadId: ThreadId,
    position: number,
    operation: Operation,
    content: string,
  ): Turn {
    return turnSchema.parse({
      id: this.ids.turnId(),
      ownerScope: OWNER_SCOPE,
      threadId,
      role: 'specular',
      content,
      modality: 'text',
      createdAt: this.now(),
      position,
      operation,
      deliveryState: 'accepted',
    });
  }

  private async requireActiveThread(threadId: ThreadId): Promise<Thread> {
    const thread = await this.repositories.threads.get(threadId);
    if (thread?.lifecycleState !== 'active') {
      throw new Error('The selected thread is unavailable.');
    }
    return thread;
  }

  private async recordTelemetry(name: ProductTelemetryEventName): Promise<void> {
    try {
      await this.telemetry.record(name);
    } catch {
      return;
    }
  }
}
