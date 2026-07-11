import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { assertNever } from '../src/domain/contracts';
import type { Operation } from '../src/domain/contracts';
import {
  MAX_RESULT_TEXT_LENGTH,
  challengeResultSchema,
  nextQuestionResultSchema,
  threadUnderstandingSchema,
  workingConclusionResultSchema,
} from '../src/domain/schemas';
import {
  ProviderRequestError,
  type ProviderAttempt,
  type ProviderRepairRequest,
  type ProviderRequest,
  type RepairingQuestioningProvider,
} from './operation-service';
import { buildOperationPrompt, buildRepairPrompt, type OperationPrompt } from './prompts';
import type { ProviderTokenUsage } from './telemetry';

export interface OpenAIResponsesClient {
  responses: {
    create(
      body: OpenAI.Responses.ResponseCreateParamsNonStreaming,
      options: { signal: AbortSignal },
    ): Promise<OpenAI.Responses.Response>;
  };
}

interface OpenAIQuestioningProviderOptions {
  apiKey: string | undefined;
  model: string;
  client?: OpenAIResponsesClient;
}

const apiResultTextSchema = z.string().trim().min(1).max(MAX_RESULT_TEXT_LENGTH);

const openAiNextQuestionSchema = z.object({
  kind: z.literal('question'),
  setup: apiResultTextSchema.nullable(),
  question: apiResultTextSchema,
  understanding: threadUnderstandingSchema,
}).strict();

const openAiChallengeSchema = z.object({
  kind: z.literal('blind_spot'),
  question: apiResultTextSchema,
}).strict();

function responseFormat(operation: Operation) {
  switch (operation) {
    case 'next_question':
      return zodTextFormat(openAiNextQuestionSchema, 'specular_next_question');
    case 'challenge':
      return zodTextFormat(openAiChallengeSchema, 'specular_challenge');
    case 'conclusion':
      return zodTextFormat(workingConclusionResultSchema, 'specular_conclusion');
    default:
      return assertNever(operation);
  }
}

function parseApiOutput(operation: Operation, value: unknown): unknown {
  switch (operation) {
    case 'next_question': {
      const parsed = openAiNextQuestionSchema.safeParse(value);
      if (!parsed.success) {
        return value;
      }
      const { setup, ...required } = parsed.data;
      const sharedValue = setup === null ? required : { ...required, setup };
      const shared = nextQuestionResultSchema.safeParse(sharedValue);
      return shared.success ? shared.data : value;
    }
    case 'challenge': {
      const parsed = openAiChallengeSchema.safeParse(value);
      if (!parsed.success) {
        return value;
      }
      const shared = challengeResultSchema.safeParse(parsed.data);
      return shared.success ? shared.data : value;
    }
    case 'conclusion': {
      const parsed = workingConclusionResultSchema.safeParse(value);
      return parsed.success ? parsed.data : value;
    }
    default:
      return assertNever(operation);
  }
}

function maxOutputTokens(operation: Operation): number {
  switch (operation) {
    case 'next_question':
      return 1_200;
    case 'challenge':
      return 900;
    case 'conclusion':
      return 2_400;
    default:
      return assertNever(operation);
  }
}

function tokenUsage(
  usage: { input_tokens: number; output_tokens: number; total_tokens: number } | undefined,
): ProviderTokenUsage | undefined {
  if (usage === undefined) {
    return undefined;
  }
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
  };
}

function hasRefusal(response: OpenAI.Responses.Response): boolean {
  return response.output.some((item) => item.type === 'message'
    && item.content.some((content) => content.type === 'refusal'));
}

function isTimeout(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) {
    return true;
  }
  return error instanceof Error
    && (error.name === 'AbortError' || error.name === 'APIConnectionTimeoutError');
}

function requireCompletedResponse(response: OpenAI.Responses.Response): void {
  if (response.error !== null) {
    throw new ProviderRequestError('unavailable');
  }
  switch (response.status) {
    case undefined:
    case 'completed':
      return;
    case 'incomplete':
      throw new ProviderRequestError('incomplete');
    case 'failed':
    case 'in_progress':
    case 'cancelled':
    case 'queued':
      throw new ProviderRequestError('unavailable');
    default:
      return assertNever(response.status);
  }
}

export class OpenAIQuestioningProvider implements RepairingQuestioningProvider {
  readonly providerId = 'openai';
  readonly modelId: string;
  readonly configured: boolean;
  private readonly client: OpenAIResponsesClient | undefined;

  constructor(options: OpenAIQuestioningProviderOptions) {
    this.modelId = options.model;
    this.configured = options.client !== undefined
      || (options.apiKey !== undefined && options.apiKey.length > 0);
    this.client = options.client ?? (
      options.apiKey === undefined || options.apiKey.length === 0
        ? undefined
        : new OpenAI({ apiKey: options.apiKey })
    );
  }

  async generate(request: ProviderRequest): Promise<ProviderAttempt> {
    return await this.complete(request, buildOperationPrompt(request.operation, request.context));
  }

  async repair(request: ProviderRepairRequest): Promise<ProviderAttempt> {
    return await this.complete(request, buildRepairPrompt(
      request.operation,
      request.context,
      request.invalidOutput,
      request.validationCodes,
    ));
  }

  private async complete(
    request: ProviderRequest,
    prompt: OperationPrompt,
  ): Promise<ProviderAttempt> {
    if (this.client === undefined) {
      throw new ProviderRequestError('unavailable');
    }

    let response: OpenAI.Responses.Response;
    try {
      response = await this.client.responses.create({
        model: this.modelId,
        instructions: prompt.instructions,
        input: prompt.input,
        text: { format: responseFormat(request.operation) },
        max_output_tokens: maxOutputTokens(request.operation),
        safety_identifier: request.safetyIdentifier,
        store: false,
      }, { signal: request.signal });
    } catch (error) {
      throw new ProviderRequestError(isTimeout(error, request.signal) ? 'timeout' : 'unavailable');
    }

    requireCompletedResponse(response);
    if (hasRefusal(response)) {
      throw new ProviderRequestError('refusal');
    }

    const usage = tokenUsage(response.usage);
    const rawText = response.output_text;
    if (typeof rawText !== 'string' || rawText.trim() === '') {
      throw new ProviderRequestError('null_output');
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(rawText) as unknown;
    } catch {
      return {
        value: undefined,
        repairInput: { kind: 'text', value: rawText },
        ...(usage === undefined ? {} : { tokenUsage: usage }),
      };
    }

    if (decoded === null) {
      throw new ProviderRequestError('null_output');
    }

    return {
      value: parseApiOutput(request.operation, decoded),
      repairInput: { kind: 'structured', value: decoded },
      ...(usage === undefined ? {} : { tokenUsage: usage }),
    };
  }
}

export function createOpenAIQuestioningProvider(
  options: OpenAIQuestioningProviderOptions,
): RepairingQuestioningProvider {
  return new OpenAIQuestioningProvider(options);
}
