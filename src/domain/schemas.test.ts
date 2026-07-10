import { describe, expect, it } from 'vitest';
import { threadContextSchema } from './schemas';

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
