import { afterEach, describe, expect, it, vi } from 'vitest';
import { printSnapshot, snapshotFilename } from './export';
import type { PublishedSnapshot } from './share-client';

const snapshot: PublishedSnapshot = {
  title: 'Oneironautics: Field Notes',
  createdAt: 1_800_000_000_000,
  blocks: [{ id: 'block:one', content: 'Authored writing.', kind: 'thought', references: [] }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.title = '';
});

describe('snapshot exports', () => {
  it('preserves the confirmed title while removing only unsafe filename characters', () => {
    expect(snapshotFilename('  Oneironautics: Field Notes  ')).toBe('Oneironautics- Field Notes');
    expect(snapshotFilename('  ')).toBe('Specular snapshot');
  });

  it('uses the snapshot title for print and restores the application title afterward', () => {
    document.title = 'Specular — Write until the thought becomes visible';
    const print = vi.fn(() => {
      expect(document.title).toBe('Oneironautics- Field Notes');
    });
    vi.stubGlobal('print', print);

    printSnapshot(snapshot);
    expect(print).toHaveBeenCalledOnce();
    globalThis.dispatchEvent(new Event('afterprint'));
    expect(document.title).toBe('Specular — Write until the thought becomes visible');
  });
});
