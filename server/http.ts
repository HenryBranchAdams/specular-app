import { randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { z } from 'zod';
import type {
  Operation,
  RequestId,
  SpecularError,
  SpecularErrorCode,
} from '../src/domain/contracts';
import { requestIdSchema, threadContextSchema } from '../src/domain/schemas';
import type { ServerConfig } from './config';
import {
  createServiceError,
  type OperationService,
  type OperationServiceResult,
} from './operation-service';
import { createRateLimiter, type RateLimiter } from './rate-limit';

const operationRequestSchema = z.object({
  context: threadContextSchema,
}).strict();

const CONTENT_SECURITY_POLICY = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';

class HttpBoundaryError extends Error {
  readonly status: number;
  readonly code: SpecularErrorCode;

  constructor(status: number, code: SpecularErrorCode) {
    super(`HTTP boundary rejected request with ${String(status)}.`);
    this.name = 'HttpBoundaryError';
    this.status = status;
    this.code = code;
  }
}

interface HttpServerOptions {
  config: ServerConfig;
  service: OperationService;
  rateLimiter?: RateLimiter;
}

function operationForPath(path: string): Operation | undefined {
  switch (path) {
    case '/api/operations/next-question':
      return 'next_question';
    case '/api/operations/challenge':
      return 'challenge';
    case '/api/operations/conclusion':
      return 'conclusion';
    default:
      return undefined;
  }
}

function requestId(): RequestId {
  return requestIdSchema.parse(randomUUID());
}

function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
  response.setHeader('Cache-Control', 'no-store');
}

function applyAllowedOrigin(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: readonly string[],
): void {
  const origin = request.headers.origin;
  if (origin === undefined) {
    return;
  }
  if (!allowedOrigins.includes(origin)) {
    throw new HttpBoundaryError(403, 'provider_unavailable');
  }
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded || response.destroyed) {
    return;
  }
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(serialized),
  });
  response.end(serialized);
}

function sendError(
  response: ServerResponse,
  status: number,
  code: SpecularErrorCode,
  id: RequestId,
): void {
  sendJson(response, status, { ok: false, error: createServiceError(code, id) });
}

function statusForServiceError(error: SpecularError): number {
  switch (error.code) {
    case 'timeout':
      return 504;
    case 'provider_unavailable':
      return 503;
    case 'invalid_output':
      return 502;
    case 'rate_limited':
      return 429;
    case 'offline':
    case 'storage_failure':
      return 500;
    default: {
      const exhaustive: never = error.code;
      throw new Error(`Unhandled server error: ${String(exhaustive)}`);
    }
  }
}

function isJsonContentType(value: string | undefined): boolean {
  return value !== undefined
    && /^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(value.trim());
}

function declaredLength(request: IncomingMessage): number | undefined {
  const value = request.headers['content-length'];
  if (value === undefined) {
    return undefined;
  }
  if (!/^\d+$/u.test(value)) {
    throw new HttpBoundaryError(400, 'invalid_output');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new HttpBoundaryError(400, 'invalid_output');
  }
  return parsed;
}

async function readBody(
  request: IncomingMessage,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const length = declaredLength(request);
  if (length !== undefined && length > maximumBytes) {
    request.resume();
    throw new HttpBoundaryError(413, 'invalid_output');
  }

  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;

    const cleanup = (): void => {
      request.removeListener('data', onData);
      request.removeListener('end', onEnd);
      request.removeListener('error', onError);
      request.removeListener('aborted', onAborted);
      signal.removeEventListener('abort', onTimeout);
    };
    const fail = (error: Error): void => {
      cleanup();
      request.resume();
      reject(error);
    };
    const onData = (chunk: Buffer): void => {
      bytes += chunk.length;
      if (bytes > maximumBytes) {
        fail(new HttpBoundaryError(413, 'invalid_output'));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const onError = (): void => {
      fail(new HttpBoundaryError(400, 'invalid_output'));
    };
    const onAborted = (): void => {
      fail(new HttpBoundaryError(400, 'invalid_output'));
    };
    const onTimeout = (): void => {
      fail(new HttpBoundaryError(504, 'timeout'));
    };

    if (signal.aborted) {
      onTimeout();
      return;
    }
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    request.once('aborted', onAborted);
    signal.addEventListener('abort', onTimeout, { once: true });
  });
}

function parseOperationRequest(body: Buffer, operation: Operation): z.infer<typeof operationRequestSchema> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw new HttpBoundaryError(400, 'invalid_output');
  }
  const parsed = operationRequestSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.context.operation !== operation) {
    throw new HttpBoundaryError(400, 'invalid_output');
  }
  return parsed.data;
}

function validatePreflight(request: IncomingMessage): void {
  if (request.headers['access-control-request-method'] !== 'POST') {
    throw new HttpBoundaryError(400, 'invalid_output');
  }
  const requestedHeaders = request.headers['access-control-request-headers'];
  if (requestedHeaders === undefined) {
    return;
  }
  const normalized = requestedHeaders
    .split(',')
    .map((header) => header.trim().toLocaleLowerCase('en-US'))
    .filter(Boolean);
  if (normalized.some((header) => header !== 'content-type')) {
    throw new HttpBoundaryError(400, 'invalid_output');
  }
}

function rateLimitKey(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? 'unknown';
}

function sendOperationResult(response: ServerResponse, result: OperationServiceResult): void {
  if (result.ok) {
    sendJson(response, 200, result);
    return;
  }
  sendJson(response, statusForServiceError(result.error), result);
}

export function createHttpServer(options: HttpServerOptions): Server {
  const limiter = options.rateLimiter ?? createRateLimiter({
    windowMs: options.config.rateLimitWindowMs,
    maximum: options.config.rateLimitMax,
  });

  const handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    applySecurityHeaders(response);
    const id = requestId();
    response.setHeader('X-Request-Id', id);
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, options.config.requestTimeoutMs);
    request.once('aborted', () => {
      abortController.abort();
    });

    try {
      applyAllowedOrigin(request, response, options.config.allowedOrigins);
      if (request.url === undefined) {
        throw new HttpBoundaryError(400, 'invalid_output');
      }

      const operation = operationForPath(request.url);
      if (operation !== undefined) {
        if (request.method === 'OPTIONS') {
          validatePreflight(request);
          response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          response.setHeader('Access-Control-Allow-Headers', 'content-type');
          response.writeHead(204);
          response.end();
          return;
        }
        if (request.method !== 'POST') {
          response.setHeader('Allow', 'POST, OPTIONS');
          throw new HttpBoundaryError(405, 'invalid_output');
        }
        if (!isJsonContentType(request.headers['content-type'])) {
          throw new HttpBoundaryError(415, 'invalid_output');
        }

        const decision = limiter.consume(rateLimitKey(request));
        if (!decision.allowed) {
          response.setHeader('Retry-After', String(decision.retryAfterSeconds));
          throw new HttpBoundaryError(429, 'rate_limited');
        }

        const body = await readBody(request, options.config.requestBytes, abortController.signal);
        const parsed = parseOperationRequest(body, operation);
        const result = await options.service.execute({
          operation,
          context: parsed.context,
          requestId: id,
          signal: abortController.signal,
        });
        sendOperationResult(response, result);
        return;
      }

      if (request.url === '/healthz' || request.url === '/readyz') {
        if (request.method !== 'GET') {
          response.setHeader('Allow', 'GET');
          throw new HttpBoundaryError(405, 'invalid_output');
        }
        if (request.url === '/healthz') {
          sendJson(response, 200, { ok: true, value: { status: 'healthy' } });
          return;
        }
        if (!options.service.isReady()) {
          sendError(response, 503, 'provider_unavailable', id);
          return;
        }
        sendJson(response, 200, { ok: true, value: { status: 'ready' } });
        return;
      }

      throw new HttpBoundaryError(404, 'invalid_output');
    } catch (error) {
      if (error instanceof HttpBoundaryError) {
        sendError(response, error.status, error.code, id);
      } else if (abortController.signal.aborted) {
        sendError(response, 504, 'timeout', id);
      } else {
        sendError(response, 500, 'provider_unavailable', id);
      }
    } finally {
      clearTimeout(timeout);
    }
  };

  return createServer((request, response) => {
    void handleRequest(request, response);
  });
}
