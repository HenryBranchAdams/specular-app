import type {
  ChallengeResult,
  ImmediateSafetyResult,
  NextQuestionResult,
  ThreadContext,
  WorkingConclusionResult,
} from './schemas';

export type {
  BlindSpotChallengeResult,
  Capsule,
  CapsuleId,
  ChallengeResult,
  ConclusionEditState,
  ConclusionProvenance,
  CounterPositionChallengeResult,
  DeliveryState,
  GlobalId,
  ImmediateSafetyResult,
  Modality,
  NextQuestionResult,
  Operation,
  OperationResult,
  OperationResponse,
  OwnerScope,
  RequestId,
  SourceTurnRange,
  SpecularError,
  SpecularErrorCode,
  Thread,
  ThreadContext,
  ThreadContextThread,
  ThreadId,
  ThreadLifecycleState,
  ThreadUnderstanding,
  Turn,
  TurnId,
  TurnRole,
  WorkingConclusion,
  WorkingConclusionResult,
} from './schemas';

export const OWNER_SCOPE = 'local' as const;

export interface QuestioningProvider {
  nextQuestion(context: ThreadContext): Promise<NextQuestionResult | ImmediateSafetyResult>;
  challenge(context: ThreadContext): Promise<ChallengeResult | ImmediateSafetyResult>;
  draftConclusion(context: ThreadContext): Promise<WorkingConclusionResult | ImmediateSafetyResult>;
}

export function assertNever(value: never): never {
  throw new Error('Unhandled discriminated union variant: ' + JSON.stringify(value));
}
