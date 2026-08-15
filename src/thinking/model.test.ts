import { describe, expect, it } from 'vitest';
import { createInitialWorkspace, effectiveStatus, workspaceStateSchema } from './model';

describe('thinking model', () => {
  it('creates one local writing document with a fourteen-day dormancy default', () => {
    const state = createInitialWorkspace(100);
    expect(state.documents).toHaveLength(1);
    expect(state.blocks).toHaveLength(1);
    expect(state.settings).toEqual({ contextScope: 'document', dormancyDays: 14, dictationCleanup: 'faithful', automaticOrganization: 'undecided' });
    expect(state.documents[0]?.titleSource).toBe('empty');
    expect(state.blocks[0]?.kindSource).toBe('default');
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

  it('allows an empty private snapshot title while it is being edited', () => {
    const state = createInitialWorkspace(100);
    const document = state.documents[0];
    const block = state.blocks[0];
    if (document === undefined || block === undefined) throw new Error('Expected an initial workspace.');
    const parsed = workspaceStateSchema.parse({
      ...state,
      snapshots: [{
        id: 'snapshot:one',
        documentId: document.id,
        title: '',
        titleConfirmed: false,
        blockIds: [block.id],
        createdAt: 100,
        publishedUrl: null,
      }],
    });
    expect(parsed.snapshots[0]?.title).toBe('');
  });

  it('treats staleness as a visual dormant state without rewriting explicit status', () => {
    const day = 24 * 60 * 60 * 1_000;
    expect(effectiveStatus(0, 'active', 14, 14 * day)).toBe('dormant');
    expect(effectiveStatus(0, 'resting', 14, 30 * day)).toBe('resting');
    expect(effectiveStatus(0, 'closed', 14, 30 * day)).toBe('closed');
  });

  it('migrates earlier workspaces without losing manual titles or kinds', () => {
    const state = createInitialWorkspace(100);
    const legacy = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    const documents = legacy.documents as Record<string, unknown>[];
    const blocks = legacy.blocks as Record<string, unknown>[];
    const settings = legacy.settings as Record<string, unknown>;
    documents[0] = { ...documents[0], title: 'An existing title' };
    blocks[0] = { ...blocks[0], kind: 'question' };
    delete documents[0].titleSource;
    delete blocks[0].kindSource;
    delete settings.automaticOrganization;

    const parsed = workspaceStateSchema.parse(legacy);
    expect(parsed.documents[0]).toMatchObject({ title: 'An existing title', titleSource: 'author' });
    expect(parsed.blocks[0]).toMatchObject({ kind: 'question', kindSource: 'author' });
    expect(parsed.settings.automaticOrganization).toBe('undecided');
  });
});
