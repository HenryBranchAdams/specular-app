import { assertNever } from '../src/domain/contracts';
import type {
  Operation,
  OperationResult,
  ThreadContext,
  TurnId,
} from '../src/domain/contracts';
import type { CrisisRegion } from './config';

const DIRECT_IMMEDIATE_INTENT = [
  /\b(?:i\s+am|i'm)\s+(?:going|planning)\s+to\s+(?:(?:kill|hurt|harm|shoot|stab|hang|poison|drown)\s+myself\b(?!\s+(?:laughing|with\s+laughter|from\s+laughing)\b)|(?:commit\s+)?suicide\b)/iu,
  /\bi\s+(?:will|intend\s+to|plan\s+to|am\s+about\s+to)\s+(?:(?:kill|hurt|harm|shoot|stab|hang|poison|drown)\s+myself\b(?!\s+(?:laughing|with\s+laughter|from\s+laughing)\b)|(?:commit\s+)?suicide\b)/iu,
  /\b(?:i\s+am|i'm)\s+(?:going|planning)\s+to\s+(?:end\s+my\s+life|take\s+my\s+own\s+life)\b/iu,
  /\bi\s+(?:cannot|can't)\s+(?:(?:keep|stay)\s+myself\s+safe|stay\s+safe)\b/iu,
];

const POSSESSES_LETHAL_MEANS = /\b(?:i\s+)?(?:have|got)\s+(?:some\s+|a\s+|the\s+)?(?:gun|weapon|pills|medication|means|method)\b/iu;
const INTENDS_TO_USE_MEANS = /\b(?:(?:i\s+am|i'm)\s+(?:going|about)\s+to|(?:i\s+)?(?:intend|plan)\s+to)\s+(?:use|take|swallow|fire)\s+(?:it|them|the\s+whole\s+bottle|all)\b/iu;
const SELF_IDENTIFIES_SUICIDAL = /\b(?:i\s+am|i'm)\s+suicidal\b/iu;
const IMMEDIATE_TIME = /\b(?:right\s+now|tonight|today|immediately|soon)\b/iu;

function latestUserContent(context: ThreadContext): string | undefined {
  return [...context.turns].reverse().find((turn) => turn.role === 'user')?.content;
}

export function requiresImmediateSafetyResponse(context: ThreadContext): boolean {
  const authoredContent = latestUserContent(context);
  if (authoredContent === undefined) {
    return false;
  }
  const content = authoredContent.replaceAll('’', "'");
  if (DIRECT_IMMEDIATE_INTENT.some((pattern) => pattern.test(content))) {
    return true;
  }
  return POSSESSES_LETHAL_MEANS.test(content)
    && INTENDS_TO_USE_MEANS.test(content)
    && IMMEDIATE_TIME.test(content)
    && (SELF_IDENTIFIES_SUICIDAL.test(content) || /\b(?:pills|medication)\b/iu.test(content));
}

function regionalGuidance(region: CrisisRegion): string {
  switch (region) {
    case 'AU':
      return 'Call 000 now or Lifeline at 13 11 14; you can continue here after contacting immediate support.';
    case 'CA':
      return 'Call 911 now or call or text 988; you can continue here after contacting immediate support.';
    case 'EU':
      return 'Call 112 now or go to the nearest emergency department; you can continue here after contacting immediate support.';
    case 'GB':
      return 'Call 999 or 112 now; Samaritans is at 116 123, and you can continue here after contacting immediate support.';
    case 'US':
      return 'Call 911 now or call or text 988; you can continue here after contacting immediate support.';
    case 'other':
      return 'Call local emergency services now or go to the nearest emergency department; you can continue here after contacting immediate support.';
    default:
      return assertNever(region);
  }
}

function safetyQuestion(): string {
  return 'Can you move away from anything you could use for harm and contact one trusted person now?';
}

function sourceTurnId(context: ThreadContext): TurnId {
  const turn = [...context.turns].reverse().find((candidate) => candidate.role === 'user');
  if (turn === undefined) {
    throw new Error('A safety response requires a source user turn.');
  }
  return turn.id;
}

export function createSafetyResult(
  operation: Operation,
  context: ThreadContext,
  region: CrisisRegion,
): OperationResult {
  const guidance = regionalGuidance(region);
  const question = safetyQuestion();

  switch (operation) {
    case 'next_question':
      return {
        kind: 'question',
        setup: guidance,
        question,
        understanding: context.understanding,
      };
    case 'challenge':
      return {
        kind: 'counter_position',
        counterPosition: `${guidance} Your immediate safety takes priority, and you remain in control of what you share.`,
        question,
      };
    case 'conclusion':
      return {
        kind: 'working_conclusion',
        thesis: guidance,
        insights: [
          'Immediate safety takes priority over completing the reflection.',
          question,
          'You remain in control of what you share and can continue after contacting support.',
        ],
        observations: [],
        tensions: [],
        caveats: ['This response does not diagnose or replace immediate human support.'],
        provenance: [{
          turnId: sourceTurnId(context),
          excerpt: 'An immediate safety concern needs attention.',
        }],
      };
    default:
      return assertNever(operation);
  }
}
