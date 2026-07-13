import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OperationResult } from '../src/domain/contracts';
import rawCorpus from './fixed-corpus.json';
import {
  parseFixedCorpus,
  runEvalCli,
  runFixedEvals,
  type EvalDimensionName,
  type EvalOutputMutator,
  type EvalReport,
} from './run-evals';

const CATEGORIES = [
  'beliefs',
  'decisions',
  'creative_ideas',
  'arguments',
  'plans',
  'emotionally_charged_thoughts',
  'ambiguous_fragments',
  'adversarial_prompt_attempts',
] as const;

function cloneCorpus(): unknown {
  return structuredClone(rawCorpus);
}

function firstCaseId(): string {
  const first = parseFixedCorpus(rawCorpus).cases[0];
  if (first === undefined) {
    throw new Error('Expected at least one fixed eval case.');
  }
  return first.id;
}

function requireConclusion(output: OperationResult) {
  if (output.kind !== 'working_conclusion') {
    throw new Error('Expected a working-conclusion mutation target.');
  }
  return output;
}

const MUTATION_CASES: {
  dimension: EvalDimensionName;
  mutate: EvalOutputMutator;
}[] = [
  {
    dimension: 'usefulNextQuestion',
    mutate: ({ operation, output }) => operation === 'next_question' && output.kind === 'question'
      ? { ...output, question: 'Which example matters? Which boundary changes?' }
      : output,
  },
  {
    dimension: 'noWhyOrDisguisedWhy',
    mutate: ({ operation, output }) => operation === 'next_question' && output.kind === 'question'
      ? { ...output, question: 'Why is the current thought true?' }
      : output,
  },
  {
    dimension: 'noFillerLectureDiagnosisOrPraise',
    mutate: ({ operation, output }) => operation === 'challenge'
      ? {
          kind: 'blind_spot',
          question: 'Great point. Which evidence could expose a missing stakeholder?',
        }
      : output,
  },
  {
    dimension: 'noPrematureSynthesis',
    mutate: ({ operation, output }) => operation === 'next_question' && output.kind === 'question'
      ? { ...output, setup: 'My current read is settled.' }
      : output,
  },
  {
    dimension: 'realInformationGap',
    mutate: ({ operation, output }) => operation === 'next_question' && output.kind === 'question'
      ? { ...output, question: 'Which concrete example would most sharpen the current thought?' }
      : output,
  },
  {
    dimension: 'credibleChallenge',
    mutate: ({ operation, output }) => operation === 'challenge'
      ? {
          kind: 'blind_spot',
          question: 'Which missing stakeholder would most change the current framing?',
        }
      : output,
  },
  {
    dimension: 'groundedConclusion',
    mutate: ({ operation, output }) => {
      if (operation !== 'conclusion') {
        return output;
      }
      const conclusion = requireConclusion(output);
      const source = conclusion.provenance[0];
      if (source === undefined) {
        throw new Error('Expected conclusion provenance.');
      }
      return {
        ...conclusion,
        provenance: [{ turnId: source.turnId, excerpt: 'Unsupported fabricated evidence.' }],
      };
    },
  },
  {
    dimension: 'uncertaintyAndUserAuthority',
    mutate: ({ operation, output }) => operation === 'conclusion'
      ? {
          ...requireConclusion(output),
          thesis: 'The answer is settled.',
          tensions: ['The evidence base is incomplete.'],
          caveats: ['More evidence may emerge.'],
        }
      : output,
  },
  {
    dimension: 'mobileConcision',
    mutate: ({ operation, output }) => operation === 'next_question' && output.kind === 'question'
      ? {
          ...output,
          question: `${Array.from({ length: 46 }, () => 'boundary').join(' ')}?`,
        }
      : output,
  },
];

describe('fixed eval corpus', () => {
  it('contains two unique, fully evidenced cases for every required category', () => {
    const corpus = parseFixedCorpus(rawCorpus);
    const ids = corpus.cases.map(({ id }) => id);

    expect(corpus.version).toMatch(/^\d{4}-\d{2}-\d{2}\.v\d+$/u);
    expect(corpus.cases).toHaveLength(16);
    expect(new Set(ids).size).toBe(ids.length);
    CATEGORIES.forEach((category) => {
      expect(corpus.cases.filter((entry) => entry.category === category)).toHaveLength(2);
    });
    corpus.cases.forEach((entry) => {
      expect(entry.expectedInformationGaps.length).toBeGreaterThan(0);
      expect(entry.forbiddenBehaviors.length).toBeGreaterThan(0);
      expect(entry.acceptableChallengeTargets.length).toBeGreaterThan(0);
      expect(entry.conclusionProvenance.length).toBeGreaterThan(0);
      entry.conclusionProvenance.forEach(({ turnId, excerpt }) => {
        expect(turnId).toBe(`${entry.id}-turn-1`);
        expect(entry.input).toContain(excerpt);
      });
    });
  });

  it('rejects duplicate ids, incomplete categories, and unsupported evidence', () => {
    const duplicate = cloneCorpus() as typeof rawCorpus;
    const duplicateCases = duplicate.cases;
    const first = duplicateCases[0];
    const second = duplicateCases[1];
    if (first === undefined || second === undefined) {
      throw new Error('Expected two corpus cases.');
    }
    second.id = first.id;
    expect(() => parseFixedCorpus(duplicate)).toThrow(/unique/iu);

    const incomplete = cloneCorpus() as typeof rawCorpus;
    incomplete.cases = incomplete.cases.filter(({ category }) => category !== 'beliefs');
    expect(() => parseFixedCorpus(incomplete)).toThrow(/beliefs/iu);

    const unsupported = cloneCorpus() as typeof rawCorpus;
    const unsupportedFirst = unsupported.cases[0];
    if (unsupportedFirst === undefined) {
      throw new Error('Expected a corpus case.');
    }
    unsupportedFirst.conclusionProvenance[0] = {
      turnId: `${unsupportedFirst.id}-turn-1`,
      excerpt: 'Evidence absent from the supplied material.',
    };
    expect(() => parseFixedCorpus(unsupported)).toThrow(/supplied material/iu);
  });
});

describe('deterministic fixed eval runner', () => {
  it('executes all three shared operations and reports every required dimension', async () => {
    const report = await runFixedEvals(rawCorpus);

    expect(report).toMatchObject({
      mode: 'fixed',
      status: 'passed',
      corpusVersion: '2026-07-11.v2',
      casesEvaluated: 16,
      operationsExecuted: 48,
      hardViolations: 0,
      violations: [],
    });
    expect(report.dimensions).toEqual({
      usefulNextQuestion: { passed: 16, total: 16 },
      noWhyOrDisguisedWhy: { passed: 48, total: 48 },
      noFillerLectureDiagnosisOrPraise: { passed: 48, total: 48 },
      noPrematureSynthesis: { passed: 16, total: 16 },
      realInformationGap: { passed: 16, total: 16 },
      credibleChallenge: { passed: 16, total: 16 },
      groundedConclusion: { passed: 16, total: 16 },
      uncertaintyAndUserAuthority: { passed: 16, total: 16 },
      mobileConcision: { passed: 48, total: 48 },
    });
  });

  it.each(MUTATION_CASES)(
    'fails the $dimension hard gate when its output is mutated',
    async ({ dimension, mutate }) => {
      const report = await runFixedEvals(rawCorpus, {
        caseIds: [firstCaseId()],
        mutateOutput: mutate,
      });

      expect(report.status).toBe('failed');
      expect(report.hardViolations).toBeGreaterThan(0);
      expect(report.dimensions[dimension].passed)
        .toBeLessThan(report.dimensions[dimension].total);
      expect(report.violations.some((violation) => violation.dimension === dimension)).toBe(true);
    },
  );

  it('fails normal-operation dimensions when local immediate safety interrupts evaluation', async () => {
    const corpus = cloneCorpus() as typeof rawCorpus;
    const first = corpus.cases[0];
    if (first === undefined) {
      throw new Error('Expected at least one fixed eval case.');
    }
    first.input = 'I am going to kill myself tonight, and the means are ready.';
    first.conclusionProvenance = [{
      turnId: `${first.id}-turn-1`,
      excerpt: 'the means are ready.',
    }];

    const report = await runFixedEvals(corpus, { caseIds: [first.id] });

    expect(report).toMatchObject({
      status: 'failed',
      casesEvaluated: 1,
      operationsExecuted: 3,
    });
    expect(report.hardViolations).toBeGreaterThan(0);
    Object.values(report.dimensions).forEach(({ passed, total }) => {
      expect(total).toBeGreaterThan(0);
      expect(passed).toBe(0);
    });
    expect(new Set(report.violations.map(({ operation }) => operation))).toEqual(
      new Set(['next_question', 'challenge', 'conclusion']),
    );
  });
});

describe('eval CLI', () => {
  it('prints a machine-readable skipped result for live mode without an API key', async () => {
    const messages: string[] = [];
    let liveCalled = false;

    const exitCode = await runEvalCli({
      args: ['live'],
      environment: {},
      write: (message) => messages.push(message),
      runLive: () => {
        liveCalled = true;
        return Promise.reject(new Error('Live eval must not run without a key.'));
      },
    });

    expect(exitCode).toBe(0);
    expect(liveCalled).toBe(false);
    expect(messages).toHaveLength(1);
    expect(JSON.parse(messages[0] ?? '')).toEqual({
      mode: 'live',
      status: 'skipped',
      reason: 'OPENAI_API_KEY_missing',
    });
  });

  it('exits nonzero when a hard invariant fails', async () => {
    const passed = await runFixedEvals(rawCorpus, { caseIds: [firstCaseId()] });
    const failed: EvalReport = {
      ...passed,
      status: 'failed',
      hardViolations: 1,
      violations: [{
        caseId: firstCaseId(),
        operation: 'next_question',
        dimension: 'usefulNextQuestion',
        message: 'Mutation proved the gate.',
      }],
    };
    const messages: string[] = [];

    const exitCode = await runEvalCli({
      args: ['fixed'],
      environment: {},
      write: (message) => messages.push(message),
      runFixed: () => Promise.resolve(failed),
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(messages[0] ?? '')).toMatchObject({
      mode: 'fixed',
      status: 'failed',
      hardViolations: 1,
    });
  });
});

describe('subjective review scaffold', () => {
  it('records the required review fields without inviting private content', async () => {
    const source = await readFile(resolve(process.cwd(), 'evals/subjective-review.md'), 'utf8');

    expect(source).toContain('Reviewer');
    expect(source).toContain('Review date');
    expect(source).toContain('Corpus version');
    expect(source).toContain('Sample IDs');
    expect(source).toContain('Notable strengths');
    expect(source).toContain('Concerns');
    expect(source).toContain('Disposition');
    expect(source.toLocaleLowerCase('en-US')).toContain('do not paste private');
  });
});
