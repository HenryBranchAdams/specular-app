import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { createOpenAIQuestioningProvider } from '../server/openai-provider';
import {
  createOperationService,
  type ProviderAttempt,
  type RepairingQuestioningProvider,
} from '../server/operation-service';
import { NullMetadataSink } from '../server/telemetry';
import { assertNever } from '../src/domain/contracts';
import type {
  Operation,
  OperationResult,
  ThreadContext,
  ThreadUnderstanding,
} from '../src/domain/contracts';
import {
  MAX_TURN_CONTENT_LENGTH,
  challengeResultSchema,
  nextQuestionResultSchema,
  requestIdSchema,
  threadContextSchema,
  threadIdSchema,
  turnIdSchema,
  workingConclusionResultSchema,
} from '../src/domain/schemas';
import {
  containsFiller,
  containsProhibitedQuestion,
  questionMarkCount,
  wordCount,
} from '../src/domain/validators';
import rawCorpus from './fixed-corpus.json';

const REQUIRED_CATEGORIES = [
  'beliefs',
  'decisions',
  'creative_ideas',
  'arguments',
  'plans',
  'emotionally_charged_thoughts',
  'ambiguous_fragments',
  'adversarial_prompt_attempts',
] as const;

const FORBIDDEN_BEHAVIORS = [
  'why',
  'disguised_why',
  'praise',
  'lecture',
  'diagnosis',
  'premature_synthesis',
  'filler',
] as const;

const OPERATIONS = ['next_question', 'challenge', 'conclusion'] as const satisfies readonly Operation[];

const corpusCaseSchema = z.object({
  id: z.string().min(1).max(96).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  category: z.enum(REQUIRED_CATEGORIES),
  input: z.string().trim().min(1).max(MAX_TURN_CONTENT_LENGTH),
  expectedInformationGaps: z.array(z.string().trim().min(1).max(300)).min(1),
  forbiddenBehaviors: z.array(z.enum(FORBIDDEN_BEHAVIORS)).min(1),
  acceptableChallengeTargets: z.array(z.string().trim().min(1).max(300)).min(1),
  conclusionProvenance: z.array(z.object({
    turnId: z.string().min(1).max(128),
    excerpt: z.string().trim().min(1).max(500),
  }).strict()).min(1),
}).strict();

const fixedCorpusSchema = z.object({
  version: z.string().regex(/^\d{4}-\d{2}-\d{2}\.v\d+$/u),
  cases: z.array(corpusCaseSchema),
}).strict().superRefine((corpus, refinement) => {
  const ids = new Set<string>();

  corpus.cases.forEach((entry, caseIndex) => {
    if (ids.has(entry.id)) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Fixed eval case ids must be unique.',
        path: ['cases', caseIndex, 'id'],
      });
    }
    ids.add(entry.id);

    const namedLists = [
      ['expectedInformationGaps', entry.expectedInformationGaps],
      ['forbiddenBehaviors', entry.forbiddenBehaviors],
      ['acceptableChallengeTargets', entry.acceptableChallengeTargets],
    ] as const;
    namedLists.forEach(([name, values]) => {
      if (new Set(values).size !== values.length) {
        refinement.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${name} entries must be unique within each case.`,
          path: ['cases', caseIndex, name],
        });
      }
    });

    entry.conclusionProvenance.forEach((provenance, provenanceIndex) => {
      if (provenance.turnId !== `${entry.id}-turn-1`) {
        refinement.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Conclusion provenance must reference the supplied case turn.',
          path: ['cases', caseIndex, 'conclusionProvenance', provenanceIndex, 'turnId'],
        });
      }
      if (!entry.input.includes(provenance.excerpt)) {
        refinement.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Conclusion provenance must quote real supplied material.',
          path: ['cases', caseIndex, 'conclusionProvenance', provenanceIndex, 'excerpt'],
        });
      }
    });
  });

  REQUIRED_CATEGORIES.forEach((category) => {
    const count = corpus.cases.filter((entry) => entry.category === category).length;
    if (count !== 2) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Category ${category} must contain exactly two cases.`,
        path: ['cases'],
      });
    }
  });
});

export type FixedEvalCorpus = z.infer<typeof fixedCorpusSchema>;
export type FixedEvalCase = FixedEvalCorpus['cases'][number];
export type EvalDimensionName =
  | 'usefulNextQuestion'
  | 'noWhyOrDisguisedWhy'
  | 'noFillerLectureDiagnosisOrPraise'
  | 'noPrematureSynthesis'
  | 'realInformationGap'
  | 'credibleChallenge'
  | 'groundedConclusion'
  | 'uncertaintyAndUserAuthority'
  | 'mobileConcision';

export interface EvalViolation {
  caseId: string;
  operation: Operation;
  dimension: EvalDimensionName;
  message: string;
}

export interface EvalReport {
  mode: 'fixed' | 'live';
  status: 'passed' | 'failed';
  corpusVersion: string;
  casesEvaluated: number;
  operationsExecuted: number;
  hardViolations: number;
  dimensions: Record<EvalDimensionName, { passed: number; total: number }>;
  violations: EvalViolation[];
}

export interface EvalOutputMutationInput {
  caseId: string;
  operation: Operation;
  output: OperationResult;
}

export type EvalOutputMutator = (input: EvalOutputMutationInput) => OperationResult;

export interface RunFixedEvalOptions {
  caseIds?: readonly string[];
  mutateOutput?: EvalOutputMutator;
}

interface EvalExecution {
  provider: RepairingQuestioningProvider;
  candidate?: OperationResult;
}

interface OperationEvaluation {
  serviceOk: boolean;
  output: OperationResult | undefined;
}

interface EvalCliOptions {
  args?: readonly string[];
  environment?: Readonly<Record<string, string | undefined>>;
  write?: (message: string) => void;
  runFixed?: () => Promise<EvalReport>;
  runLive?: (apiKey: string) => Promise<EvalReport>;
}

const DIMENSION_MESSAGES: Record<EvalDimensionName, string> = {
  usefulNextQuestion: 'Next Question did not satisfy the useful single-question gate.',
  noWhyOrDisguisedWhy: 'Output used prohibited justification phrasing.',
  noFillerLectureDiagnosisOrPraise: 'Output included filler, praise, lecture, or diagnosis language.',
  noPrematureSynthesis: 'Next Question synthesized before a conclusion was requested.',
  realInformationGap: 'Next Question did not address a named information gap.',
  credibleChallenge: 'Challenge did not address an acceptable pressure-test target.',
  groundedConclusion: 'Working Conclusion provenance was not grounded in supplied material.',
  uncertaintyAndUserAuthority: 'Working Conclusion did not preserve uncertainty and user authority.',
  mobileConcision: 'Output exceeded the shared mobile-concision contract.',
};

const STYLE_VIOLATION_PATTERNS = [
  /\b(?:brilliant|excellent|impressive|insightful)\b/iu,
  /\b(?:you are|you(?:'|’)re) clearly\b/iu,
  /\b(?:let me explain|the lesson is|you need to understand)\b/iu,
  /\b(?:this means you have|you are suffering from|your hesitation is caused by)\b/iu,
  /\b(?:as an ai|i am here to help)\b/iu,
];

const PREMATURE_SYNTHESIS_PATTERNS = [
  /\bmy current read is\b/iu,
  /\bthe answer is\b/iu,
  /\bthe conclusion is\b/iu,
  /\bthe thread i see is\b/iu,
  /\byou (?:should|need to|must)\b/iu,
];

export function parseFixedCorpus(input: unknown): FixedEvalCorpus {
  return fixedCorpusSchema.parse(input);
}

class FixedOutputProvider implements RepairingQuestioningProvider {
  readonly configured = true;
  readonly providerId = 'fixed-eval';
  readonly modelId = 'deterministic-v1';

  constructor(private readonly output: OperationResult) {}

  generate(): Promise<ProviderAttempt> {
    return Promise.resolve(this.attempt());
  }

  repair(): Promise<ProviderAttempt> {
    return Promise.resolve(this.attempt());
  }

  private attempt(): ProviderAttempt {
    return {
      value: this.output,
      repairInput: { kind: 'structured', value: this.output },
    };
  }
}

function createUnderstanding(entry: FixedEvalCase): ThreadUnderstanding {
  return {
    claims: [entry.input],
    observations: [],
    stakeholders: [],
    contexts: [],
    distinctions: [],
    tensions: [],
    exploredBlindSpots: [],
    unexploredBlindSpots: [firstValue(entry.acceptableChallengeTargets, 'a Challenge target')],
  };
}

function createContext(entry: FixedEvalCase, operation: Operation): ThreadContext {
  const threadId = threadIdSchema.parse(`${entry.id}-thread`);
  const turnId = turnIdSchema.parse(`${entry.id}-turn-1`);
  const understanding = createUnderstanding(entry);

  return threadContextSchema.parse({
    thread: { id: threadId },
    turns: [{
      id: turnId,
      ownerScope: 'local',
      threadId,
      role: 'user',
      content: entry.input,
      modality: 'text',
      createdAt: 0,
      position: 0,
      deliveryState: 'accepted',
    }],
    understanding,
    operation,
  });
}

function firstValue<Value>(values: readonly Value[], label: string): Value {
  const value = values[0];
  if (value === undefined) {
    throw new Error(`Parsed eval case is missing ${label}.`);
  }
  return value;
}

function buildFixedOutput(entry: FixedEvalCase, operation: Operation): OperationResult {
  const informationGap = firstValue(entry.expectedInformationGaps, 'an information gap');
  const challengeTarget = firstValue(entry.acceptableChallengeTargets, 'a Challenge target');
  const provenance = firstValue(entry.conclusionProvenance, 'conclusion provenance');

  switch (operation) {
    case 'next_question':
      return {
        kind: 'question',
        question: `Which concrete example would clarify ${informationGap}?`,
        understanding: createUnderstanding(entry),
      };
    case 'challenge':
      return {
        kind: 'blind_spot',
        question: `Which evidence could test ${challengeTarget}?`,
      };
    case 'conclusion':
      return {
        kind: 'working_conclusion',
        thesis: `My current read is that ${provenance.excerpt} points to a provisional direction.`,
        insights: [
          `The supplied material identifies ${provenance.excerpt}.`,
          `The open information gap concerns ${informationGap}.`,
          `A credible Challenge target concerns ${challengeTarget}.`,
        ],
        observations: [
          `The user supplied the evidence excerpt ${provenance.excerpt}.`,
        ],
        tensions: [
          `The current framing remains provisional until ${informationGap} is clearer.`,
        ],
        caveats: [
          'This working conclusion is provisional, and the user remains the final authority.',
        ],
        provenance: [{
          turnId: turnIdSchema.parse(provenance.turnId),
          excerpt: provenance.excerpt,
        }],
      };
    default:
      return assertNever(operation);
  }
}

function outputText(output: OperationResult | undefined): string {
  if (output === undefined) {
    return '';
  }

  switch (output.kind) {
    case 'question':
      return [output.setup, output.question].filter(Boolean).join(' ');
    case 'blind_spot':
      return output.question;
    case 'counter_position':
      return `${output.counterPosition} ${output.question}`;
    case 'working_conclusion':
      return [
        output.thesis,
        ...output.insights,
        ...output.observations,
        ...output.tensions,
        ...output.caveats,
      ].join(' ');
    default:
      return assertNever(output);
  }
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

function containsNamedTarget(text: string, targets: readonly string[]): boolean {
  const candidate = normalized(text);
  return targets.some((target) => candidate.includes(normalized(target)));
}

function hasForbiddenStyle(text: string): boolean {
  return containsFiller(text) || STYLE_VIOLATION_PATTERNS.some((pattern) => pattern.test(text));
}

function hasPrematureSynthesis(text: string): boolean {
  return PREMATURE_SYNTHESIS_PATTERNS.some((pattern) => pattern.test(text));
}

function containsLiteralText(text: string, fragment: string): boolean {
  const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(escaped, 'u').test(text);
}

function isUsefulNextQuestion(evaluation: OperationEvaluation): boolean {
  if (!evaluation.serviceOk) {
    return false;
  }
  const parsed = nextQuestionResultSchema.safeParse(evaluation.output);
  return parsed.success
    && questionMarkCount(parsed.data.question) === 1
    && parsed.data.question.trimEnd().endsWith('?');
}

function isGroundedConclusion(entry: FixedEvalCase, evaluation: OperationEvaluation): boolean {
  if (!evaluation.serviceOk) {
    return false;
  }
  const parsed = workingConclusionResultSchema.safeParse(evaluation.output);
  if (!parsed.success) {
    return false;
  }

  const expectedProvenance = new Set(entry.conclusionProvenance.map((item) => (
    `${item.turnId}\u0000${item.excerpt}`
  )));
  const expectedExcerptsAreGrounded = entry.conclusionProvenance.every((expected) => (
    containsLiteralText(entry.input, expected.excerpt)
  ));
  return expectedExcerptsAreGrounded
    && parsed.data.provenance.length === entry.conclusionProvenance.length
    && parsed.data.provenance.every((actual) => (
      expectedProvenance.has(`${actual.turnId}\u0000${actual.excerpt}`)
    ));
}

function preservesUncertaintyAndAuthority(evaluation: OperationEvaluation): boolean {
  if (!evaluation.serviceOk) {
    return false;
  }
  const parsed = workingConclusionResultSchema.safeParse(evaluation.output);
  if (!parsed.success) {
    return false;
  }
  const text = outputText(parsed.data);
  return /\b(?:provisional|current read|uncertain|tentative)\b/iu.test(text)
    && /\buser\b[^.]{0,80}\b(?:authority|edit|reject|revise|decide)\b/iu.test(text);
}

function isMobileConcise(operation: Operation, evaluation: OperationEvaluation): boolean {
  if (!evaluation.serviceOk) {
    return false;
  }

  switch (operation) {
    case 'next_question': {
      const parsed = nextQuestionResultSchema.safeParse(evaluation.output);
      if (!parsed.success) {
        return false;
      }
      return wordCount([parsed.data.setup, parsed.data.question].filter(Boolean).join(' ')) <= 45;
    }
    case 'challenge': {
      const parsed = challengeResultSchema.safeParse(evaluation.output);
      if (!parsed.success) {
        return false;
      }
      switch (parsed.data.kind) {
        case 'blind_spot':
          return wordCount(parsed.data.question) <= 55;
        case 'counter_position':
          return wordCount(`${parsed.data.counterPosition} ${parsed.data.question}`) <= 100;
        default:
          return assertNever(parsed.data);
      }
    }
    case 'conclusion': {
      const parsed = workingConclusionResultSchema.safeParse(evaluation.output);
      return parsed.success
        && wordCount(parsed.data.thesis) <= 150
        && parsed.data.insights.length >= 3
        && parsed.data.insights.length <= 5
        && parsed.data.tensions.length <= 3;
    }
    default:
      return assertNever(operation);
  }
}

function emptyDimensions(): EvalReport['dimensions'] {
  return {
    usefulNextQuestion: { passed: 0, total: 0 },
    noWhyOrDisguisedWhy: { passed: 0, total: 0 },
    noFillerLectureDiagnosisOrPraise: { passed: 0, total: 0 },
    noPrematureSynthesis: { passed: 0, total: 0 },
    realInformationGap: { passed: 0, total: 0 },
    credibleChallenge: { passed: 0, total: 0 },
    groundedConclusion: { passed: 0, total: 0 },
    uncertaintyAndUserAuthority: { passed: 0, total: 0 },
    mobileConcision: { passed: 0, total: 0 },
  };
}

function recordDimension(
  report: Pick<EvalReport, 'dimensions' | 'violations'>,
  entry: FixedEvalCase,
  operation: Operation,
  dimension: EvalDimensionName,
  passed: boolean,
): void {
  report.dimensions[dimension].total += 1;
  if (passed) {
    report.dimensions[dimension].passed += 1;
    return;
  }
  report.violations.push({
    caseId: entry.id,
    operation,
    dimension,
    message: DIMENSION_MESSAGES[dimension],
  });
}

async function evaluateOperation(
  entry: FixedEvalCase,
  operation: Operation,
  execution: EvalExecution,
): Promise<OperationEvaluation> {
  const service = createOperationService({
    provider: execution.provider,
    telemetry: new NullMetadataSink(),
    safetyRegion: 'US',
    now: () => 0,
    safetySecret: new Uint8Array(32).fill(7),
  });
  const result = await service.execute({
    operation,
    context: createContext(entry, operation),
    requestId: requestIdSchema.parse(`${entry.id}-${operation}`),
    signal: new AbortController().signal,
  });

  return {
    serviceOk: result.ok,
    output: result.ok ? result.value : execution.candidate,
  };
}

function recordEvaluation(
  report: Pick<EvalReport, 'dimensions' | 'violations'>,
  entry: FixedEvalCase,
  operation: Operation,
  evaluation: OperationEvaluation,
): void {
  const text = outputText(evaluation.output);
  recordDimension(
    report,
    entry,
    operation,
    'noWhyOrDisguisedWhy',
    evaluation.serviceOk && !containsProhibitedQuestion(text),
  );
  recordDimension(
    report,
    entry,
    operation,
    'noFillerLectureDiagnosisOrPraise',
    evaluation.serviceOk && !hasForbiddenStyle(text),
  );
  recordDimension(report, entry, operation, 'mobileConcision', isMobileConcise(operation, evaluation));

  switch (operation) {
    case 'next_question':
      recordDimension(report, entry, operation, 'usefulNextQuestion', isUsefulNextQuestion(evaluation));
      recordDimension(
        report,
        entry,
        operation,
        'noPrematureSynthesis',
        evaluation.serviceOk && !hasPrematureSynthesis(text),
      );
      recordDimension(
        report,
        entry,
        operation,
        'realInformationGap',
        evaluation.serviceOk && containsNamedTarget(text, entry.expectedInformationGaps),
      );
      return;
    case 'challenge':
      recordDimension(
        report,
        entry,
        operation,
        'credibleChallenge',
        evaluation.serviceOk && containsNamedTarget(text, entry.acceptableChallengeTargets),
      );
      return;
    case 'conclusion':
      recordDimension(
        report,
        entry,
        operation,
        'groundedConclusion',
        isGroundedConclusion(entry, evaluation),
      );
      recordDimension(
        report,
        entry,
        operation,
        'uncertaintyAndUserAuthority',
        preservesUncertaintyAndAuthority(evaluation),
      );
      return;
    default:
      return assertNever(operation);
  }
}

async function runEvals(
  corpus: FixedEvalCorpus,
  mode: EvalReport['mode'],
  entries: readonly FixedEvalCase[],
  createExecution: (entry: FixedEvalCase, operation: Operation) => EvalExecution,
): Promise<EvalReport> {
  const report: EvalReport = {
    mode,
    status: 'passed',
    corpusVersion: corpus.version,
    casesEvaluated: entries.length,
    operationsExecuted: 0,
    hardViolations: 0,
    dimensions: emptyDimensions(),
    violations: [],
  };

  for (const entry of entries) {
    const evaluations = await Promise.all(OPERATIONS.map(async (operation) => ({
      evaluation: await evaluateOperation(
        entry,
        operation,
        createExecution(entry, operation),
      ),
      operation,
    })));
    for (const { evaluation, operation } of evaluations) {
      report.operationsExecuted += 1;
      recordEvaluation(report, entry, operation, evaluation);
    }
  }

  report.hardViolations = report.violations.length;
  report.status = report.hardViolations === 0 ? 'passed' : 'failed';
  return report;
}

function selectCases(corpus: FixedEvalCorpus, caseIds: readonly string[] | undefined): FixedEvalCase[] {
  if (caseIds === undefined) {
    return corpus.cases;
  }
  const requested = new Set(caseIds);
  const unknown = [...requested].filter((id) => !corpus.cases.some((entry) => entry.id === id));
  if (unknown.length > 0) {
    throw new Error('Unknown fixed eval case id.');
  }
  return corpus.cases.filter((entry) => requested.has(entry.id));
}

export async function runFixedEvals(
  input: unknown = rawCorpus,
  options: RunFixedEvalOptions = {},
): Promise<EvalReport> {
  const corpus = parseFixedCorpus(input);
  const entries = selectCases(corpus, options.caseIds);

  return await runEvals(corpus, 'fixed', entries, (entry, operation) => {
    const baseline = buildFixedOutput(entry, operation);
    const candidate = options.mutateOutput?.({
      caseId: entry.id,
      operation,
      output: baseline,
    }) ?? baseline;
    return {
      provider: new FixedOutputProvider(candidate),
      candidate,
    };
  });
}

export async function runLiveEvals(apiKey: string, model = 'gpt-5.5'): Promise<EvalReport> {
  const corpus = parseFixedCorpus(rawCorpus);
  const provider = createOpenAIQuestioningProvider({ apiKey, model });
  return await runEvals(corpus, 'live', corpus.cases, () => ({ provider }));
}

export async function runEvalCli(options: EvalCliOptions = {}): Promise<number> {
  const args = options.args ?? process.argv.slice(2);
  const environment = options.environment ?? process.env;
  const write = options.write ?? ((message: string) => {
    console.log(message);
  });
  const mode = args[0] ?? 'fixed';

  switch (mode) {
    case 'fixed': {
      const report = await (options.runFixed ?? (() => runFixedEvals(rawCorpus)))();
      write(JSON.stringify(report));
      return report.hardViolations === 0 ? 0 : 1;
    }
    case 'live': {
      const apiKey = environment.OPENAI_API_KEY?.trim();
      if (apiKey === undefined || apiKey === '') {
        write(JSON.stringify({
          mode: 'live',
          status: 'skipped',
          reason: 'OPENAI_API_KEY_missing',
        }));
        return 0;
      }
      const configuredModel = environment.OPENAI_MODEL?.trim();
      const model = configuredModel === undefined || configuredModel === ''
        ? 'gpt-5.5'
        : configuredModel;
      const report = await (options.runLive ?? ((key: string) => runLiveEvals(key, model)))(apiKey);
      write(JSON.stringify(report));
      return report.hardViolations === 0 ? 0 : 1;
    }
    default:
      write(JSON.stringify({ mode, status: 'failed', reason: 'expected_fixed_or_live' }));
      return 2;
  }
}

const executablePath = process.argv[1];
if (executablePath !== undefined && import.meta.url === pathToFileURL(executablePath).href) {
  runEvalCli().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch(() => {
    console.log(JSON.stringify({ mode: 'unknown', status: 'failed', reason: 'runner_error' }));
    process.exitCode = 1;
  });
}
