import { z } from 'zod';

export const MAX_IDENTIFIER_LENGTH = 128;
export const MAX_TITLE_LENGTH = 200;
export const MAX_TURN_CONTENT_LENGTH = 12_000;
export const MAX_CONTEXT_TURNS = 200;
export const MAX_UNDERSTANDING_ITEMS = 32;
export const MAX_UNDERSTANDING_ITEM_LENGTH = 500;
export const MAX_RESULT_TEXT_LENGTH = 4_000;
export const MAX_PROVENANCE_ITEMS = 50;
export const MAX_NEXT_QUESTION_WORDS = 28;

const identifierSchema = z
  .string()
  .min(1)
  .max(MAX_IDENTIFIER_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const titleSchema = z.string().trim().min(1).max(MAX_TITLE_LENGTH);
const turnContentSchema = z.string().min(1).max(MAX_TURN_CONTENT_LENGTH);
const resultTextSchema = z.string().trim().min(1).max(MAX_RESULT_TEXT_LENGTH);
const timestampSchema = z.number().int().nonnegative().finite();
const understandingItemSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_UNDERSTANDING_ITEM_LENGTH);
const understandingItemsSchema = z
  .array(understandingItemSchema)
  .max(MAX_UNDERSTANDING_ITEMS);

export const globalIdSchema = identifierSchema.brand<'GlobalId'>();
export const threadIdSchema = identifierSchema.brand<'ThreadId'>();
export const turnIdSchema = identifierSchema.brand<'TurnId'>();
export const capsuleIdSchema = identifierSchema.brand<'CapsuleId'>();
export const requestIdSchema = identifierSchema.brand<'RequestId'>();

export const ownerScopeSchema = z.literal('local');
export const operationSchema = z.enum(['next_question', 'challenge', 'conclusion']);
export const turnRoleSchema = z.enum(['user', 'specular', 'system']);
export const modalitySchema = z.enum(['text', 'voice']);
export const deliveryStateSchema = z.enum(['pending', 'accepted', 'failed']);
export const threadLifecycleStateSchema = z.enum(['active', 'completed']);
export const conclusionEditStateSchema = z.enum(['generated', 'organized', 'edited']);

export const threadUnderstandingSchema = z.object({
  claims: understandingItemsSchema,
  observations: understandingItemsSchema,
  stakeholders: understandingItemsSchema,
  contexts: understandingItemsSchema,
  distinctions: understandingItemsSchema,
  tensions: understandingItemsSchema,
  exploredBlindSpots: understandingItemsSchema,
  unexploredBlindSpots: understandingItemsSchema,
}).strict();

export const conclusionProvenanceSchema = z.object({
  turnId: turnIdSchema,
  excerpt: z.string().trim().min(1).max(MAX_UNDERSTANDING_ITEM_LENGTH),
}).strict();

const conclusionFields = {
  kind: z.literal('working_conclusion'),
  thesis: resultTextSchema,
  insights: z.array(resultTextSchema).min(1).max(5),
  observations: z.array(resultTextSchema).max(10),
  tensions: z.array(resultTextSchema).max(3),
  caveats: z.array(resultTextSchema).max(10),
  provenance: z.array(conclusionProvenanceSchema).min(1).max(MAX_PROVENANCE_ITEMS),
} as const;

export const workingConclusionResultSchema = z.object(conclusionFields).strict();

export const workingConclusionSchema = z.object({
  ...conclusionFields,
  editState: conclusionEditStateSchema,
  editedAt: timestampSchema.optional(),
}).strict();

export const nextQuestionResultSchema = z.object({
  kind: z.literal('question'),
  question: resultTextSchema,
  understanding: threadUnderstandingSchema,
}).strict();

export const blindSpotChallengeResultSchema = z.object({
  kind: z.literal('blind_spot'),
  question: resultTextSchema,
}).strict();

export const counterPositionChallengeResultSchema = z.object({
  kind: z.literal('counter_position'),
  counterPosition: resultTextSchema,
  question: resultTextSchema,
}).strict();

export const immediateSafetyResultSchema = z.object({
  kind: z.literal('immediate_safety'),
  guidance: resultTextSchema,
  question: resultTextSchema,
}).strict();

export const challengeResultSchema = z.discriminatedUnion('kind', [
  blindSpotChallengeResultSchema,
  counterPositionChallengeResultSchema,
]);

export const operationResultSchema = z.discriminatedUnion('kind', [
  nextQuestionResultSchema,
  blindSpotChallengeResultSchema,
  counterPositionChallengeResultSchema,
  workingConclusionResultSchema,
]);

export const operationResponseSchema = z.union([
  operationResultSchema,
  immediateSafetyResultSchema,
]);

export const turnSchema = z.object({
  id: turnIdSchema,
  ownerScope: ownerScopeSchema,
  threadId: threadIdSchema,
  role: turnRoleSchema,
  content: turnContentSchema,
  modality: modalitySchema,
  createdAt: timestampSchema,
  position: z.number().int().nonnegative(),
  operation: operationSchema.optional(),
  deliveryState: deliveryStateSchema,
}).strict();

export const threadSchema = z.object({
  id: threadIdSchema,
  ownerScope: ownerScopeSchema,
  title: titleSchema,
  lifecycleState: threadLifecycleStateSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  completedAt: timestampSchema.optional(),
  turnIds: z.array(turnIdSchema).max(10_000),
  understanding: threadUnderstandingSchema,
  provisionalConclusion: workingConclusionSchema.optional(),
}).strict();

export const sourceTurnRangeSchema = z.object({
  startTurnId: turnIdSchema,
  endTurnId: turnIdSchema,
}).strict();

export const capsuleSchema = z.object({
  id: capsuleIdSchema,
  ownerScope: ownerScopeSchema,
  title: titleSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  conclusion: workingConclusionSchema,
  sourceThreadId: threadIdSchema,
  sourceTurnRange: sourceTurnRangeSchema,
}).strict();

export const threadContextThreadSchema = z.object({
  id: threadIdSchema,
}).strict();

export const threadContextSchema = z.object({
  thread: threadContextThreadSchema,
  turns: z.array(turnSchema).max(MAX_CONTEXT_TURNS),
  understanding: threadUnderstandingSchema,
  provisionalConclusion: workingConclusionSchema.optional(),
  operation: operationSchema,
}).strict().superRefine((context, refinement) => {
  const positions = new Set<number>();
  let previousPosition: number | undefined;

  context.turns.forEach((turn, index) => {
    if (turn.threadId !== context.thread.id) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Every context turn must belong to thread.id.',
        path: ['turns', index, 'threadId'],
      });
    }

    if (positions.has(turn.position)) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Context turn positions must be unique.',
        path: ['turns', index, 'position'],
      });
    }

    if (previousPosition !== undefined && turn.position <= previousPosition) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Context turns must be strictly ordered by increasing position.',
        path: ['turns', index, 'position'],
      });
    }

    positions.add(turn.position);
    previousPosition = turn.position;
  });
});

export const specularErrorCodeSchema = z.enum([
  'offline',
  'timeout',
  'provider_unavailable',
  'invalid_output',
  'rate_limited',
  'storage_failure',
]);

export const specularErrorSchema = z.object({
  code: specularErrorCodeSchema,
  message: z.string().trim().min(1).max(300),
  retryable: z.boolean(),
  requestId: requestIdSchema.optional(),
}).strict();

export type GlobalId = z.infer<typeof globalIdSchema>;
export type ThreadId = z.infer<typeof threadIdSchema>;
export type TurnId = z.infer<typeof turnIdSchema>;
export type CapsuleId = z.infer<typeof capsuleIdSchema>;
export type RequestId = z.infer<typeof requestIdSchema>;
export type OwnerScope = z.infer<typeof ownerScopeSchema>;
export type Operation = z.infer<typeof operationSchema>;
export type TurnRole = z.infer<typeof turnRoleSchema>;
export type Modality = z.infer<typeof modalitySchema>;
export type DeliveryState = z.infer<typeof deliveryStateSchema>;
export type ThreadLifecycleState = z.infer<typeof threadLifecycleStateSchema>;
export type ConclusionEditState = z.infer<typeof conclusionEditStateSchema>;
export type ThreadUnderstanding = z.infer<typeof threadUnderstandingSchema>;
export type ConclusionProvenance = z.infer<typeof conclusionProvenanceSchema>;
export type NextQuestionResult = z.infer<typeof nextQuestionResultSchema>;
export type BlindSpotChallengeResult = z.infer<typeof blindSpotChallengeResultSchema>;
export type CounterPositionChallengeResult = z.infer<typeof counterPositionChallengeResultSchema>;
export type ChallengeResult = z.infer<typeof challengeResultSchema>;
export type WorkingConclusionResult = z.infer<typeof workingConclusionResultSchema>;
export type WorkingConclusion = z.infer<typeof workingConclusionSchema>;
export type OperationResult = z.infer<typeof operationResultSchema>;
export type ImmediateSafetyResult = z.infer<typeof immediateSafetyResultSchema>;
export type OperationResponse = z.infer<typeof operationResponseSchema>;
export type Turn = z.infer<typeof turnSchema>;
export type Thread = z.infer<typeof threadSchema>;
export type SourceTurnRange = z.infer<typeof sourceTurnRangeSchema>;
export type Capsule = z.infer<typeof capsuleSchema>;
export type ThreadContextThread = z.infer<typeof threadContextThreadSchema>;
export type ThreadContext = z.infer<typeof threadContextSchema>;
export type SpecularErrorCode = z.infer<typeof specularErrorCodeSchema>;
export type SpecularError = z.infer<typeof specularErrorSchema>;
