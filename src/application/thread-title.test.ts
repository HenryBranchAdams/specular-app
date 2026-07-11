import { describe, expect, it } from 'vitest';
import { deriveThreadTitle } from './thread-title';

describe('deriveThreadTitle', () => {
  it('turns a business-idea opening into a concise object-focused title', () => {
    expect(deriveThreadTitle(
      'I’m exploring a business that turns complex compliance updates into brief operating checklists for small manufacturers.',
    )).toBe('A business that turns complex compliance updates into brief operating…');
  });

  it('removes drafting language from a decision', () => {
    expect(deriveThreadTitle(
      'I need to choose between a small reversible launch and a broad launch.',
    )).toBe('Choose between a small reversible launch and a broad launch');
  });

  it('uses the first sentence and normalizes whitespace and terminal punctuation', () => {
    expect(deriveThreadTitle('  My current thesis is   durable growth beats speed. More later.  '))
      .toBe('Durable growth beats speed');
  });

  it('truncates long titles at a word boundary within eighty characters', () => {
    const title = deriveThreadTitle(
      'This deliberately long working premise contains enough words to exceed the local title boundary while preserving a readable phrase for the capsule library.',
    );

    expect(title.length).toBeLessThanOrEqual(80);
    expect(title).not.toMatch(/\s$/u);
    expect(title.endsWith('…')).toBe(true);
  });

  it('falls back for empty input', () => {
    expect(deriveThreadTitle('   ')).toBe('New topic');
  });
});
