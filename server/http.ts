import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { extname, resolve, sep } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
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
import type {
  RealtimeCredentialService,
  RealtimeCredentialServiceResult,
} from './realtime';

const operationRequestSchema = z.object({
  context: threadContextSchema,
}).strict();

const realtimeSessionRequestSchema = z.object({}).strict();

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

type HttpMcpServer = Pick<McpServer, 'close' | 'connect'>;

const STATELESS_MCP_TRANSPORT_OPTIONS = {
  sessionIdGenerator: undefined,
  enableJsonResponse: true,
} as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0];

interface HttpServerOptions {
  config: ServerConfig;
  service: OperationService;
  rateLimiter?: RateLimiter;
  createMcpServer?: () => HttpMcpServer;
  realtimeService?: RealtimeCredentialService;
  staticRoot?: string;
}

const STATIC_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
} as const;

const APP_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self' https://api.openai.com",
  "font-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
].join('; ');

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

async function trySendStatic(
  requestUrl: string,
  staticRoot: string,
  response: ServerResponse,
): Promise<boolean> {
  const parsed = new URL(requestUrl, 'http://specular.local');
  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    throw new HttpBoundaryError(400, 'invalid_output');
  }
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const relative = extname(requested) === '' ? 'index.html' : requested;
  const root = resolve(staticRoot);
  const filePath = resolve(root, relative);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    throw new HttpBoundaryError(404, 'invalid_output');
  }
  try {
    const content = await readFile(filePath);
    const extension = extname(filePath);
    response.setHeader('Content-Security-Policy', APP_CONTENT_SECURITY_POLICY);
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('content-type', STATIC_CONTENT_TYPES[extension] ?? 'application/octet-stream');
    response.setHeader(
      'Cache-Control',
      extension === '.html' || extension === '.webmanifest'
        ? 'no-cache'
        : 'public, max-age=31536000, immutable',
    );
    response.setHeader('content-length', content.byteLength);
    response.writeHead(200);
    response.end(content);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
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
    .flatMap((header) => {
      const value = header.trim().toLocaleLowerCase('en-US');
      return value.length === 0 ? [] : [value];
    });
  if (normalized.some((header) => header !== 'content-type')) {
    throw new HttpBoundaryError(400, 'invalid_output');
  }
}

function validateMcpPreflight(request: IncomingMessage): void {
  const requestedMethod = request.headers['access-control-request-method'];
  if (requestedMethod !== 'POST' && requestedMethod !== 'GET' && requestedMethod !== 'DELETE') {
    throw new HttpBoundaryError(400, 'invalid_output');
  }
  const requestedHeaders = request.headers['access-control-request-headers'];
  if (requestedHeaders === undefined) {
    return;
  }
  const allowedHeaders = new Set(['accept', 'content-type', 'mcp-protocol-version']);
  const normalized = requestedHeaders
    .split(',')
    .flatMap((header) => {
      const value = header.trim().toLocaleLowerCase('en-US');
      return value.length === 0 ? [] : [value];
    });
  if (normalized.some((header) => !allowedHeaders.has(header))) {
    throw new HttpBoundaryError(400, 'invalid_output');
  }
}

function parseMcpBody(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw new HttpBoundaryError(400, 'invalid_output');
  }
}

function parseRealtimeSessionRequest(body: Buffer): void {
  let decoded: unknown;
  try {
    decoded = JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw new HttpBoundaryError(400, 'invalid_output');
  }
  if (!realtimeSessionRequestSchema.safeParse(decoded).success) {
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

function sendRealtimeCredentialResult(
  response: ServerResponse,
  result: RealtimeCredentialServiceResult,
): void {
  if (result.ok) {
    sendJson(response, 200, result.value);
    return;
  }
  sendJson(response, statusForServiceError(result.error), result);
}

function enforceRateLimit(
  request: IncomingMessage,
  response: ServerResponse,
  limiter: RateLimiter,
): void {
  const decision = limiter.consume(rateLimitKey(request));
  if (!decision.allowed) {
    response.setHeader('Retry-After', String(decision.retryAfterSeconds));
    throw new HttpBoundaryError(429, 'rate_limited');
  }
}

async function closeMcpRequest(
  server: HttpMcpServer,
  transport: StreamableHTTPServerTransport,
): Promise<void> {
  await Promise.allSettled([transport.close(), server.close()]);
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
      if (request.url === undefined) {
        throw new HttpBoundaryError(400, 'invalid_output');
      }

      if (request.url === '/mcp' && options.createMcpServer !== undefined) {
        applyAllowedOrigin(request, response, options.config.allowedOrigins);
        if (request.method === 'OPTIONS') {
          validateMcpPreflight(request);
          response.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
          response.setHeader(
            'Access-Control-Allow-Headers',
            'content-type, accept, mcp-protocol-version',
          );
          response.writeHead(204);
          response.end();
          return;
        }
        if (request.method !== 'POST' && request.method !== 'GET' && request.method !== 'DELETE') {
          response.setHeader('Allow', 'POST, GET, DELETE, OPTIONS');
          throw new HttpBoundaryError(405, 'invalid_output');
        }
        if (request.method === 'POST' && !isJsonContentType(request.headers['content-type'])) {
          throw new HttpBoundaryError(415, 'invalid_output');
        }
        enforceRateLimit(request, response, limiter);

        const parsedBody = request.method === 'POST'
          ? parseMcpBody(await readBody(
            request,
            options.config.requestBytes,
            abortController.signal,
          ))
          : undefined;
        const mcpServer = options.createMcpServer();
        const transport = new StreamableHTTPServerTransport(STATELESS_MCP_TRANSPORT_OPTIONS);
        let closed = false;
        const close = async (): Promise<void> => {
          if (closed) {
            return;
          }
          closed = true;
          await closeMcpRequest(mcpServer, transport);
        };
        const closeWithoutBlocking = (): void => {
          void close();
        };
        response.once('close', closeWithoutBlocking);
        abortController.signal.addEventListener('abort', closeWithoutBlocking, { once: true });

        try {
          // SDK 1.29's Node transport and base Transport declarations disagree
          // under exactOptionalPropertyTypes even though this is the SDK's
          // documented runtime pairing.
          await mcpServer.connect(transport as unknown as Transport);
          await transport.handleRequest(request, response, parsedBody);
        } catch (error) {
          await close();
          throw error;
        } finally {
          abortController.signal.removeEventListener('abort', closeWithoutBlocking);
        }
        return;
      }

      if (request.url === '/api/realtime/session') {
        applyAllowedOrigin(request, response, options.config.allowedOrigins);
        if (request.headers.origin === undefined) {
          throw new HttpBoundaryError(403, 'provider_unavailable');
        }
        if (!options.config.enableRealtime) {
          throw new HttpBoundaryError(404, 'provider_unavailable');
        }
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
        enforceRateLimit(request, response, limiter);

        const body = await readBody(request, options.config.requestBytes, abortController.signal);
        parseRealtimeSessionRequest(body);
        if (options.realtimeService === undefined) {
          throw new HttpBoundaryError(503, 'provider_unavailable');
        }
        const result = await options.realtimeService.create({
          requestId: id,
          signal: abortController.signal,
        });
        sendRealtimeCredentialResult(response, result);
        return;
      }

      const operation = operationForPath(request.url);
      if (operation !== undefined) {
        applyAllowedOrigin(request, response, options.config.allowedOrigins);
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

        enforceRateLimit(request, response, limiter);

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
        if (
          !options.service.isReady()
          || (
            options.config.enableRealtime
            && options.realtimeService?.isReady() !== true
          )
        ) {
          sendError(response, 503, 'provider_unavailable', id);
          return;
        }
        sendJson(response, 200, { ok: true, value: { status: 'ready' } });
        return;
      }

      if (request.method === 'GET' && options.staticRoot !== undefined) {
        if (await trySendStatic(request.url, options.staticRoot, response)) {
          return;
        }
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
