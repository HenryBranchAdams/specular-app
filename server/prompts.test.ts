import { describe, expect, it } from 'vitest';
import type { Operation, ThreadContext } from '../src/domain/contracts';
import { threadIdSchema } from '../src/domain/schemas';
import { buildOperationPrompt, buildRepairPrompt } from './prompts';

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

function contextFor(operation: Operation): ThreadContext {
  return { ...context, operation };
}

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

  it.each(['next_question', 'challenge'] as const)(
    'requires exactly one question for %s',
    (operation) => {
      const prompt = buildOperationPrompt(operation, contextFor(operation));

      expect(prompt.instructions).toContain('Ask exactly one focused question');
    },
  );

  it('limits an ordinary Challenge to one blind-spot or testing question', () => {
    const prompt = buildOperationPrompt('challenge', contextFor('challenge'));

    expect(prompt.instructions).toContain('one blind-spot or testing question');
    expect(prompt.instructions).toContain('Use the blind_spot shape');
    expect(prompt.instructions).toContain('Do not return a counter-position');
    expect(prompt.instructions).not.toContain('either one blind-spot question');
  });

  it('makes conclusion organization extractive without asking another question', () => {
    const prompt = buildOperationPrompt('conclusion', contextFor('conclusion'));

    expect(prompt.instructions).not.toContain('Ask exactly one focused question');
    expect(prompt.instructions).toContain('accepted user turns only');
    expect(prompt.instructions).toContain('Copy each excerpt verbatim');
    expect(prompt.instructions).toContain(
      'do not paraphrase, synthesize, infer, recommend, combine, complete, or introduce any claim',
    );
    expect(prompt.instructions).toContain(
      'Every thesis, insight, observation, tension, and caveat value must exactly equal one provenance excerpt',
    );
    expect(prompt.instructions).toContain('every provenance excerpt must be used exactly once');
    expect(prompt.instructions).not.toContain('three to five insights');
  });

  it('repeats the extractive contract and stable authorship code during repair', () => {
    const prompt = buildRepairPrompt(
      'conclusion',
      contextFor('conclusion'),
      { kind: 'structured', value: { thesis: 'An invented answer.' } },
      ['conclusion_authorship'],
    );

    expect(prompt.instructions).toContain('Copy each excerpt verbatim');
    expect(prompt.input).toContain('Stable validation codes: conclusion_authorship');
    expect(prompt.input).toContain('Repair the output once');
  });
});
