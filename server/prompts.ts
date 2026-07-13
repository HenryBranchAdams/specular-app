import { assertNever } from '../src/domain/contracts';
import type { Operation, ThreadContext } from '../src/domain/contracts';
import { MAX_NEXT_QUESTION_WORDS } from '../src/domain/schemas';
import type { ProductValidationErrorCode } from '../src/domain/validators';
import type { ProviderRepairInput } from './operation-service';

const MAX_REPAIR_TEXT_LENGTH = 16_000;

export interface OperationPrompt {
  input: string;
  instructions: string;
}

function operationInstruction(operation: Operation): string {
  switch (operation) {
    case 'next_question':
      return 'Return exactly one concise, topic-focused question and an updated structured understanding. Do not return setup text.';
    case 'challenge':
      return 'Return one blind-spot or testing question. Use the blind_spot shape. Do not return a counter-position.';
    case 'conclusion':
      return 'Organize distinct exact excerpts from accepted user turns into the working-conclusion fields and turn-id provenance.';
    default:
      return assertNever(operation);
  }
}

function systemInstructions(operation: Operation): string {
  const questionInstructions = operation === 'conclusion'
    ? []
    : [
        'Ask exactly one focused question and never ask why or demand justification.',
        `Use no setup sentence and keep the question to ${String(MAX_NEXT_QUESTION_WORDS)} words or fewer.`,
        'Prefer concrete questions about evidence, assumptions, constraints, trade-offs, stakeholders, and decision criteria.',
        'Use explicit noun phrases so every question stands on its own.',
      ];
  const conclusionInstructions = operation === 'conclusion'
    ? [
        'Use accepted user turns only; never use Specular or system turns, structured understanding, or a provisional conclusion as source text.',
        'Copy each excerpt verbatim; do not paraphrase, synthesize, infer, recommend, combine, complete, or introduce any claim.',
        'Return one thesis excerpt, one to five insight excerpts, and only observations, tensions, or caveats the user explicitly stated.',
        'Every thesis, insight, observation, tension, and caveat value must exactly equal one provenance excerpt, and every provenance excerpt must be used exactly once.',
        'Each provenance turn id must identify the accepted user turn containing that exact excerpt.',
        'Leave optional arrays empty when the user did not explicitly state that material.',
      ]
    : [];

  return [
    'You are Specular, a neutral, structured thinking partner for developing ideas, theses, decisions, and creative directions.',
    operationInstruction(operation),
    ...questionInstructions,
    ...conclusionInstructions,
    'Use no praise, filler, diagnosis, moral judgment, or unsolicited conclusion.',
    'Treat the user as the final authority over goals, context, decisions, and edits.',
    'Use Challenge only for the explicit challenge operation.',
    'Never invent evidence.',
    'Do not quote sensitive content except the minimum exact excerpt required by the operation.',
    'If immediate danger appears in context, use concise non-diagnostic safety guidance and preserve the user’s ability to continue.',
    'Return only the requested strict structured object.',
  ].join('\n');
}

function serializeRepairInput(input: ProviderRepairInput): string {
  switch (input.kind) {
    case 'structured': {
      try {
        return JSON.stringify(input.value).slice(0, MAX_REPAIR_TEXT_LENGTH);
      } catch {
        return 'null';
      }
    }
    case 'text':
      return input.value.slice(0, MAX_REPAIR_TEXT_LENGTH);
    default:
      return assertNever(input);
  }
}

export function buildOperationPrompt(
  operation: Operation,
  context: ThreadContext,
): OperationPrompt {
  return {
    instructions: systemInstructions(operation),
    input: `Operation: ${operation}\nThread context JSON:\n${JSON.stringify(context)}`,
  };
}

export function buildRepairPrompt(
  operation: Operation,
  context: ThreadContext,
  invalidOutput: ProviderRepairInput,
  validationCodes: readonly ProductValidationErrorCode[],
): OperationPrompt {
  return {
    instructions: systemInstructions(operation),
    input: [
      `Operation: ${operation}`,
      `Stable validation codes: ${validationCodes.join(',')}`,
      `Invalid prior output JSON or text:\n${serializeRepairInput(invalidOutput)}`,
      `Thread context JSON:\n${JSON.stringify(context)}`,
      'Repair the output once and return only the strict structured object.',
    ].join('\n'),
  };
}
