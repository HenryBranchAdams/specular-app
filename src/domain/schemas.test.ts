import { describe, expect, it } from 'vitest';
import {
  MAX_NEXT_QUESTION_WORDS,
  MAX_RESULT_TEXT_LENGTH,
  immediateSafetyResultSchema,
  nextQuestionResultSchema,
  operationResponseSchema,
  threadContextSchema,
} from './schemas';

const EMPTY_UNDERSTANDING = {
  claims: [],
  observations: [],
  stakeholders: [],
  contexts: [],
  distinctions: [],
  tensions: [],
  exploredBlindSpots: [],
  unexploredBlindSpots: [],
};

function turn(threadId: string, position: number) {
  return {
    id: `turn-${String(position)}`,
    ownerScope: 'local',
    threadId,
    role: 'user',
    content: `Turn ${String(position)}`,
    modality: 'text',
    createdAt: position,
    position,
    operation: 'next_question',
    deliveryState: 'accepted',
  };
}

function context(turns: ReturnType<typeof turn>[]) {
  return {
    thread: { id: 'thread-1' },
    turns,
    understanding: EMPTY_UNDERSTANDING,
    operation: 'next_question',
  };
}

describe('threadContextSchema', () => {
  it('accepts ordered turns that all belong to thread.id', () => {
    const result = threadContextSchema.safeParse(context([
      turn('thread-1', 2),
      turn('thread-1', 5),
    ]));

    expect(result.success).toBe(true);
  });

  it('rejects a turn from a different thread', () => {
    const result = threadContextSchema.safeParse(context([
      turn('thread-1', 0),
      turn('thread-2', 1),
    ]));

    expect(result.success).toBe(false);
  });

  it('rejects duplicate turn positions', () => {
    const result = threadContextSchema.safeParse(context([
      turn('thread-1', 3),
      { ...turn('thread-1', 3), id: 'turn-duplicate' },
    ]));

    expect(result.success).toBe(false);
  });

  it('rejects turn positions that decrease in array order', () => {
    const result = threadContextSchema.safeParse(context([
      turn('thread-1', 4),
      turn('thread-1', 2),
    ]));

    expect(result.success).toBe(false);
  });
});

describe('immediateSafetyResultSchema', () => {
  const valid = {
    kind: 'immediate_safety',
    guidance: 'Contact immediate support now.',
    question: 'Can you contact one trusted person now?',
  } as const;

  it('accepts the strict shared response through the operation response union', () => {
    expect(immediateSafetyResultSchema.parse(valid)).toEqual(valid);
    expect(operationResponseSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    { ...valid, guidance: '' },
    { ...valid, question: ' ' },
    { ...valid, guidance: 'g'.repeat(MAX_RESULT_TEXT_LENGTH + 1) },
    { ...valid, question: 'q'.repeat(MAX_RESULT_TEXT_LENGTH + 1) },
    { ...valid, extra: 'not allowed' },
  ])('rejects invalid, overlong, or unknown fields', (value) => {
    expect(immediateSafetyResultSchema.safeParse(value).success).toBe(false);
  });
});

describe('nextQuestionResultSchema', () => {
  const valid = {
    kind: 'question',
    question: 'Which customer would notice the launch change first?',
    understanding: EMPTY_UNDERSTANDING,
  } as const;

  it('defines the ordinary-question limit once and accepts only the current fields', () => {
    expect(MAX_NEXT_QUESTION_WORDS).toBe(28);
    expect(nextQuestionResultSchema.parse(valid)).toEqual(valid);
    expect(Object.keys(nextQuestionResultSchema.parse(valid)).sort()).toEqual([
      'kind',
      'question',
      'understanding',
    ]);
  });

  it('rejects the removed setup field', () => {
    expect(nextQuestionResultSchema.safeParse({
      ...valid,
      setup: 'Let us make the boundary concrete.',
    }).success).toBe(false);
  });
});
