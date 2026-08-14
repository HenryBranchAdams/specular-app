import { describe, expect, it } from 'vitest';
import { createInitialWorkspace, effectiveStatus, workspaceStateSchema } from './model';

describe('thinking model', () => {
  it('creates one local writing document with a fourteen-day dormancy default', () => {
    const state = createInitialWorkspace(100);
    expect(state.documents).toHaveLength(1);
    expect(state.blocks).toHaveLength(1);
    expect(state.settings).toEqual({ contextScope: 'document', dormancyDays: 14, dictationCleanup: 'faithful' });
    expect(state.dictationDraft).toBeNull();
    expect(workspaceStateSchema.parse(state)).toEqual(state);
  });

  it('keeps an interrupted dictation draft outside canonical block content', () => {
    const state = createInitialWorkspace(100);
    const block = state.blocks[0];
    if (block === undefined) throw new Error('Expected an initial block.');
    const parsed = workspaceStateSchema.parse({
      ...state,
      dictationDraft: {
        id: 'dictation:one',
        blockId: block.id,
        content: 'A provisional spoken thought.',
        verbatim: 'A provisional spoken thought.',
        insertionOffset: 0,
        cleanupMode: 'faithful',
        status: 'interrupted',
        interruptionReason: 'connection_lost',
        startedAt: 100,
        updatedAt: 200,
      },
    });

    expect(parsed.blocks[0]?.content).toBe('');
    expect(parsed.dictationDraft?.content).toBe('A provisional spoken thought.');
  });

  it('treats staleness as a visual dormant state without rewriting explicit status', () => {
    const day = 24 * 60 * 60 * 1_000;
    expect(effectiveStatus(0, 'active', 14, 14 * day)).toBe('dormant');
    expect(effectiveStatus(0, 'resting', 14, 30 * day)).toBe('resting');
    expect(effectiveStatus(0, 'closed', 14, 30 * day)).toBe('closed');
  });
});
