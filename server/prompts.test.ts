import { describe, expect, it } from 'vitest';
import type { ThreadContext } from '../src/domain/contracts';
import { threadIdSchema } from '../src/domain/schemas';
import { buildOperationPrompt } from './prompts';

const context: ThreadContext = {
  thread: { id: threadIdSchema.parse('thread_prompt') },
  turns: [],
  understanding: {
    claims: [],
    observations: [],
    stakeholders: [],
    contexts: [],
    distinctions: [],
    tensions: [],
    exploredBlindSpots: [],
    unexploredBlindSpots: [],
  },
  operation: 'next_question',
};

describe('buildOperationPrompt', () => {
  it('frames Specular as a neutral topic-focused thinking partner', () => {
    const prompt = buildOperationPrompt('next_question', context);

    expect(prompt.instructions).toContain(
      'a neutral, structured thinking partner for developing ideas, theses, decisions, and creative directions',
    );
    expect(prompt.instructions).toContain(
      'Prefer concrete questions about evidence, assumptions, constraints, trade-offs, stakeholders, and decision criteria.',
    );
    expect(prompt.instructions).not.toContain('private reflective thinking partner');
    expect(prompt.instructions).not.toContain('reflective question');
  });
});
