import { describe, expect, it } from 'vitest';
import { createInitialWorkspace } from './model';
import { recoverWorkspaceState } from './persistence';

describe('workspace persistence recovery', () => {
  it('recovers an unfinished recording as an interrupted text draft', () => {
    const state = createInitialWorkspace(100);
    const block = state.blocks[0];
    if (block === undefined) throw new Error('Expected an initial block.');

    const recovered = recoverWorkspaceState({
      ...state,
      dictationDraft: {
        id: 'dictation:one',
        blockId: block.id,
        content: 'The checkpointed words survive.',
        verbatim: 'The checkpointed words survive.',
        insertionOffset: 0,
        cleanupMode: 'faithful',
        status: 'recording',
        interruptionReason: null,
        startedAt: 100,
        updatedAt: 200,
      },
    });

    expect(recovered.dictationDraft).toMatchObject({
      content: 'The checkpointed words survive.',
      status: 'interrupted',
      interruptionReason: 'storage_failure',
    });
    expect(recovered.blocks[0]?.content).toBe('');
  });

  it('leaves paused and review drafts in their deliberate state', () => {
    const state = createInitialWorkspace(100);
    const blockId = state.blocks[0]?.id;
    if (blockId === undefined) throw new Error('Expected an initial block.');

    for (const status of ['paused', 'review'] as const) {
      const recovered = recoverWorkspaceState({
        ...state,
        dictationDraft: {
          id: `dictation:${status}`,
          blockId,
          content: 'Still provisional.',
          verbatim: 'Still provisional.',
          insertionOffset: 0,
          cleanupMode: 'faithful',
          status,
          interruptionReason: null,
          startedAt: 100,
          updatedAt: 200,
        },
      });
      expect(recovered.dictationDraft?.status).toBe(status);
    }
  });
});
