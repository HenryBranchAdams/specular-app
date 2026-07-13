import { createHmac, randomBytes } from 'node:crypto';
import { assertNever } from '../src/domain/contracts';
import type {
  Operation,
  OperationResult,
  OperationResponse,
  RequestId,
  SpecularError,
  SpecularErrorCode,
  ThreadContext,
} from '../src/domain/contracts';
import {
  isGatherEligible,
  ProductValidationError,
  type ProductValidationErrorCode,
  validateConclusionAuthorship,
  validateOperationResult,
} from '../src/domain/validators';
import type { CrisisRegion } from './config';
import {
  createSafetyResult,
  requiresImmediateSafetyResponse,
} from './safety';
import type {
  MetadataSink,
  ProviderTokenUsage,
  SchemaOutcome,
  ServerTelemetryEvent,
} from './telemetry';

export type ProviderFailureCode =
  | 'incomplete'
  | 'null_output'
  | 'refusal'
  | 'timeout'
  | 'unavailable';

export class ProviderRequestError extends Error {
  readonly code: ProviderFailureCode;

  constructor(code: ProviderFailureCode) {
    super(`Provider request failed: ${code}`);
    this.name = 'ProviderRequestError';
    this.code = code;
  }
}

export type ProviderRepairInput =
  | { kind: 'structured'; value: unknown }
  | { kind: 'text'; value: string };

export interface ProviderAttempt {
  value: unknown;
  repairInput: ProviderRepairInput;
  tokenUsage?: ProviderTokenUsage;
}

export interface ProviderRequest {
  operation: Operation;
  context: ThreadContext;
  signal: AbortSignal;
  safetyIdentifier: string;
}

export interface ProviderRepairRequest extends ProviderRequest {
  invalidOutput: ProviderRepairInput;
  validationCodes: readonly ProductValidationErrorCode[];
}

export interface RepairingQuestioningProvider {
  readonly configured: boolean;
  readonly providerId: string;
  readonly modelId: string;
  generate(request: ProviderRequest): Promise<ProviderAttempt>;
  repair(request: ProviderRepairRequest): Promise<ProviderAttempt>;
}

export type OperationServiceResult =
  | { ok: true; value: OperationResponse }
  | { ok: false; error: SpecularError };

export interface ExecuteOperationRequest {
  operation: Operation;
  context: ThreadContext;
  requestId: RequestId;
  signal: AbortSignal;
}

export interface OperationService {
  execute(request: ExecuteOperationRequest): Promise<OperationServiceResult>;
  isReady(): boolean;
}

interface OperationServiceOptions {
  provider: RepairingQuestioningProvider;
  telemetry: MetadataSink;
  safetyRegion: CrisisRegion;
  now?: () => number;
  safetySecret?: Uint8Array;
}

function errorMessage(code: SpecularErrorCode): string {
  switch (code) {
    case 'offline':
      return 'The server cannot report an offline client state.';
    case 'timeout':
      return 'The Specular request timed out.';
    case 'provider_unavailable':
      return 'Specular is temporarily unavailable.';
    case 'invalid_output':
      return 'Specular could not produce a valid response.';
    case 'rate_limited':
      return 'Specular is receiving too many requests.';
    case 'storage_failure':
      return 'The stateless server does not use client storage.';
    default:
      return assertNever(code);
  }
}

export function createServiceError(code: SpecularErrorCode, requestId: RequestId): SpecularError {
  return {
    code,
    message: errorMessage(code),
    retryable: code !== 'storage_failure',
    requestId,
  };
}

function providerErrorCode(error: unknown): SpecularErrorCode {
  if (!(error instanceof ProviderRequestError)) {
    return 'provider_unavailable';
  }
  switch (error.code) {
    case 'timeout':
      return 'timeout';
    case 'null_output':
      return 'invalid_output';
    case 'incomplete':
    case 'refusal':
    case 'unavailable':
      return 'provider_unavailable';
    default:
      return assertNever(error.code);
  }
}

function addTokenUsage(
  current: ProviderTokenUsage | undefined,
  next: ProviderTokenUsage | undefined,
): ProviderTokenUsage | undefined {
  if (next === undefined) {
    return current;
  }
  if (current === undefined) {
    return { ...next };
  }
  return {
    inputTokens: current.inputTokens + next.inputTokens,
    outputTokens: current.outputTokens + next.outputTokens,
    totalTokens: current.totalTokens + next.totalTokens,
  };
}

async function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    throw new ProviderRequestError('timeout');
  }

  return await new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      reject(new ProviderRequestError('timeout'));
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error instanceof Error ? error : new ProviderRequestError('unavailable'));
      },
    );
  });
}

function validationCode(error: unknown): ProductValidationErrorCode {
  return error instanceof ProductValidationError ? error.code : 'schema_invalid';
}

function validateProviderResult(
  operation: Operation,
  value: unknown,
  context: ThreadContext,
): OperationResult {
  if (operation === 'conclusion') {
    return validateConclusionAuthorship(
      validateOperationResult('conclusion', value),
      context.turns,
    );
  }
  return validateOperationResult(operation, value);
}

function safetyIdentifier(secret: Uint8Array, context: ThreadContext): string {
  return createHmac('sha256', secret).update(context.thread.id).digest('hex');
}

function telemetryEvent(
  provider: RepairingQuestioningProvider,
  request: ExecuteOperationRequest,
  startedAt: number,
  now: () => number,
  schemaOutcome: SchemaOutcome,
  repairCount: 0 | 1,
  status: 'success' | 'error',
  tokenUsage: ProviderTokenUsage | undefined,
  errorCode?: SpecularErrorCode,
): ServerTelemetryEvent {
  const base: ServerTelemetryEvent = {
    requestId: request.requestId,
    operation: request.operation,
    latencyMs: Math.max(0, now() - startedAt),
    providerId: provider.providerId,
    modelId: provider.modelId,
    schemaOutcome,
    repairCount,
    status,
  };
  return {
    ...base,
    ...(tokenUsage === undefined ? {} : { tokenUsage }),
    ...(errorCode === undefined ? {} : { errorCode }),
  };
}

async function recordSafely(sink: MetadataSink, event: ServerTelemetryEvent): Promise<void> {
  try {
    await sink.record(event);
  } catch {
    // Metadata must never be able to alter the private request path.
  }
}

export function createOperationService(options: OperationServiceOptions): OperationService {
  const now = options.now ?? Date.now;
  const secret = options.safetySecret ?? randomBytes(32);

  return {
    isReady(): boolean {
      return options.provider.configured;
    },

    async execute(request: ExecuteOperationRequest): Promise<OperationServiceResult> {
      const startedAt = now();
      let repairCount: 0 | 1 = 0;
      let usage: ProviderTokenUsage | undefined;

      if (requiresImmediateSafetyResponse(request.context)) {
        const value = createSafetyResult(options.safetyRegion);
        await recordSafely(options.telemetry, telemetryEvent(
          options.provider,
          request,
          startedAt,
          now,
          'valid',
          repairCount,
          'success',
          usage,
        ));
        return { ok: true, value };
      }

      if (request.operation === 'conclusion' && !isGatherEligible(request.context.turns)) {
        const error = createServiceError('invalid_output', request.requestId);
        return { ok: false, error };
      }

      if (!options.provider.configured) {
        const error = createServiceError('provider_unavailable', request.requestId);
        await recordSafely(options.telemetry, telemetryEvent(
          options.provider,
          request,
          startedAt,
          now,
          'not_checked',
          repairCount,
          'error',
          usage,
          error.code,
        ));
        return { ok: false, error };
      }

      const providerRequest: ProviderRequest = {
        operation: request.operation,
        context: request.context,
        signal: request.signal,
        safetyIdentifier: safetyIdentifier(secret, request.context),
      };

      try {
        let attempt = await raceWithAbort(
          options.provider.generate(providerRequest),
          request.signal,
        );
        usage = addTokenUsage(usage, attempt.tokenUsage);

        let value: OperationResult;
        try {
          value = validateProviderResult(request.operation, attempt.value, request.context);
        } catch (firstValidationError) {
          repairCount = 1;
          attempt = await raceWithAbort(options.provider.repair({
            ...providerRequest,
            invalidOutput: attempt.repairInput,
            validationCodes: [validationCode(firstValidationError)],
          }), request.signal);
          usage = addTokenUsage(usage, attempt.tokenUsage);

          try {
            value = validateProviderResult(request.operation, attempt.value, request.context);
          } catch {
            const error = createServiceError('invalid_output', request.requestId);
            await recordSafely(options.telemetry, telemetryEvent(
              options.provider,
              request,
              startedAt,
              now,
              'invalid',
              repairCount,
              'error',
              usage,
              error.code,
            ));
            return { ok: false, error };
          }
        }

        await recordSafely(options.telemetry, telemetryEvent(
          options.provider,
          request,
          startedAt,
          now,
          'valid',
          repairCount,
          'success',
          usage,
        ));
        return { ok: true, value };
      } catch (providerError) {
        const error = createServiceError(providerErrorCode(providerError), request.requestId);
        await recordSafely(options.telemetry, telemetryEvent(
          options.provider,
          request,
          startedAt,
          now,
          'not_checked',
          repairCount,
          'error',
          usage,
          error.code,
        ));
        return { ok: false, error };
      }
    },
  };
}
