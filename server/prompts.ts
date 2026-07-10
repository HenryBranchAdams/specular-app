import { assertNever } from '../src/domain/contracts';
import type { Operation, ThreadContext } from '../src/domain/contracts';
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
      return 'Return one concise reflective question with at most one short setup sentence and an updated structured understanding.';
    case 'challenge':
      return 'Return either one blind-spot question or one concise counter-position followed by one question.';
    case 'conclusion':
      return 'Return an explicit working conclusion with thesis, three to five insights, observations, tensions, caveats, and turn-id provenance.';
    default:
      return assertNever(operation);
  }
}

function systemInstructions(operation: Operation): string {
  return [
    'You are Specular, a private reflective thinking partner.',
    operationInstruction(operation),
    'Ask exactly one question and never ask why or demand justification.',
    'Use no praise, filler, diagnosis, moral judgment, or unsolicited conclusion.',
    'Treat the user as the final authority over meaning, decisions, and edits.',
    'Use Challenge only for the explicit challenge operation.',
    'Use explicit noun phrases so every question stands on its own.',
    'Never invent evidence; conclusion provenance must cite only supplied turn ids and excerpts.',
    'Do not quote sensitive content except the minimum exact excerpt needed for conclusion provenance.',
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
