import { z } from 'zod';
import { assertNever } from '../domain/contracts';
import type {
  ChallengeResult,
  ImmediateSafetyResult,
  NextQuestionResult,
  Operation,
  QuestioningProvider,
  RequestId,
  SpecularErrorCode,
  ThreadContext,
  WorkingConclusionResult,
} from '../domain/contracts';
import {
  specularErrorSchema,
  threadContextSchema,
} from '../domain/schemas';
import { validateOperationResponse } from '../domain/validators';

const apiSuccessSchema = z.object({
  ok: z.literal(true),
  value: z.unknown(),
}).strict();

const apiFailureSchema = z.object({
  ok: z.literal(false),
  error: specularErrorSchema,
}).strict();

const apiResponseSchema = z.discriminatedUnion('ok', [
  apiSuccessSchema,
  apiFailureSchema,
]);

export type QuestioningFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface HttpQuestioningClientOptions {
  baseUrl?: string;
  fetch?: QuestioningFetch;
  isOnline?: () => boolean;
  timeoutMs?: number;
}

function clientErrorMessage(code: SpecularErrorCode): string {
  switch (code) {
    case 'offline':
      return 'Specular is offline.';
    case 'timeout':
      return 'The Specular request timed out.';
    case 'provider_unavailable':
      return 'Specular is temporarily unavailable.';
    case 'invalid_output':
      return 'Specular returned an invalid response.';
    case 'rate_limited':
      return 'Specular is receiving too many requests.';
    case 'storage_failure':
      return 'Specular could not update local storage.';
    default:
      return assertNever(code);
  }
}

function operationPath(operation: Operation): string {
  switch (operation) {
    case 'next_question':
      return 'next-question';
    case 'challenge':
      return 'challenge';
    case 'conclusion':
      return 'conclusion';
    default:
      return assertNever(operation);
  }
}

function statusErrorCode(status: number): SpecularErrorCode {
  switch (status) {
    case 408:
    case 504:
      return 'timeout';
    case 429:
      return 'rate_limited';
    default:
      return 'provider_unavailable';
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export class QuestioningClientError extends Error {
  readonly code: SpecularErrorCode;
  readonly requestId: RequestId | undefined;

  constructor(code: SpecularErrorCode, requestId?: RequestId) {
    super(clientErrorMessage(code));
    this.name = 'QuestioningClientError';
    this.code = code;
    this.requestId = requestId;
  }
}

export class HttpQuestioningClient implements QuestioningProvider {
  private readonly baseUrl: string;
  private readonly fetchRequest: QuestioningFetch;
  private readonly isOnline: () => boolean;
  private readonly timeoutMs: number;

  constructor(options: HttpQuestioningClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '/api/operations').replace(/\/+$/u, '');
    this.fetchRequest = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.isOnline = options.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine);
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async nextQuestion(
    context: ThreadContext,
  ): Promise<NextQuestionResult | ImmediateSafetyResult> {
    const value = await this.request('next_question', context);
    try {
      return validateOperationResponse('next_question', value);
    } catch {
      throw new QuestioningClientError('invalid_output');
    }
  }

  async challenge(
    context: ThreadContext,
  ): Promise<ChallengeResult | ImmediateSafetyResult> {
    const value = await this.request('challenge', context);
    try {
      return validateOperationResponse('challenge', value);
    } catch {
      throw new QuestioningClientError('invalid_output');
    }
  }

  async draftConclusion(
    context: ThreadContext,
  ): Promise<WorkingConclusionResult | ImmediateSafetyResult> {
    const value = await this.request('conclusion', context);
    try {
      return validateOperationResponse('conclusion', value);
    } catch {
      throw new QuestioningClientError('invalid_output');
    }
  }

  private async request(operation: Operation, context: ThreadContext): Promise<unknown> {
    const parsedContext = threadContextSchema.safeParse(context);
    if (!parsedContext.success || parsedContext.data.operation !== operation) {
      throw new QuestioningClientError('invalid_output');
    }
    if (!this.isOnline()) {
      throw new QuestioningClientError('offline');
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, this.timeoutMs);

    try {
      let response: Response;
      try {
        response = await this.fetchRequest(
          `${this.baseUrl}/${operationPath(operation)}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ context: parsedContext.data }),
            signal: abortController.signal,
          },
        );
      } catch (error) {
        if (abortController.signal.aborted || isAbortError(error)) {
          throw new QuestioningClientError('timeout');
        }
        throw new QuestioningClientError(this.isOnline() ? 'provider_unavailable' : 'offline');
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        if (abortController.signal.aborted || isAbortError(error)) {
          throw new QuestioningClientError('timeout');
        }
        throw new QuestioningClientError(
          response.ok ? 'invalid_output' : statusErrorCode(response.status),
        );
      }

      const parsedResponse = apiResponseSchema.safeParse(body);
      if (!parsedResponse.success) {
        throw new QuestioningClientError(
          response.ok ? 'invalid_output' : statusErrorCode(response.status),
        );
      }
      if (!parsedResponse.data.ok) {
        throw new QuestioningClientError(
          parsedResponse.data.error.code,
          parsedResponse.data.error.requestId,
        );
      }
      if (!response.ok) {
        throw new QuestioningClientError(statusErrorCode(response.status));
      }

      return parsedResponse.data.value;
    } finally {
      clearTimeout(timeout);
    }
  }
}
