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

const REPORTING_AND_EVIDENCE_VERBS = new Set([
  'confirm', 'confirms', 'confirmed',
  'demonstrate', 'demonstrates', 'demonstrated',
  'establish', 'establishes', 'established',
  'indicate', 'indicates', 'indicated',
  'prove', 'proves', 'proved',
  'report', 'reports', 'reported',
  'reveal', 'reveals', 'revealed',
  'say', 'says', 'said',
  'show', 'shows', 'showed',
  'suggest', 'suggests', 'suggested',
]);
const EXISTENTIAL_AUXILIARIES = new Set([
  'are', 'can', 'could', 'is', 'might', 'was', 'were', 'would',
]);
const EXISTENTIAL_DETERMINERS = new Set([
  'a', 'an', 'another', 'any', 'each', 'either', 'every', 'neither', 'no',
  'one', 'some', 'that', 'the', 'these', 'this', 'those',
]);
const EXPLICIT_NOUN_DETERMINERS = new Set([
  ...EXISTENTIAL_DETERMINERS,
  'that', 'these', 'this', 'those', 'which', 'whose',
]);
const GENERIC_REFERENCE_NOUNS = new Set([
  'aspect', 'element', 'former', 'issue', 'item', 'latter', 'one', 'option',
  'part', 'point', 'side', 'something', 'thing',
]);
const REFERENCE_PRONOUNS = new Set([
  'he', 'her', 'hers', 'him', 'his', 'it', 'its', 'she', 'their', 'theirs',
  'them', 'they',
]);
const NON_NOUN_TOKENS = new Set([
  'about', 'after', 'against', 'and', 'are', 'as', 'at', 'be', 'because',
  'before', 'better', 'but', 'by', 'can', 'change', 'changes', 'could', 'did',
  'do', 'does', 'exist', 'exists', 'fail', 'fails', 'for', 'from', 'happen',
  'happens', 'has', 'have', 'how', 'if', 'in', 'is', 'leave', 'leaves',
  'matter', 'matters', 'may', 'mean', 'means', 'might', 'most', 'must', 'of',
  'on', 'or', 'own', 'owns', 'receive', 'receives', 'remain', 'remains',
  'said', 'say', 'says', 'should', 'show', 'showed', 'shows', 'than', 'to',
  'under', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'whose',
  'will', 'with', 'without', 'would',
]);
const DEMONSTRATIVES = new Set(['that', 'these', 'this', 'those']);
const ALWAYS_UNQUALIFIED_REFERENCES = new Set(['former', 'here', 'latter']);
const SENTENCE_TERMINATORS = new Set(['!', '.', '?', '。', '！', '？']);
const HONORIFICS = new Set(['dr', 'jr', 'mr', 'mrs', 'ms', 'mx', 'prof', 'sr', 'st']);
const INTERNAL_MULTI_PERIOD_ABBREVIATION = /\b(?:e\.g|i\.e)\./giu;

interface ReferenceToken {
  normalized: string;
  original: string;
}

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

  const internalAbbreviationPeriods = new Set<number>();
  for (const match of normalized.matchAll(INTERNAL_MULTI_PERIOD_ABBREVIATION)) {
    for (let offset = 0; offset < match[0].length; offset += 1) {
      if (match[0][offset] === '.') {
        internalAbbreviationPeriods.add(match.index + offset);
      }
    }
  }

  let sentenceCount = 0;
  let hasContent = false;
  let index = 0;

  while (index < normalized.length) {
    const character = normalized[index];
    if (character === undefined) {
      break;
    }
    if (!SENTENCE_TERMINATORS.has(character)) {
      if (!/\s/u.test(character)) {
        hasContent = true;
      }
      index += 1;
      continue;
    }

    let clusterEnd = index + 1;
    while (clusterEnd < normalized.length) {
      const clusteredCharacter = normalized[clusterEnd];
      if (clusteredCharacter === undefined || !SENTENCE_TERMINATORS.has(clusteredCharacter)) {
        break;
      }
      clusterEnd += 1;
    }

    const isSinglePeriod = character === '.' && clusterEnd === index + 1;
    if (isSinglePeriod && (
      internalAbbreviationPeriods.has(index)
      || isHonorificPeriod(normalized, index)
      || isContinuingEtcPeriod(normalized, index)
      || isNumericSeparatorPeriod(normalized, index)
    )) {
      index = clusterEnd;
      continue;
    }

    if (hasContent) {
      sentenceCount += 1;
      hasContent = false;
    }
    index = clusterEnd;
  }

  return sentenceCount + (hasContent ? 1 : 0);
}

function isHonorificPeriod(value: string, periodIndex: number): boolean {
  const honorific = /([\p{L}]+)$/u
    .exec(value.slice(0, periodIndex))?.[1]
    ?.toLocaleLowerCase('en-US');
  if (honorific === undefined || !HONORIFICS.has(honorific)) {
    return false;
  }

  return /^\s*[\p{Lu}\p{Lt}]/u.test(value.slice(periodIndex + 1));
}

function isContinuingEtcPeriod(value: string, periodIndex: number): boolean {
  const precedingWord = /([\p{L}]+)$/u
    .exec(value.slice(0, periodIndex))?.[1]
    ?.toLocaleLowerCase('en-US');
  if (precedingWord !== 'etc') {
    return false;
  }

  const nextCharacter = /\S/u.exec(value.slice(periodIndex + 1))?.[0];
  return nextCharacter !== undefined && !/[\p{Lu}\p{Lt}\d]/u.test(nextCharacter);
}

function isNumericSeparatorPeriod(value: string, periodIndex: number): boolean {
  const previous = value[periodIndex - 1];
  const next = value[periodIndex + 1];
  return previous !== undefined
    && next !== undefined
    && /\d/u.test(previous)
    && /\d/u.test(next);
}

function tokenizeQuestion(value: string): ReferenceToken[] {
  return (value.match(/[\p{L}\d]+(?:['’][\p{L}\d]+)*/gu) ?? []).map((original) => ({
    normalized: original.toLocaleLowerCase('en-US'),
    original,
  }));
}

function isNounLike(token: string): boolean {
  return !NON_NOUN_TOKENS.has(token)
    && !EXPLICIT_NOUN_DETERMINERS.has(token)
    && !GENERIC_REFERENCE_NOUNS.has(token)
    && !REFERENCE_PRONOUNS.has(token)
    && !DEMONSTRATIVES.has(token)
    && !ALWAYS_UNQUALIFIED_REFERENCES.has(token);
}

function hasExplicitNounPhraseBefore(tokens: ReferenceToken[], referenceIndex: number): boolean {
  for (let index = 1; index < referenceIndex; index += 1) {
    const candidate = tokens[index];
    const determiner = tokens[index - 1];
    if (
      candidate !== undefined
      && determiner !== undefined
      && EXPLICIT_NOUN_DETERMINERS.has(determiner.normalized)
      && isNounLike(candidate.normalized)
    ) {
      return true;
    }

    if (
      candidate !== undefined
      && index > 0
      && /^\p{Lu}/u.test(candidate.original)
      && isNounLike(candidate.normalized)
    ) {
      return true;
    }
  }

  return false;
}

function qualifiesExplicitNoun(tokens: ReferenceToken[], referenceIndex: number): boolean {
  const previous = tokens[referenceIndex - 1]?.normalized;
  const next = tokens[referenceIndex + 1]?.normalized;
  return previous !== 'of' && next !== undefined && isNounLike(next);
}

function isLicensedThat(tokens: ReferenceToken[], referenceIndex: number): boolean {
  const previous = tokens[referenceIndex - 1]?.normalized;
  const introducesClause = hasExplicitClauseSubject(tokens, referenceIndex + 1);
  return (previous !== undefined && REPORTING_AND_EVIDENCE_VERBS.has(previous) && introducesClause)
    || qualifiesExplicitNoun(tokens, referenceIndex);
}

function hasExplicitClauseSubject(tokens: ReferenceToken[], subjectIndex: number): boolean {
  const subject = tokens[subjectIndex]?.normalized;
  if (subject === undefined) {
    return false;
  }
  if (REFERENCE_PRONOUNS.has(subject)) {
    return true;
  }
  if (EXISTENTIAL_DETERMINERS.has(subject)) {
    const noun = tokens[subjectIndex + 1]?.normalized;
    return noun !== undefined
      && !EXPLICIT_NOUN_DETERMINERS.has(noun)
      && isNounLike(noun);
  }

  return isNounLike(subject);
}

function isExistentialThere(tokens: ReferenceToken[], referenceIndex: number): boolean {
  const previous = tokens[referenceIndex - 1]?.normalized;
  const next = tokens[referenceIndex + 1]?.normalized;

  if (previous !== undefined && EXISTENTIAL_AUXILIARIES.has(previous)) {
    const subjectIndex = next === 'be' || next === 'been' ? referenceIndex + 2 : referenceIndex + 1;
    return hasExplicitClauseSubject(tokens, subjectIndex);
  }

  if (next !== undefined && EXISTENTIAL_AUXILIARIES.has(next)) {
    return hasExplicitClauseSubject(tokens, referenceIndex + 2);
  }

  return false;
}

function containsUnqualifiedReference(value: string): boolean {
  const tokens = tokenizeQuestion(value);

  return tokens.some((token, index) => {
    if (ALWAYS_UNQUALIFIED_REFERENCES.has(token.normalized)) {
      return true;
    }
    if (token.normalized === 'there') {
      return !isExistentialThere(tokens, index);
    }
    if (token.normalized === 'that') {
      return !isLicensedThat(tokens, index);
    }
    if (token.normalized === 'this' || token.normalized === 'these' || token.normalized === 'those') {
      return !qualifiesExplicitNoun(tokens, index);
    }
    if (REFERENCE_PRONOUNS.has(token.normalized)) {
      return !hasExplicitNounPhraseBefore(tokens, index);
    }

    return false;
  });
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
