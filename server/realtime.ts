import { createHmac, randomBytes } from 'node:crypto';
import OpenAI from 'openai';
import { z } from 'zod';
import type { RequestId, SpecularError, SpecularErrorCode } from '../src/domain/contracts';
import { createServiceError } from './operation-service';

const MAX_CREDENTIAL_LENGTH = 4_096;
const MAX_INSTRUCTIONS_LENGTH = 1_200;
const EXPIRY_CLOCK_SKEW_SECONDS = 5;

const providerCredentialSchema = z.object({
  value: z.string().trim().min(1).max(MAX_CREDENTIAL_LENGTH),
  expires_at: z.number().int().positive(),
});

const credentialSchema = z.object({
  value: z.string().trim().min(1).max(MAX_CREDENTIAL_LENGTH),
  expiresAt: z.number().int().positive(),
}).strict();

const REALTIME_NORMAL_TURN_INSTRUCTIONS = [
  'Specular asks the next useful question so the user does the thinking and remains the final authority.',
  'Reply with at most one short setup sentence followed by one independently understandable question.',
  'Use exactly one question mark and no more than 45 words total.',
  'Never ask why or disguised why questions such as what makes you think, what led you to believe, or how come.',
  'Do not use praise, validation, filler, diagnosis, lectures, long preambles, or unsupported certainty.',
  'Do not provide a Challenge or conclusion in this voice turn; those remain separate operations that require explicit user invocation.',
].join(' ');

if (REALTIME_NORMAL_TURN_INSTRUCTIONS.length > MAX_INSTRUCTIONS_LENGTH) {
  throw new Error('Realtime instructions exceed the server-authored bound.');
}

export interface OpenAIRealtimeClient {
  realtime: {
    clientSecrets: {
      create: OpenAI['realtime']['clientSecrets']['create'];
    };
  };
}

export interface RealtimeCredential {
  value: string;
  expiresAt: number;
}

export interface RealtimeCredentialRequest {
  requestId: RequestId;
  signal: AbortSignal;
}

export interface RealtimeCredentialProvider {
  readonly configured: boolean;
  readonly providerId: string;
  readonly modelId: string;
  create(request: RealtimeCredentialRequest): Promise<RealtimeCredential>;
}

export type RealtimeCredentialServiceResult =
  | { ok: true; value: RealtimeCredential }
  | { ok: false; error: SpecularError };

export interface RealtimeCredentialService {
  create(request: RealtimeCredentialRequest): Promise<RealtimeCredentialServiceResult>;
  isReady(): boolean;
}

export interface RealtimeMetadataEvent {
  requestId: RequestId;
  latencyMs: number;
  providerId: string;
  modelId: string;
  status: 'success' | 'error';
  errorCode?: SpecularErrorCode;
}

export interface RealtimeMetadataSink {
  record(event: RealtimeMetadataEvent): void | Promise<void>;
}

export class JsonRealtimeMetadataSink implements RealtimeMetadataSink {
  record(event: RealtimeMetadataEvent): void {
    console.info(JSON.stringify(event));
  }
}

type RealtimeProviderFailureCode = 'invalid_output' | 'timeout' | 'unavailable';

class RealtimeProviderError extends Error {
  readonly code: RealtimeProviderFailureCode;

  constructor(code: RealtimeProviderFailureCode) {
    super(`Realtime provider request failed: ${code}.`);
    this.name = 'RealtimeProviderError';
    this.code = code;
  }
}

interface OpenAIRealtimeCredentialProviderOptions {
  apiKey: string | undefined;
  model: string;
  credentialTtlSeconds: number;
  timeoutMs: number;
  client?: OpenAIRealtimeClient;
  safetySecret?: Uint8Array;
}

interface RealtimeCredentialServiceOptions {
  provider: RealtimeCredentialProvider;
  telemetry: RealtimeMetadataSink;
  credentialTtlSeconds: number;
  now?: () => number;
}

function requireCredentialTtl(value: number): void {
  if (!Number.isSafeInteger(value) || value < 10 || value > 7_200) {
    throw new Error('Realtime credential TTL must be between 10 and 7200 seconds.');
  }
}

function isTimeout(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) {
    return true;
  }
  return error instanceof Error
    && (error.name === 'AbortError' || error.name === 'APIConnectionTimeoutError');
}

function safetyIdentifier(secret: Uint8Array, requestId: RequestId): string {
  return createHmac('sha256', secret).update(requestId).digest('hex');
}

async function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    throw new RealtimeProviderError('timeout');
  }

  return await new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      reject(new RealtimeProviderError('timeout'));
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error instanceof Error ? error : new RealtimeProviderError('unavailable'));
      },
    );
  });
}

async function recordSafely(
  telemetry: RealtimeMetadataSink,
  event: RealtimeMetadataEvent,
): Promise<void> {
  try {
    await telemetry.record(event);
  } catch {
    // Telemetry cannot change the credential result or expose provider data.
  }
}

function metadataEvent(
  provider: RealtimeCredentialProvider,
  request: RealtimeCredentialRequest,
  startedAt: number,
  now: () => number,
  status: 'success' | 'error',
  errorCode?: SpecularErrorCode,
): RealtimeMetadataEvent {
  return {
    requestId: request.requestId,
    latencyMs: Math.max(0, now() - startedAt),
    providerId: provider.providerId,
    modelId: provider.modelId,
    status,
    ...(errorCode === undefined ? {} : { errorCode }),
  };
}

function serviceErrorCode(error: unknown): SpecularErrorCode {
  if (!(error instanceof RealtimeProviderError)) {
    return 'provider_unavailable';
  }
  switch (error.code) {
    case 'invalid_output':
      return 'invalid_output';
    case 'timeout':
      return 'timeout';
    case 'unavailable':
      return 'provider_unavailable';
    default: {
      const exhaustive: never = error.code;
      throw new Error(`Unhandled Realtime provider error: ${String(exhaustive)}`);
    }
  }
}

export function createOpenAIRealtimeCredentialProvider(
  options: OpenAIRealtimeCredentialProviderOptions,
): RealtimeCredentialProvider {
  requireCredentialTtl(options.credentialTtlSeconds);
  const client = options.client ?? (
    options.apiKey === undefined || options.apiKey.length === 0
      ? undefined
      : new OpenAI({ apiKey: options.apiKey })
  );
  const secret = options.safetySecret ?? randomBytes(32);
  if (secret.byteLength < 32) {
    throw new Error('Realtime safety secret must contain at least 32 bytes.');
  }

  return {
    configured: client !== undefined,
    providerId: 'openai',
    modelId: options.model,
    async create(request: RealtimeCredentialRequest): Promise<RealtimeCredential> {
      if (client === undefined) {
        throw new RealtimeProviderError('unavailable');
      }

      let response: unknown;
      try {
        response = await client.realtime.clientSecrets.create({
          expires_after: {
            anchor: 'created_at',
            seconds: options.credentialTtlSeconds,
          },
          session: {
            type: 'realtime',
            model: options.model,
            max_output_tokens: 128,
            output_modalities: ['text'],
            audio: {
              input: {
                transcription: { model: 'gpt-4o-mini-transcribe' },
              },
            },
            instructions: REALTIME_NORMAL_TURN_INSTRUCTIONS,
          },
        }, {
          headers: {
            'OpenAI-Safety-Identifier': safetyIdentifier(secret, request.requestId),
          },
          maxRetries: 0,
          signal: request.signal,
          timeout: options.timeoutMs,
        });
      } catch (error) {
        throw new RealtimeProviderError(isTimeout(error, request.signal) ? 'timeout' : 'unavailable');
      }

      const parsed = providerCredentialSchema.safeParse(response);
      if (!parsed.success) {
        throw new RealtimeProviderError('invalid_output');
      }
      return {
        value: parsed.data.value,
        expiresAt: parsed.data.expires_at,
      };
    },
  };
}

export function createRealtimeCredentialService(
  options: RealtimeCredentialServiceOptions,
): RealtimeCredentialService {
  requireCredentialTtl(options.credentialTtlSeconds);
  const now = options.now ?? Date.now;

  return {
    isReady(): boolean {
      return options.provider.configured;
    },

    async create(request: RealtimeCredentialRequest): Promise<RealtimeCredentialServiceResult> {
      const startedAt = now();
      if (!options.provider.configured) {
        const error = createServiceError('provider_unavailable', request.requestId);
        await recordSafely(options.telemetry, metadataEvent(
          options.provider,
          request,
          startedAt,
          now,
          'error',
          error.code,
        ));
        return { ok: false, error };
      }

      try {
        if (request.signal.aborted) {
          throw new RealtimeProviderError('timeout');
        }
        const value = await raceWithAbort(options.provider.create(request), request.signal);
        const parsed = credentialSchema.safeParse(value);
        const currentSeconds = Math.floor(now() / 1_000);
        if (
          !parsed.success
          || parsed.data.expiresAt <= currentSeconds
          || parsed.data.expiresAt
            > currentSeconds + options.credentialTtlSeconds + EXPIRY_CLOCK_SKEW_SECONDS
        ) {
          throw new RealtimeProviderError('invalid_output');
        }
        await recordSafely(options.telemetry, metadataEvent(
          options.provider,
          request,
          startedAt,
          now,
          'success',
        ));
        return { ok: true, value: parsed.data };
      } catch (providerError) {
        const error = createServiceError(serviceErrorCode(providerError), request.requestId);
        await recordSafely(options.telemetry, metadataEvent(
          options.provider,
          request,
          startedAt,
          now,
          'error',
          error.code,
        ));
        return { ok: false, error };
      }
    },
  };
}
