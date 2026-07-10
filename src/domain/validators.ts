import { assertNever } from './contracts';
import type {
  ChallengeResult,
  NextQuestionResult,
  Operation,
  OperationResult,
  WorkingConclusionResult,
} from './contracts';
import {
  challengeResultSchema,
  nextQuestionResultSchema,
  workingConclusionResultSchema,
} from './schemas';

export type ProductValidationErrorCode =
  | 'schema_invalid'
  | 'prohibited_question'
  | 'question_count'
  | 'word_limit'
  | 'filler'
  | 'unsolicited_synthesis'
  | 'question_independence'
  | 'challenge_shape'
  | 'conclusion_shape';

export class ProductValidationError extends Error {
  readonly code: ProductValidationErrorCode;
  readonly operation: Operation;

  constructor(
    code: ProductValidationErrorCode,
    operation: Operation,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'ProductValidationError';
    this.code = code;
    this.operation = operation;
  }
}

const PROHIBITED_QUESTION_PATTERNS = [
  /\bwhy\b/iu,
  /\bwhat\s+makes\s+you\s+think\b/iu,
  /\bwhat\s+led\s+you\s+to\s+believe\b/iu,
  /\bhow\s+come\b/iu,
];

const FILLER_PATTERNS = [
  /\b(?:great|good|excellent)\s+(?:question|point)\b/iu,
  /\bthat(?:['’]s|\s+is)\s+(?:a\s+)?(?:great|good|excellent)\s+point\b/iu,
  /\bthanks?\s+for\s+sharing\b/iu,
  /\bi\s+(?:hear|understand)\s+you\b/iu,
  /\bthat\s+makes\s+sense\b/iu,
  /\byou(?:['’]re|\s+are)\s+(?:absolutely\s+)?right\b/iu,
];

const UNSOLICITED_SYNTHESIS_PATTERNS = [
  /\bthe\s+answer\s+is\b/iu,
  /\bmy\s+current\s+read\s+is\b/iu,
  /\bthe\s+thread\s+i\s+see\s+is\b/iu,
  /\byou\s+(?:should|need\s+to|must)\b/iu,
];

const UNQUALIFIED_REFERENCE_PATTERN = /\b(?:this|that|these|those|it|its|they|them|their|theirs|he|him|his|she|her|hers|here|there|former|latter)\b/iu;
const SENTENCE_SEGMENTER = new Intl.Segmenter('en', { granularity: 'sentence' });
const SENTENCE_ABBREVIATION_PATTERN = /\b(?:Dr|Mr|Mrs|Ms|Mx|Prof|Sr|Jr|St|vs|etc)\.|\b(?:e\.g|i\.e)\./giu;
const PROTECTED_PERIOD = '\uE000';

export function wordCount(value: string): number {
  const normalized = value.trim();
  return normalized.length === 0 ? 0 : normalized.split(/\s+/u).length;
}

export function questionMarkCount(value: string): number {
  return Array.from(value).filter((character) => character === '?' || character === '？').length;
}

function endsWithQuestionMark(value: string): boolean {
  const terminal = value.trimEnd().at(-1);
  return terminal === '?' || terminal === '？';
}

export function containsProhibitedQuestion(value: string): boolean {
  return PROHIBITED_QUESTION_PATTERNS.some((pattern) => pattern.test(value));
}

export function containsFiller(value: string): boolean {
  return FILLER_PATTERNS.some((pattern) => pattern.test(value));
}

function containsUnsolicitedSynthesis(value: string): boolean {
  return UNSOLICITED_SYNTHESIS_PATTERNS.some((pattern) => pattern.test(value));
}

function setupSentenceCount(value: string): number {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return 0;
  }

  const abbreviationAware = normalized.replace(
    SENTENCE_ABBREVIATION_PATTERN,
    (abbreviation) => abbreviation.replaceAll('.', PROTECTED_PERIOD),
  );
  const boundedMissingSpaceNormalization = abbreviationAware.replace(
    /([.!?。！？])(?=[\p{Lu}\p{Lt}\d])/gu,
    '$1 ',
  );

  return Array.from(SENTENCE_SEGMENTER.segment(boundedMissingSpaceNormalization))
    .filter(({ segment }) => segment.trim().length > 0)
    .length;
}

function containsUnqualifiedReference(value: string): boolean {
  return UNQUALIFIED_REFERENCE_PATTERN.test(value);
}

function fail(
  code: ProductValidationErrorCode,
  operation: Operation,
  message: string,
): never {
  throw new ProductValidationError(code, operation, message);
}

function validateQuestionText(
  operation: Operation,
  value: string,
  maximumWords: number,
): void {
  if (containsProhibitedQuestion(value)) {
    fail('prohibited_question', operation, 'The response asks for prohibited justification.');
  }
  if (questionMarkCount(value) !== 1) {
    fail('question_count', operation, 'The response must contain exactly one question mark.');
  }
  if (wordCount(value) > maximumWords) {
    fail('word_limit', operation, `The response exceeds ${String(maximumWords)} words.`);
  }
  if (containsFiller(value)) {
    fail('filler', operation, 'The response contains conversational filler.');
  }
}

function validateNextQuestion(value: unknown): NextQuestionResult {
  const parsed = nextQuestionResultSchema.safeParse(value);
  if (!parsed.success) {
    fail('schema_invalid', 'next_question', 'The response does not match the next-question schema.');
  }

  const combined = [parsed.data.setup, parsed.data.question].filter(Boolean).join(' ');
  validateQuestionText('next_question', combined, 45);
  if (parsed.data.setup !== undefined && questionMarkCount(parsed.data.setup) !== 0) {
    fail('question_count', 'next_question', 'A normal-turn setup cannot contain a question mark.');
  }
  if (parsed.data.setup !== undefined && setupSentenceCount(parsed.data.setup) > 1) {
    fail('schema_invalid', 'next_question', 'A normal-turn setup can contain at most one sentence.');
  }
  if (questionMarkCount(parsed.data.question) !== 1 || !endsWithQuestionMark(parsed.data.question)) {
    fail('question_count', 'next_question', 'The normal-turn question must contain and end in exactly one question mark.');
  }
  if (containsUnsolicitedSynthesis(combined)) {
    fail('unsolicited_synthesis', 'next_question', 'The response synthesizes before the user requested a conclusion.');
  }
  if (containsUnqualifiedReference(parsed.data.question)) {
    fail('question_independence', 'next_question', 'The question must use explicit noun phrases instead of unqualified referents.');
  }

  return parsed.data;
}

function validateChallenge(value: unknown): ChallengeResult {
  const parsed = challengeResultSchema.safeParse(value);
  if (!parsed.success) {
    fail('challenge_shape', 'challenge', 'The response does not match either Challenge shape.');
  }

  switch (parsed.data.kind) {
    case 'blind_spot': {
      validateQuestionText('challenge', parsed.data.question, 55);
      if (!endsWithQuestionMark(parsed.data.question)) {
        fail('challenge_shape', 'challenge', 'A blind-spot Challenge must end with its question.');
      }
      return parsed.data;
    }
    case 'counter_position': {
      const combined = `${parsed.data.counterPosition} ${parsed.data.question}`;
      validateQuestionText('challenge', combined, 100);
      if (!endsWithQuestionMark(parsed.data.question)) {
        fail('challenge_shape', 'challenge', 'A counter-position Challenge must end with its question.');
      }
      return parsed.data;
    }
    default:
      return assertNever(parsed.data);
  }
}

function validateConclusion(value: unknown): WorkingConclusionResult {
  const parsed = workingConclusionResultSchema.safeParse(value);
  if (!parsed.success) {
    fail('conclusion_shape', 'conclusion', 'The response does not match the working-conclusion shape.');
  }

  if (wordCount(parsed.data.thesis) > 150) {
    fail('word_limit', 'conclusion', 'The working thesis exceeds 150 words.');
  }

  const generatedText = [
    parsed.data.thesis,
    ...parsed.data.insights,
    ...parsed.data.observations,
    ...parsed.data.tensions,
    ...parsed.data.caveats,
  ].join(' ');
  if (containsProhibitedQuestion(generatedText)) {
    fail('prohibited_question', 'conclusion', 'The generated conclusion contains prohibited justification phrasing.');
  }
  if (containsFiller(generatedText)) {
    fail('filler', 'conclusion', 'The response contains conversational filler.');
  }

  return parsed.data;
}

export function validateOperationResult(
  operation: 'next_question',
  value: unknown,
): NextQuestionResult;
export function validateOperationResult(
  operation: 'challenge',
  value: unknown,
): ChallengeResult;
export function validateOperationResult(
  operation: 'conclusion',
  value: unknown,
): WorkingConclusionResult;
export function validateOperationResult(
  operation: Operation,
  value: unknown,
): OperationResult;
export function validateOperationResult(
  operation: Operation,
  value: unknown,
): OperationResult {
  switch (operation) {
    case 'next_question':
      return validateNextQuestion(value);
    case 'challenge':
      return validateChallenge(value);
    case 'conclusion':
      return validateConclusion(value);
    default:
      return assertNever(operation);
  }
}
