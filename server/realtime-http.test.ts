import { EventEmitter } from 'node:events';
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  Server,
  ServerResponse,
} from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { requestIdSchema } from '../src/domain/schemas';
import type { ServerConfig } from './config';
import { createHttpServer } from './http';
import type { OperationService } from './operation-service';
import type { RateLimiter } from './rate-limit';
import {
  CapturingRealtimeMetadataSink,
  EPHEMERAL_VALUE,
  LONG_LIVED_KEY,
  NOW_MS,
  NOW_SECONDS,
  RAW_PROVIDER_SECRET,
  ScriptedRealtimeProvider,
} from './realtime-test-harness';
import {
  createRealtimeCredentialService,
  type RealtimeCredential,
  type RealtimeCredentialRequest,
  type RealtimeCredentialService,
  type RealtimeCredentialServiceResult,
} from './realtime';

const operationService: OperationService = {
  isReady: () => true,
  execute: () => Promise.reject(new Error('Operation routes are not part of this test.')),
};

class RecordingRealtimeService implements RealtimeCredentialService {
  readonly calls: RealtimeCredentialRequest[] = [];
  readonly ready: boolean;
  private readonly result: RealtimeCredentialServiceResult;

  constructor(options: {
    ready?: boolean;
    result?: RealtimeCredentialServiceResult;
  } = {}) {
    this.ready = options.ready ?? true;
    this.result = options.result ?? {
      ok: true,
      value: { value: EPHEMERAL_VALUE, expiresAt: NOW_SECONDS + 60 },
    };
  }

  isReady(): boolean {
    return this.ready;
  }

  create(request: RealtimeCredentialRequest): Promise<RealtimeCredentialServiceResult> {
    this.calls.push(request);
    return Promise.resolve(this.result);
  }
}

class MemoryIncomingRequest extends Readable {
  readonly headers: IncomingHttpHeaders;
  readonly method: string;
  readonly socket = { remoteAddress: '127.0.0.1' };
  readonly url: string;
  private body: Buffer | undefined;

  constructor(options: {
    body?: string;
    headers?: IncomingHttpHeaders;
    method: string;
    url: string;
  }) {
    super();
    const body = options.body === undefined ? undefined : Buffer.from(options.body);
    this.body = body;
    this.headers = {
      ...(body === undefined ? {} : { 'content-length': String(body.byteLength) }),
      ...options.headers,
    };
    this.method = options.method;
    this.url = options.url;
  }

  override _read(): void {
    const body = this.body;
    this.body = undefined;
    if (body !== undefined) {
      this.push(body);
    }
    this.push(null);
  }
}

class MemoryServerResponse extends EventEmitter {
  readonly headers = new Map<string, string | number | readonly string[]>();
  body = '';
  destroyed = false;
  statusCode = 200;
  writableEnded = false;

  end(body?: string | Buffer): this {
    if (body !== undefined) {
      this.body += body.toString();
    }
    this.writableEnded = true;
    this.emit('finish');
    this.emit('close');
    return this;
  }

  getHeader(name: string): string | number | readonly string[] | undefined {
    return this.headers.get(name.toLocaleLowerCase('en-US'));
  }

  setHeader(name: string, value: string | number | readonly string[]): this {
    this.headers.set(name.toLocaleLowerCase('en-US'), value);
    return this;
  }

  writeHead(
    statusCode: number,
    headers?: Record<string, string | number | readonly string[]>,
  ): this {
    this.statusCode = statusCode;
    Object.entries(headers ?? {}).forEach(([name, value]) => {
      this.setHeader(name, value);
    });
    return this;
  }
}

function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    nodeEnv: 'test',
    port: 0,
    allowedOrigins: ['https://specular.test'],
    openAiModel: 'gpt-5.5',
    requestTimeoutMs: 100,
    requestBytes: 128,
    rateLimitWindowMs: 60_000,
    rateLimitMax: 100,
    enableRealtime: true,
    crisisRegion: 'US',
    realtimeModel: 'gpt-realtime',
    realtimeCredentialTtlSeconds: 60,
    ...overrides,
  };
}

function beginNativeRequest(
  server: Server,
  options: {
    body?: string;
    headers?: IncomingHttpHeaders;
    method: string;
    url: string;
  },
): {
  completed: Promise<void>;
  request: MemoryIncomingRequest;
  response: MemoryServerResponse;
} {
  const request = new MemoryIncomingRequest(options);
  const response = new MemoryServerResponse();
  const completed = new Promise<void>((resolve) => {
    response.once('finish', resolve);
  });
  server.emit(
    'request',
    request as unknown as IncomingMessage,
    response as unknown as ServerResponse,
  );
  return { completed, request, response };
}

async function dispatchNativeRequest(
  server: Server,
  options: {
    body?: string;
    headers?: IncomingHttpHeaders;
    method: string;
    url: string;
  },
): Promise<MemoryServerResponse> {
  const pending = beginNativeRequest(server, options);
  await pending.completed;
  return pending.response;
}

function realtimeRequest(overrides: {
  body?: string | undefined;
  headers?: IncomingHttpHeaders;
  method?: string;
} = {}) {
  return {
    method: overrides.method ?? 'POST',
    url: '/api/realtime/session',
    headers: {
      origin: 'https://specular.test',
      'content-type': 'application/json',
      ...overrides.headers,
    },
    body: overrides.body ?? '{}',
  };
}

function jsonBody(response: MemoryServerResponse): unknown {
  return JSON.parse(response.body) as unknown;
}

describe('POST /api/realtime/session without sockets', () => {
  it('returns 404 while disabled without constructing a credential', async () => {
    const realtimeService = new RecordingRealtimeService();
    const server = createHttpServer({
      config: testConfig({ enableRealtime: false }),
      service: operationService,
      realtimeService,
    });

    const response = await dispatchNativeRequest(server, realtimeRequest());

    expect(response.statusCode).toBe(404);
    expect(response.getHeader('cache-control')).toBe('no-store');
    expect(realtimeService.calls).toHaveLength(0);
    expect(JSON.stringify(jsonBody(response))).not.toContain(EPHEMERAL_VALUE);
  });

  it('returns only the normalized credential through the existing secure boundary', async () => {
    const realtimeService = new RecordingRealtimeService();
    const server = createHttpServer({
      config: testConfig(),
      service: operationService,
      realtimeService,
    });

    const response = await dispatchNativeRequest(server, realtimeRequest());

    expect(response.statusCode).toBe(200);
    expect(jsonBody(response)).toEqual({
      value: EPHEMERAL_VALUE,
      expiresAt: NOW_SECONDS + 60,
    });
    expect(response.getHeader('access-control-allow-origin')).toBe('https://specular.test');
    expect(response.getHeader('access-control-allow-origin')).not.toBe('*');
    expect(response.getHeader('cache-control')).toBe('no-store');
    expect(response.getHeader('content-security-policy')).toBeTypeOf('string');
    expect(response.getHeader('x-request-id')).toBeTypeOf('string');
    expect(realtimeService.calls).toHaveLength(1);
    expect(realtimeService.calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(requestIdSchema.safeParse(realtimeService.calls[0]?.requestId).success).toBe(true);
  });

  it('handles preflight without minting a credential', async () => {
    const realtimeService = new RecordingRealtimeService();
    const server = createHttpServer({
      config: testConfig(),
      service: operationService,
      realtimeService,
    });

    const response = await dispatchNativeRequest(server, realtimeRequest({
      method: 'OPTIONS',
      body: undefined,
      headers: {
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    }));

    expect(response.statusCode).toBe(204);
    expect(response.getHeader('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(response.getHeader('access-control-allow-headers')).toBe('content-type');
    expect(realtimeService.calls).toHaveLength(0);
  });

  it.each([
    ['method', realtimeRequest({ method: 'GET', body: undefined }), 405],
    ['content type', realtimeRequest({ headers: { 'content-type': 'text/plain' } }), 415],
    ['extra body field', realtimeRequest({ body: '{"extra":true}' }), 400],
    ['missing origin', realtimeRequest({ headers: { origin: undefined } }), 403],
    ['origin', realtimeRequest({ headers: { origin: 'https://wrong.test' } }), 403],
    ['request size', realtimeRequest({ body: JSON.stringify({ value: 'x'.repeat(256) }) }), 413],
  ])('rejects invalid %s before minting', async (_label, request, expectedStatus) => {
    const realtimeService = new RecordingRealtimeService();
    const server = createHttpServer({
      config: testConfig(),
      service: operationService,
      realtimeService,
    });

    const response = await dispatchNativeRequest(server, request);

    expect(response.statusCode).toBe(expectedStatus);
    expect(response.getHeader('cache-control')).toBe('no-store');
    expect(realtimeService.calls).toHaveLength(0);
  });

  it('enforces the shared rate limiter before minting', async () => {
    const realtimeService = new RecordingRealtimeService();
    const rateLimiter: RateLimiter = {
      consume: () => ({ allowed: false, retryAfterSeconds: 9 }),
    };
    const server = createHttpServer({
      config: testConfig(),
      rateLimiter,
      service: operationService,
      realtimeService,
    });

    const response = await dispatchNativeRequest(server, realtimeRequest());

    expect(response.statusCode).toBe(429);
    expect(response.getHeader('retry-after')).toBe('9');
    expect(realtimeService.calls).toHaveLength(0);
  });

  it('aborts a slow credential request at the whole-request timeout', async () => {
    let observedAbort = false;
    const provider = new ScriptedRealtimeProvider({
      respond: async (request) => await new Promise<RealtimeCredential>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          observedAbort = true;
          reject(new Error(RAW_PROVIDER_SECRET));
        }, { once: true });
      }),
    });
    const realtimeService = createRealtimeCredentialService({
      credentialTtlSeconds: 60,
      now: () => NOW_MS,
      provider,
      telemetry: new CapturingRealtimeMetadataSink(),
    });
    const server = createHttpServer({
      config: testConfig({ requestTimeoutMs: 25 }),
      service: operationService,
      realtimeService,
    });

    const response = await dispatchNativeRequest(server, realtimeRequest());

    expect(response.statusCode).toBe(504);
    expect(observedAbort).toBe(true);
    expect(JSON.stringify(jsonBody(response))).not.toContain(RAW_PROVIDER_SECRET);
  });

  it('propagates caller abort without exposing provider failures', async () => {
    let resolveStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    let observedAbort = false;
    const provider = new ScriptedRealtimeProvider({
      respond: async (request) => await new Promise<RealtimeCredential>((_resolve, reject) => {
        resolveStarted?.();
        request.signal.addEventListener('abort', () => {
          observedAbort = true;
          reject(new Error(`${RAW_PROVIDER_SECRET}:${LONG_LIVED_KEY}`));
        }, { once: true });
      }),
    });
    const realtimeService = createRealtimeCredentialService({
      credentialTtlSeconds: 60,
      now: () => NOW_MS,
      provider,
      telemetry: new CapturingRealtimeMetadataSink(),
    });
    const server = createHttpServer({
      config: testConfig({ requestTimeoutMs: 500 }),
      service: operationService,
      realtimeService,
    });
    const pending = beginNativeRequest(server, realtimeRequest());

    await started;
    pending.request.emit('aborted');
    await pending.completed;

    expect(pending.response.statusCode).toBe(504);
    expect(observedAbort).toBe(true);
    expect(pending.response.body).not.toContain(RAW_PROVIDER_SECRET);
    expect(pending.response.body).not.toContain(LONG_LIVED_KEY);
  });

  it('maps missing credentials and provider failures without leaking details', async () => {
    const missingService = createRealtimeCredentialService({
      credentialTtlSeconds: 60,
      now: () => NOW_MS,
      provider: new ScriptedRealtimeProvider({ configured: false }),
      telemetry: new CapturingRealtimeMetadataSink(),
    });
    const failingService = createRealtimeCredentialService({
      credentialTtlSeconds: 60,
      now: () => NOW_MS,
      provider: new ScriptedRealtimeProvider({
        respond: () => Promise.reject(new Error(`${RAW_PROVIDER_SECRET}:${LONG_LIVED_KEY}`)),
      }),
      telemetry: new CapturingRealtimeMetadataSink(),
    });
    const missingServer = createHttpServer({
      config: testConfig(),
      service: operationService,
      realtimeService: missingService,
    });
    const failingServer = createHttpServer({
      config: testConfig(),
      service: operationService,
      realtimeService: failingService,
    });

    const [missing, failing] = await Promise.all([
      dispatchNativeRequest(missingServer, realtimeRequest()),
      dispatchNativeRequest(failingServer, realtimeRequest()),
    ]);

    expect(missing.statusCode).toBe(503);
    expect(failing.statusCode).toBe(503);
    expect(missing.body).not.toContain(LONG_LIVED_KEY);
    expect(failing.body).not.toContain(LONG_LIVED_KEY);
    expect(failing.body).not.toContain(RAW_PROVIDER_SECRET);
  });

  it('keeps health and readiness bill-free', async () => {
    const realtimeService = new RecordingRealtimeService();
    const server = createHttpServer({
      config: testConfig(),
      service: operationService,
      realtimeService,
    });

    const [health, readiness] = await Promise.all([
      dispatchNativeRequest(server, { method: 'GET', url: '/healthz' }),
      dispatchNativeRequest(server, { method: 'GET', url: '/readyz' }),
    ]);

    expect(health.statusCode).toBe(200);
    expect(readiness.statusCode).toBe(200);
    expect(realtimeService.calls).toHaveLength(0);
  });
});
