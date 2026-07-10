import type {
  ChallengeResult,
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
  Modality,
  NextQuestionResult,
  Operation,
  OperationResult,
  OwnerScope,
  RequestId,
  SourceTurnRange,
  SpecularError,
  SpecularErrorCode,
  Thread,
  ThreadContext,
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
  nextQuestion(context: ThreadContext): Promise<NextQuestionResult>;
  challenge(context: ThreadContext): Promise<ChallengeResult>;
  draftConclusion(context: ThreadContext): Promise<WorkingConclusionResult>;
}

export function assertNever(value: never): never {
  throw new Error('Unhandled discriminated union variant: ' + JSON.stringify(value));
}
