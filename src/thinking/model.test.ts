import { describe, expect, it } from 'vitest';
import { createInitialWorkspace, effectiveStatus, workspaceStateSchema } from './model';

describe('thinking model', () => {
  it('creates one local writing document with a fourteen-day dormancy default', () => {
    const state = createInitialWorkspace(100);
    expect(state.documents).toHaveLength(1);
    expect(state.blocks).toHaveLength(1);
    expect(state.settings).toEqual({ contextScope: 'document', dormancyDays: 14 });
    expect(workspaceStateSchema.parse(state)).toEqual(state);
  });

  it('treats staleness as a visual dormant state without rewriting explicit status', () => {
    const day = 24 * 60 * 60 * 1_000;
    expect(effectiveStatus(0, 'active', 14, 14 * day)).toBe('dormant');
    expect(effectiveStatus(0, 'resting', 14, 30 * day)).toBe('resting');
    expect(effectiveStatus(0, 'closed', 14, 30 * day)).toBe('closed');
  });
});
