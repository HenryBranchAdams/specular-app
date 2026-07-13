import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import {
  request as createNativeRequest,
  type IncomingHttpHeaders,
  type Server,
} from 'node:http';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Operation, ThreadContext } from '../src/domain/contracts';
import type OpenAI from 'openai';
import {
  specularErrorSchema,
  threadContextSchema,
  threadUnderstandingSchema,
} from '../src/domain/schemas';
import {
  validateOperationResponse,
  validateOperationResult,
} from '../src/domain/validators';
import {
  loadServerConfig,
  type ServerConfig,
} from './config';
import { createHttpServer } from './http';
import {
  createOpenAIQuestioningProvider,
  type OpenAIResponsesClient,
} from './openai-provider';
import {
  createOperationService,
  ProviderRequestError,
  type ProviderAttempt,
  type ProviderRepairRequest,
  type ProviderRequest,
  type RepairingQuestioningProvider,
} from './operation-service';
import { createRateLimiter } from './rate-limit';
import type { MetadataSink, ServerTelemetryEvent } from './telemetry';

const successEnvelopeSchema = z.object({
  ok: z.literal(true),
  value: z.unknown(),
}).strict();

const failureEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: specularErrorSchema,
}).strict();

const UNDERSTANDING = threadUnderstandingSchema.parse({
  claims: [],
  observations: [],
  stakeholders: [],
  contexts: [],
  distinctions: [],
  tensions: [],
  exploredBlindSpots: [],
  unexploredBlindSpots: [],
});

const VALID_NEXT_QUESTION = {
  kind: 'question',
  question: 'Which constraint would change the launch decision most?',
  understanding: UNDERSTANDING,
} as const;

function questionWithWordCount(count: number): string {
  return [
    ...Array.from({ length: count - 1 }, () => 'word'),
    'boundary?',
  ].join(' ');
}

const VALID_NEXT_QUESTION_AT_LIMIT = {
  ...VALID_NEXT_QUESTION,
  question: questionWithWordCount(28),
} as const;

const VALID_CHALLENGE = {
  kind: 'blind_spot',
  question: 'Which stakeholder bears the greatest cost if the launch misses its timing?',
} as const;

const CONCLUSION_SOURCE = [
  'A smaller reversible launch best preserves learning.',
  'Coordination is the immediate constraint.',
  'Reversibility protects the learning loop.',
  'The first cohort can expose the decision boundary.',
  'Prior launches stalled during handoff.',
  'Speed may reduce stakeholder confidence.',
  'The thread contains no customer interview evidence.',
].join(' ');

const VALID_CONCLUSION = {
  kind: 'working_conclusion',
  thesis: 'A smaller reversible launch best preserves learning.',
  insights: [
    'Coordination is the immediate constraint.',
    'Reversibility protects the learning loop.',
    'The first cohort can expose the decision boundary.',
  ],
  observations: ['Prior launches stalled during handoff.'],
  tensions: ['Speed may reduce stakeholder confidence.'],
  caveats: ['The thread contains no customer interview evidence.'],
  provenance: [
    { turnId: 'turn-1', excerpt: 'A smaller reversible launch best preserves learning.' },
    { turnId: 'turn-1', excerpt: 'Coordination is the immediate constraint.' },
    { turnId: 'turn-1', excerpt: 'Reversibility protects the learning loop.' },
    { turnId: 'turn-1', excerpt: 'The first cohort can expose the decision boundary.' },
    { turnId: 'turn-1', excerpt: 'Prior launches stalled during handoff.' },
    { turnId: 'turn-1', excerpt: 'Speed may reduce stakeholder confidence.' },
    { turnId: 'turn-1', excerpt: 'The thread contains no customer interview evidence.' },
  ],
} as const;

interface NativeHttpResponse {
  body: unknown;
  headers: IncomingHttpHeaders;
  rawBody: string;
  status: number;
}

interface NativeRequestOptions {
  body?: string;
  headers?: Record<string, string>;
  method?: string;
  path: string;
}

type GenerateStep =
  | ProviderAttempt
  | Error
  | ((request: ProviderRequest) => ProviderAttempt | Promise<ProviderAttempt>);

type RepairStep =
  | ProviderAttempt
  | Error
  | ((request: ProviderRepairRequest) => ProviderAttempt | Promise<ProviderAttempt>);

type OpenAIResponseStep =
  | OpenAI.Responses.Response
  | ((
    body: OpenAI.Responses.ResponseCreateParamsNonStreaming,
    options: { signal: AbortSignal },
  ) => OpenAI.Responses.Response | Promise<OpenAI.Responses.Response>);

class ScriptedOpenAIResponsesClient implements OpenAIResponsesClient {
  readonly responses: OpenAIResponsesClient['responses'];
  private readonly steps: OpenAIResponseStep[];

  constructor(steps: OpenAIResponseStep[]) {
    this.steps = [...steps];
    this.responses = {
      create: async (body, options) => {
        const step = this.steps.shift();
        if (step === undefined) {
          throw new Error('Unexpected OpenAI Responses call.');
        }
        return typeof step === 'function' ? await step(body, options) : step;
      },
    };
  }
}

class ScriptedRepairingProvider implements RepairingQuestioningProvider {
  readonly configured: boolean;
  readonly modelId = 'scripted-model';
  readonly providerId = 'scripted';
  generateCalls = 0;
  repairCalls = 0;
  private readonly generateSteps: GenerateStep[];
  private readonly repairSteps: RepairStep[];

  constructor(options: {
    configured?: boolean;
    generate?: GenerateStep[];
    repair?: RepairStep[];
  } = {}) {
    this.configured = options.configured ?? true;
    this.generateSteps = [...(options.generate ?? [])];
    this.repairSteps = [...(options.repair ?? [])];
  }

  async generate(request: ProviderRequest): Promise<ProviderAttempt> {
    this.generateCalls += 1;
    const step = this.generateSteps.shift();
    if (step === undefined) {
      throw new Error('Unexpected provider generation call.');
    }
    if (step instanceof Error) {
      throw step;
    }
    return typeof step === 'function' ? await step(request) : step;
  }

  async repair(request: ProviderRepairRequest): Promise<ProviderAttempt> {
    this.repairCalls += 1;
    const step = this.repairSteps.shift();
    if (step === undefined) {
      throw new Error('Unexpected provider repair call.');
    }
    if (step instanceof Error) {
      throw step;
    }
    return typeof step === 'function' ? await step(request) : step;
  }
}

class CapturingMetadataSink implements MetadataSink {
  readonly events: ServerTelemetryEvent[] = [];

  record(event: ServerTelemetryEvent): void {
    this.events.push(structuredClone(event));
  }
}

const openServers: Server[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  const servers = openServers.splice(0);
  await Promise.all(servers.map(async (server) => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }));
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await rm(directory, { force: true, recursive: true });
  }));
});

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    nodeEnv: 'test',
    port: 0,
    allowedOrigins: ['https://specular.test'],
    openAiModel: 'gpt-5.5',
    requestTimeoutMs: 500,
    requestBytes: 64 * 1024,
    rateLimitWindowMs: 60_000,
    rateLimitMax: 100,
    enableRealtime: false,
    crisisRegion: 'US',
    ...overrides,
  };
}

function context(
  operation: Operation,
  content = 'The handoff is where the launch gets stuck.',
  acceptedUserTurnCount = 1,
): ThreadContext {
  return threadContextSchema.parse({
    thread: { id: 'thread-1' },
    turns: Array.from({ length: acceptedUserTurnCount }, (_, position) => ({
      id: `turn-${String(position + 1)}`,
      ownerScope: 'local',
      threadId: 'thread-1',
      role: 'user',
      content: position === 0
        ? content
        : 'A second accepted user-authored detail makes gathering eligible.',
      modality: 'text',
      createdAt: position + 1,
      position,
      deliveryState: 'accepted',
    })),
    understanding: UNDERSTANDING,
    operation,
  });
}

function attempt(value: unknown): ProviderAttempt {
  return {
    value,
    repairInput: { kind: 'structured', value },
    tokenUsage: {
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
    },
  };
}

function sdkResponse(
  status: OpenAI.Responses.ResponseStatus,
  overrides: Partial<OpenAI.Responses.Response> = {},
): OpenAI.Responses.Response {
  return {
    id: 'response-1',
    created_at: 1,
    output_text: '',
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: 'gpt-5.5',
    object: 'response',
    output: [],
    parallel_tool_calls: false,
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
    status,
    ...overrides,
  };
}

function pathFor(operation: Operation): string {
  switch (operation) {
    case 'next_question':
      return '/api/operations/next-question';
    case 'challenge':
      return '/api/operations/challenge';
    case 'conclusion':
      return '/api/operations/conclusion';
    default: {
      const exhaustive: never = operation;
      throw new Error(`Unhandled operation: ${String(exhaustive)}`);
    }
  }
}

async function startServer(options: {
  config?: ServerConfig;
  provider: RepairingQuestioningProvider;
  staticRoot?: string;
  telemetry?: CapturingMetadataSink;
}): Promise<{ config: ServerConfig; server: Server; telemetry: CapturingMetadataSink }> {
  const serverConfig = options.config ?? config();
  const telemetry = options.telemetry ?? new CapturingMetadataSink();
  const service = createOperationService({
    provider: options.provider,
    telemetry,
    safetyRegion: serverConfig.crisisRegion,
  });
  const server = createHttpServer({
    config: serverConfig,
    service,
    ...(options.staticRoot === undefined ? {} : { staticRoot: options.staticRoot }),
  });
  openServers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { config: serverConfig, server, telemetry };
}

function serverPort(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected a TCP server address.');
  }
  return address.port;
}

async function nativeRequest(
  server: Server,
  options: NativeRequestOptions,
): Promise<NativeHttpResponse> {
  const body = options.body;
  const headers = {
    connection: 'close',
    ...(body === undefined ? {} : { 'content-length': String(Buffer.byteLength(body)) }),
    ...options.headers,
  };

  return await new Promise<NativeHttpResponse>((resolve, reject) => {
    const request = createNativeRequest({
      host: '127.0.0.1',
      port: serverPort(server),
      method: options.method ?? 'GET',
      path: options.path,
      headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      response.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        let parsedBody: unknown;
        try {
          parsedBody = rawBody.length === 0 ? undefined : JSON.parse(rawBody) as unknown;
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Could not decode HTTP response.'));
          return;
        }
        resolve({
          body: parsedBody,
          headers: response.headers,
          rawBody,
          status: response.statusCode ?? 0,
        });
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}

async function rawTargetRequest(server: Server, target: string): Promise<NativeHttpResponse> {
  const body = JSON.stringify({ context: context('next_question') });
  const requestHead = [
    `POST ${target} HTTP/1.1`,
    `Host: 127.0.0.1:${String(serverPort(server))}`,
    'Origin: https://specular.test',
    'Content-Type: application/json',
    `Content-Length: ${String(Buffer.byteLength(body))}`,
    'Connection: close',
    '',
    body,
  ].join('\r\n');

  return await new Promise<NativeHttpResponse>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: serverPort(server) });
    let rawResponse = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.end(requestHead);
    });
    socket.on('data', (chunk: string) => {
      rawResponse += chunk;
    });
    socket.on('error', reject);
    socket.on('end', () => {
      const separator = rawResponse.indexOf('\r\n\r\n');
      if (separator < 0) {
        reject(new Error('Raw HTTP response did not contain a header terminator.'));
        return;
      }
      const headerText = rawResponse.slice(0, separator);
      const rawBody = rawResponse.slice(separator + 4);
      const lines = headerText.split('\r\n');
      const status = Number(lines[0]?.split(' ')[1]);
      const headers: IncomingHttpHeaders = {};
      for (const line of lines.slice(1)) {
        const colon = line.indexOf(':');
        if (colon > 0) {
          headers[line.slice(0, colon).toLocaleLowerCase('en-US')] = line.slice(colon + 1).trim();
        }
      }
      try {
        resolve({
          body: JSON.parse(rawBody) as unknown,
          headers,
          rawBody,
          status,
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Could not decode raw HTTP response.'));
      }
    });
  });
}

async function stalledBodyRequest(server: Server, timeoutMs = 2_000): Promise<NativeHttpResponse> {
  return await new Promise<NativeHttpResponse>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        request.destroy();
        reject(new Error('Timed out waiting for stalled-body response.'));
      }
    }, timeoutMs);
    const request = createNativeRequest({
      host: '127.0.0.1',
      port: serverPort(server),
      method: 'POST',
      path: '/api/operations/next-question',
      headers: {
        connection: 'close',
        'content-length': '5000',
        'content-type': 'application/json',
        origin: 'https://specular.test',
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        const rawBody = Buffer.concat(chunks).toString('utf8');
        request.destroy();
        resolve({
          body: JSON.parse(rawBody) as unknown,
          headers: response.headers,
          rawBody,
          status: response.statusCode ?? 0,
        });
      });
    });
    request.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
    request.write('{"context":');
  });
}

function operationRequest(
  operation: Operation,
  content?: string,
  acceptedUserTurnCount = 1,
): NativeRequestOptions {
  return {
    method: 'POST',
    path: pathFor(operation),
    headers: {
      'content-type': 'application/json',
      origin: 'https://specular.test',
    },
    body: JSON.stringify({ context: context(operation, content, acceptedUserTurnCount) }),
  };
}

function successValue(response: NativeHttpResponse): unknown {
  expect(response.status).toBe(200);
  return successEnvelopeSchema.parse(response.body).value;
}

function failure(response: NativeHttpResponse): z.infer<typeof failureEnvelopeSchema>['error'] {
  return failureEnvelopeSchema.parse(response.body).error;
}

describe('stateless model HTTP service', () => {
  it('serves static assets without applying the API origin allowlist', async () => {
    const staticRoot = await mkdtemp(join(tmpdir(), 'specular-static-'));
    temporaryDirectories.push(staticRoot);
    await writeFile(join(staticRoot, 'asset.json'), JSON.stringify({ asset: true }));
    const { server } = await startServer({
      config: config({ allowedOrigins: [] }),
      provider: new ScriptedRepairingProvider(),
      staticRoot,
    });
    const origin = `http://127.0.0.1:${String(serverPort(server))}`;

    const asset = await nativeRequest(server, {
      path: '/asset.json',
      headers: { origin },
    });
    expect(asset.status).toBe(200);
    expect(asset.body).toEqual({ asset: true });
    expect(asset.headers['access-control-allow-origin']).toBeUndefined();
    expect(asset.headers['content-security-policy']).toContain("default-src 'self'");

    const operation = await nativeRequest(server, {
      ...operationRequest('next_question'),
      headers: {
        'content-type': 'application/json',
        origin,
      },
    });
    expect(operation.status).toBe(403);
    expect(failure(operation).code).toBe('provider_unavailable');
  });

  it.each([
    ['next_question', VALID_NEXT_QUESTION],
    ['challenge', VALID_CHALLENGE],
    ['conclusion', VALID_CONCLUSION],
  ] as const)('returns the strict client success envelope for %s', async (operation, value) => {
    const { server } = await startServer({
      provider: new ScriptedRepairingProvider({ generate: [attempt(value)] }),
    });

    const response = await nativeRequest(
      server,
      operationRequest(
        operation,
        operation === 'conclusion' ? CONCLUSION_SOURCE : undefined,
        operation === 'conclusion' ? 2 : 1,
      ),
    );

    expect(response.body).toEqual({ ok: true, value });
    expect(validateOperationResult(operation, successValue(response))).toEqual(value);
  });

  it('rejects an ordinary one-turn conclusion before provider readiness or execution', async () => {
    const provider = new ScriptedRepairingProvider({ configured: false });
    const telemetry = new CapturingMetadataSink();
    const { server } = await startServer({ provider, telemetry });

    const response = await nativeRequest(
      server,
      operationRequest('conclusion', CONCLUSION_SOURCE),
    );

    expect(response.status).toBe(502);
    expect(failure(response)).toMatchObject({ code: 'invalid_output', retryable: true });
    expect(provider.generateCalls).toBe(0);
    expect(provider.repairCalls).toBe(0);
    expect(telemetry.events).toEqual([]);
  });

  it('rejects unknown request fields, invalid bounded context, and operation/path mismatch', async () => {
    const { server } = await startServer({
      provider: new ScriptedRepairingProvider(),
    });
    const validContext = context('next_question');
    const cases = [
      { context: validContext, extra: true },
      {
        context: {
          ...validContext,
          turns: [{ ...validContext.turns[0], content: 'x'.repeat(12_001) }],
        },
      },
      { context: context('challenge') },
    ];

    for (const body of cases) {
      const response = await nativeRequest(server, {
        ...operationRequest('next_question'),
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      expect(failure(response).code).toBe('invalid_output');
    }
  });

  it('rejects oversized bodies before JSON parsing', async () => {
    const { server } = await startServer({
      config: config({ requestBytes: 128 }),
      provider: new ScriptedRepairingProvider(),
    });

    const response = await nativeRequest(server, operationRequest('next_question'));

    expect(response.status).toBe(413);
    expect(failure(response).code).toBe('invalid_output');
  });

  it('uses an exact CORS allowlist and supports bounded preflight', async () => {
    const { server } = await startServer({
      provider: new ScriptedRepairingProvider({ generate: [attempt(VALID_NEXT_QUESTION)] }),
    });

    const preflight = await nativeRequest(server, {
      method: 'OPTIONS',
      path: '/api/operations/next-question',
      headers: {
        origin: 'https://specular.test',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('https://specular.test');
    expect(preflight.headers['access-control-allow-methods']).toBe('POST, OPTIONS');
    expect(preflight.headers['access-control-allow-headers']).toBe('content-type');

    const rejected = await nativeRequest(server, {
      ...operationRequest('next_question'),
      headers: {
        'content-type': 'application/json',
        origin: 'https://specular.test.evil',
      },
    });
    expect(rejected.status).toBe(403);
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
    expect(failure(rejected).code).toBe('provider_unavailable');
  });

  it('sets secure browser headers and never enables realtime implicitly', async () => {
    const { server } = await startServer({
      provider: new ScriptedRepairingProvider({ generate: [attempt(VALID_NEXT_QUESTION)] }),
    });

    const response = await nativeRequest(server, operationRequest('next_question'));

    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['permissions-policy']).toBe(
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );

    const realtime = await nativeRequest(server, {
      method: 'POST',
      path: '/api/realtime/session',
      headers: { 'content-type': 'application/json', origin: 'https://specular.test' },
      body: '{}',
    });
    expect(realtime.status).toBe(404);
  });

  it('rejects unsupported content types, methods, paths, and query-bearing operation URLs safely', async () => {
    const { server } = await startServer({ provider: new ScriptedRepairingProvider() });

    const wrongContentType = await nativeRequest(server, {
      ...operationRequest('next_question'),
      headers: { 'content-type': 'text/plain', origin: 'https://specular.test' },
    });
    expect(wrongContentType.status).toBe(415);
    expect(failure(wrongContentType).code).toBe('invalid_output');

    const wrongMethod = await nativeRequest(server, {
      method: 'GET',
      path: '/api/operations/next-question',
      headers: { origin: 'https://specular.test' },
    });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.allow).toBe('POST, OPTIONS');

    for (const path of ['/api/operations/missing', '/api/operations/next-question?other=true']) {
      const response = await nativeRequest(server, {
        method: 'POST',
        path,
        headers: { 'content-type': 'application/json', origin: 'https://specular.test' },
        body: '{}',
      });
      expect(response.status).toBe(404);
      expect(failure(response).code).toBe('invalid_output');
    }
  });

  it('enforces the in-memory rate limit before provider work', async () => {
    const { server } = await startServer({
      config: config({ rateLimitMax: 1 }),
      provider: new ScriptedRepairingProvider({ generate: [attempt(VALID_NEXT_QUESTION)] }),
    });

    expect((await nativeRequest(server, operationRequest('next_question'))).status).toBe(200);
    const limited = await nativeRequest(server, operationRequest('next_question'));
    expect(limited.status).toBe(429);
    expect(failure(limited).code).toBe('rate_limited');
  });

  it('times out a stalled request body within the whole-request deadline', async () => {
    const { server } = await startServer({
      config: config({ requestTimeoutMs: 50 }),
      provider: new ScriptedRepairingProvider(),
    });

    const response = await stalledBodyRequest(server);

    expect(response.status).toBe(504);
    expect(failure(response).code).toBe('timeout');
  });

  it('times out provider completion even when an injected provider ignores abort', async () => {
    const neverCompletes = (): Promise<ProviderAttempt> => new Promise(() => undefined);
    const { server } = await startServer({
      config: config({ requestTimeoutMs: 50 }),
      provider: new ScriptedRepairingProvider({ generate: [neverCompletes] }),
    });

    const response = await nativeRequest(server, operationRequest('next_question'));

    expect(response.status).toBe(504);
    expect(failure(response).code).toBe('timeout');
  });

  it('repairs one invalid result exactly once and records the stable outcome', async () => {
    const invalid = {
      ...VALID_NEXT_QUESTION,
      question: 'Why is the launch blocked?',
    };
    const telemetry = new CapturingMetadataSink();
    const { server } = await startServer({
      telemetry,
      provider: new ScriptedRepairingProvider({
        generate: [attempt(invalid)],
        repair: [attempt(VALID_NEXT_QUESTION)],
      }),
    });

    const response = await nativeRequest(server, operationRequest('next_question'));

    expect(successValue(response)).toEqual(VALID_NEXT_QUESTION);
    expect(telemetry.events).toHaveLength(1);
    expect(telemetry.events[0]).toMatchObject({
      operation: 'next_question',
      repairCount: 1,
      schemaOutcome: 'valid',
      status: 'success',
    });
  });

  it.each([
    {
      label: 'removed setup field',
      invalid: { ...VALID_NEXT_QUESTION, setup: 'Let us make the boundary concrete.' },
      validationCode: 'schema_invalid',
    },
    {
      label: '29-word question',
      invalid: { ...VALID_NEXT_QUESTION, question: questionWithWordCount(29) },
      validationCode: 'word_limit',
    },
  ] as const)('repairs a $label exactly once', async ({ invalid, validationCode }) => {
    const provider = new ScriptedRepairingProvider({
      generate: [attempt(invalid)],
      repair: [
        (request) => {
          expect(request.validationCodes).toEqual([validationCode]);
          return attempt(VALID_NEXT_QUESTION);
        },
      ],
    });
    const { server } = await startServer({ provider });

    const response = await nativeRequest(server, operationRequest('next_question'));

    expect(successValue(response)).toEqual(VALID_NEXT_QUESTION);
    expect(provider.generateCalls).toBe(1);
    expect(provider.repairCalls).toBe(1);
  });

  it('repairs a structurally valid conclusion that invents authored content', async () => {
    const invented = {
      ...VALID_CONCLUSION,
      thesis: 'The model recommends committing to the smaller launch.',
    };
    const telemetry = new CapturingMetadataSink();
    const provider = new ScriptedRepairingProvider({
      generate: [attempt(invented)],
      repair: [
        (request) => {
          expect(request.validationCodes).toEqual(['conclusion_authorship']);
          return attempt(VALID_CONCLUSION);
        },
      ],
    });
    const { server } = await startServer({ provider, telemetry });

    const response = await nativeRequest(
      server,
      operationRequest('conclusion', CONCLUSION_SOURCE, 2),
    );

    expect(successValue(response)).toEqual(VALID_CONCLUSION);
    expect(provider.generateCalls).toBe(1);
    expect(provider.repairCalls).toBe(1);
    expect(telemetry.events[0]).toMatchObject({
      operation: 'conclusion',
      repairCount: 1,
      schemaOutcome: 'valid',
      status: 'success',
    });
  });

  it('rejects a conclusion when the single repair still invents authored content', async () => {
    const invented = {
      ...VALID_CONCLUSION,
      thesis: 'The model recommends committing to the smaller launch.',
    };
    const provider = new ScriptedRepairingProvider({
      generate: [attempt(invented)],
      repair: [attempt({
        ...VALID_CONCLUSION,
        insights: [
          'Coordination is the immediate constraint.',
          'The model adds an unstated rationale.',
          'The first cohort can expose the decision boundary.',
        ],
      })],
    });
    const { server } = await startServer({ provider });

    const response = await nativeRequest(
      server,
      operationRequest('conclusion', CONCLUSION_SOURCE, 2),
    );

    expect(response.status).toBe(502);
    expect(failure(response)).toMatchObject({ code: 'invalid_output', retryable: true });
    expect(provider.generateCalls).toBe(1);
    expect(provider.repairCalls).toBe(1);
  });

  it('does not repair a valid 28-word output', async () => {
    const telemetry = new CapturingMetadataSink();
    const provider = new ScriptedRepairingProvider({
      generate: [attempt(VALID_NEXT_QUESTION_AT_LIMIT)],
      repair: [new Error('Valid output must not be repaired.')],
    });
    const { server } = await startServer({
      telemetry,
      provider,
    });

    const response = await nativeRequest(server, operationRequest('next_question'));

    expect(successValue(response)).toEqual(VALID_NEXT_QUESTION_AT_LIMIT);
    expect(provider.generateCalls).toBe(1);
    expect(provider.repairCalls).toBe(0);
    expect(telemetry.events[0]).toMatchObject({ repairCount: 0, schemaOutcome: 'valid' });
  });

  it('returns typed invalid_output after the single repair is also invalid', async () => {
    const rawSecret = 'RAW_PROVIDER_OUTPUT_MUST_NOT_ESCAPE';
    const telemetry = new CapturingMetadataSink();
    const { server } = await startServer({
      telemetry,
      provider: new ScriptedRepairingProvider({
        generate: [{
          value: undefined,
          repairInput: { kind: 'text', value: rawSecret },
          tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        }],
        repair: [attempt({ ...VALID_NEXT_QUESTION, question: 'Why try again?' })],
      }),
    });

    const response = await nativeRequest(server, operationRequest('next_question'));

    expect(response.status).toBe(502);
    expect(failure(response)).toMatchObject({ code: 'invalid_output', retryable: true });
    expect(response.rawBody).not.toContain(rawSecret);
    expect(JSON.stringify(telemetry.events)).not.toContain(rawSecret);
    expect(telemetry.events[0]).toMatchObject({
      errorCode: 'invalid_output',
      repairCount: 1,
      schemaOutcome: 'invalid',
      status: 'error',
    });
  });

  it.each([
    ['timeout', 'timeout', 504],
    ['unavailable', 'provider_unavailable', 503],
    ['refusal', 'provider_unavailable', 503],
    ['incomplete', 'provider_unavailable', 503],
  ] as const)('maps provider %s to a typed recoverable %s envelope', async (
    providerCode,
    expectedCode,
    status,
  ) => {
    const { server } = await startServer({
      provider: new ScriptedRepairingProvider({
        generate: [new ProviderRequestError(providerCode)],
      }),
    });

    const response = await nativeRequest(server, operationRequest('next_question'));

    expect(response.status).toBe(status);
    expect(failure(response)).toMatchObject({ code: expectedCode, retryable: true });
  });

  it('returns provider_unavailable in production without an API key and makes no live call', async () => {
    const productionConfig = loadServerConfig({
      NODE_ENV: 'production',
      PORT: '0',
      ALLOWED_ORIGINS: 'https://specular.test',
    });
    const provider = createOpenAIQuestioningProvider({
      apiKey: productionConfig.openAiApiKey,
      model: productionConfig.openAiModel,
    });
    const { server } = await startServer({ config: productionConfig, provider });

    const response = await nativeRequest(server, operationRequest('next_question'));

    expect(response.status).toBe(503);
    expect(failure(response).code).toBe('provider_unavailable');
  });

  it('keeps health non-billable and makes readiness reflect provider configuration', async () => {
    const unavailable = await startServer({
      provider: new ScriptedRepairingProvider({ configured: false }),
    });
    const health = await nativeRequest(unavailable.server, { path: '/healthz' });
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ ok: true, value: { status: 'healthy' } });

    const notReady = await nativeRequest(unavailable.server, { path: '/readyz' });
    expect(notReady.status).toBe(503);
    expect(failure(notReady).code).toBe('provider_unavailable');

    const available = await startServer({
      provider: new ScriptedRepairingProvider({ configured: true }),
    });
    const ready = await nativeRequest(available.server, { path: '/readyz' });
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ ok: true, value: { status: 'ready' } });
  });

  it('emits only the fixed privacy-safe metadata fields and a non-authored safety identifier', async () => {
    const authoredSecret = 'MY_PRIVATE_UNREPEATABLE_THOUGHT';
    const telemetry = new CapturingMetadataSink();
    const provider = new ScriptedRepairingProvider({
      generate: [
        (request) => {
          if (!/^[a-f0-9]{64}$/u.test(request.safetyIdentifier)) {
            throw new Error('Safety identifier must be a SHA-256-style pseudonym.');
          }
          if (request.safetyIdentifier.includes(authoredSecret)) {
            throw new Error('Safety identifier included authored content.');
          }
          return attempt(VALID_NEXT_QUESTION);
        },
      ],
    });
    const { server } = await startServer({ telemetry, provider });

    const response = await nativeRequest(
      server,
      operationRequest('next_question', authoredSecret),
    );

    expect(response.status).toBe(200);
    expect(JSON.stringify(telemetry.events)).not.toContain(authoredSecret);
    expect(Object.keys(telemetry.events[0] ?? {}).sort()).toEqual([
      'latencyMs',
      'modelId',
      'operation',
      'providerId',
      'repairCount',
      'requestId',
      'schemaOutcome',
      'status',
      'tokenUsage',
    ]);
    expect(telemetry.events[0]?.tokenUsage).toEqual({
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
    });
  });

  it.each(['next_question', 'challenge', 'conclusion'] as const)(
    'uses immediate safety before ordinary conclusion eligibility for %s without provider work',
    async (operation) => {
      const provider = new ScriptedRepairingProvider();
      const telemetry = new CapturingMetadataSink();
      const { server } = await startServer({
        config: config({ crisisRegion: 'GB' }),
        provider,
        telemetry,
      });

      const response = await nativeRequest(
        server,
        operationRequest(operation, 'I am going to kill myself tonight and I have the means ready.'),
      );
      const value = successValue(response);
      expect(validateOperationResponse(operation, value)).toEqual(value);
      expect(value).toMatchObject({ kind: 'immediate_safety' });
      const serialized = JSON.stringify(value);
      expect(serialized).toContain('999 or 112');
      expect(serialized).toContain('116 123');
      expect(serialized.match(/[?？]/gu)).toHaveLength(1);
      expect(serialized).not.toMatch(/\bwhy\b/iu);
      expect(serialized).not.toContain('working_conclusion');
      expect(serialized).not.toContain('provenance');
      expect(provider.generateCalls).toBe(0);
      expect(provider.repairCalls).toBe(0);
      expect(telemetry.events).toHaveLength(1);
      expect(JSON.stringify(telemetry.events)).not.toContain(
        'I am going to kill myself tonight and I have the means ready.',
      );
    },
  );

  it.each(['AU', 'CA', 'EU', 'GB', 'US', 'other'] as const)(
    'returns a valid immediate-safety next question for configured region %s',
    async (crisisRegion) => {
      const { server } = await startServer({
        config: config({ crisisRegion }),
        provider: new ScriptedRepairingProvider(),
      });

      const response = await nativeRequest(
        server,
        operationRequest('next_question', 'I am going to kill myself tonight.'),
      );

      expect(validateOperationResponse('next_question', successValue(response))).toMatchObject({
        kind: 'immediate_safety',
      });
    },
  );

  it.each([
    'I am going to commit suicide tonight.',
    'I have pills and I am going to take them all tonight.',
    'I am suicidal, have a gun, and intend to use it tonight.',
  ])('routes high-confidence immediate danger without provider work: %s', async (content) => {
    const { server } = await startServer({
      provider: new ScriptedRepairingProvider(),
    });

    const response = await nativeRequest(
      server,
      operationRequest('next_question', content),
    );

    expect(response.status).toBe(200);
    expect(validateOperationResponse('next_question', successValue(response))).toMatchObject({
      kind: 'immediate_safety',
    });
  });

  it.each([
    "I'm going to kill myself tonight.",
    'I’m going to kill myself tonight.',
    "I have pills and I'm about to take them all tonight.",
  ])('routes exact contraction and imminent-means safety text locally: %s', async (content) => {
    const provider = new ScriptedRepairingProvider();
    const telemetry = new CapturingMetadataSink();
    const { server } = await startServer({ provider, telemetry });

    const response = await nativeRequest(
      server,
      operationRequest('next_question', content),
    );

    expect(response.status).toBe(200);
    expect(validateOperationResponse('next_question', successValue(response))).toMatchObject({
      kind: 'immediate_safety',
    });
    expect(provider.generateCalls).toBe(0);
    expect(provider.repairCalls).toBe(0);
    expect(telemetry.events).toHaveLength(1);
  });

  it('keeps the laughing idiom on the ordinary provider path', async () => {
    const provider = new ScriptedRepairingProvider({
      generate: [attempt(VALID_NEXT_QUESTION)],
    });
    const telemetry = new CapturingMetadataSink();
    const { server } = await startServer({ provider, telemetry });

    const response = await nativeRequest(
      server,
      operationRequest('next_question', 'I am going to kill myself laughing tonight.'),
    );

    expect(successValue(response)).toEqual(VALID_NEXT_QUESTION);
    expect(provider.generateCalls).toBe(1);
    expect(provider.repairCalls).toBe(0);
    expect(telemetry.events).toHaveLength(1);
  });

  it.each([
    'I am about to tell my therapist that I used to hurt myself.',
    'I will not hurt myself today.',
  ])('keeps non-immediate self-harm references in normal reflective flow: %s', async (content) => {
    const { server } = await startServer({
      provider: new ScriptedRepairingProvider({ generate: [attempt(VALID_NEXT_QUESTION)] }),
    });

    const response = await nativeRequest(
      server,
      operationRequest('next_question', content),
    );

    expect(successValue(response)).toEqual(VALID_NEXT_QUESTION);
  });

  it('keeps ordinary emotionally charged content in the reflective provider flow', async () => {
    const providerValue = {
      ...VALID_NEXT_QUESTION,
      question: 'Which part of the decision feels most painful to leave unresolved?',
    };
    const { server } = await startServer({
      provider: new ScriptedRepairingProvider({ generate: [attempt(providerValue)] }),
    });

    const response = await nativeRequest(
      server,
      operationRequest(
        'next_question',
        'I am devastated by this choice and I hate how trapped the decision makes me feel.',
      ),
    );

    expect(successValue(response)).toEqual(providerValue);
  });

  it.each([
    '/api/operations/challenge/../next-question',
    '//example.invalid/api/operations/next-question',
    '/api/operations/challenge\\..\\next-question',
    '/api/operations/challenge/%2e%2e/next-question',
    '/api/operations/challenge%2f..%2fnext-question',
    '/api/operations/challenge%5c..%5cnext-question',
    '/api/operations/%6eext-question',
    'http://example.invalid/api/operations/next-question',
  ])('rejects noncanonical raw request target without operation side effects: %s', async (target) => {
    const provider = new ScriptedRepairingProvider({
      generate: [attempt(VALID_NEXT_QUESTION)],
    });
    const telemetry = new CapturingMetadataSink();
    const { server } = await startServer({ provider, telemetry });

    const response = await rawTargetRequest(server, target);

    expect(response.status).toBe(404);
    expect(failure(response).code).toBe('invalid_output');
    expect(provider.generateCalls).toBe(0);
    expect(provider.repairCalls).toBe(0);
    expect(telemetry.events).toHaveLength(0);
  });
});

describe('server configuration', () => {
  it('uses loopback-only local defaults and explicit production binding', () => {
    const development = loadServerConfig({ NODE_ENV: 'development' });
    expect(development.allowedOrigins).toEqual([
      'http://localhost:5177',
      'http://127.0.0.1:5177',
    ]);
    expect(development.host).toBe('127.0.0.1');

    const production = loadServerConfig({ NODE_ENV: 'production' });
    expect(production.allowedOrigins).toEqual([]);
    expect(production.host).toBe('0.0.0.0');

    expect(loadServerConfig({ NODE_ENV: 'development', HOST: '0.0.0.0' }).host)
      .toBe('0.0.0.0');
    expect(() => loadServerConfig({ HOST: 'localhost' })).toThrow(/HOST/u);
  });

  it('defaults to OpenAI SDK model gpt-5.5 and parses bounded server settings once', () => {
    const parsed = loadServerConfig({
      NODE_ENV: 'test',
      ALLOWED_ORIGINS: 'https://one.test, https://two.test',
      REQUEST_TIMEOUT_MS: '1200',
      REQUEST_BYTES: '2048',
      RATE_LIMIT_WINDOW_MS: '60000',
      RATE_LIMIT_MAX: '9',
      ENABLE_REALTIME: 'false',
      CRISIS_REGION: 'CA',
    });

    expect(parsed).toMatchObject({
      openAiModel: 'gpt-5.5',
      allowedOrigins: ['https://one.test', 'https://two.test'],
      requestTimeoutMs: 1200,
      requestBytes: 2048,
      rateLimitWindowMs: 60_000,
      rateLimitMax: 9,
      enableRealtime: false,
      crisisRegion: 'CA',
    });
    expect(parsed.openAiApiKey).toBeUndefined();
  });

  it('rejects wildcard or path-bearing allowed origins', () => {
    expect(() => loadServerConfig({
      NODE_ENV: 'production',
      ALLOWED_ORIGINS: '*',
    })).toThrow(/origin/iu);
    expect(() => loadServerConfig({
      NODE_ENV: 'production',
      ALLOWED_ORIGINS: 'https://specular.test/path',
    })).toThrow(/origin/iu);
  });
});

describe('OpenAI server adapter without live access', () => {
  it('uses a strict bounded non-stored Responses request through the injected SDK boundary', async () => {
    const provider = createOpenAIQuestioningProvider({
      apiKey: undefined,
      model: 'gpt-5.5',
      client: new ScriptedOpenAIResponsesClient([
        (body, options) => {
          if (
            body.model !== 'gpt-5.5'
            || body.store !== false
            || body.max_output_tokens !== 1_200
            || body.safety_identifier !== 'a'.repeat(64)
            || body.text?.format?.type !== 'json_schema'
            || options.signal.aborted
          ) {
            throw new Error('OpenAI request did not preserve the bounded privacy contract.');
          }
          expect(JSON.stringify(body.text.format)).not.toContain('setup');
          return sdkResponse('completed', {
            output_text: JSON.stringify(VALID_NEXT_QUESTION),
          });
        },
      ]),
    });

    await expect(provider.generate({
      operation: 'next_question',
      context: context('next_question'),
      signal: new AbortController().signal,
      safetyIdentifier: 'a'.repeat(64),
    })).resolves.toMatchObject({ value: VALID_NEXT_QUESTION });
  });

  it('uses a root-object Challenge schema and maps the strict API shape to the shared union', async () => {
    const provider = createOpenAIQuestioningProvider({
      apiKey: undefined,
      model: 'gpt-5.5',
      client: new ScriptedOpenAIResponsesClient([
        sdkResponse('completed', {
          output_text: JSON.stringify({
            kind: 'blind_spot',
            question: VALID_CHALLENGE.question,
          }),
        }),
      ]),
    });

    await expect(provider.generate({
      operation: 'challenge',
      context: context('challenge'),
      signal: new AbortController().signal,
      safetyIdentifier: 'b'.repeat(64),
    })).resolves.toMatchObject({ value: VALID_CHALLENGE });
  });

  it('classifies empty completed SDK output as a typed null-output provider failure', async () => {
    const provider = createOpenAIQuestioningProvider({
      apiKey: undefined,
      model: 'gpt-5.5',
      client: new ScriptedOpenAIResponsesClient([sdkResponse('completed')]),
    });

    await expect(provider.generate({
      operation: 'next_question',
      context: context('next_question'),
      signal: new AbortController().signal,
      safetyIdentifier: 'c'.repeat(64),
    })).rejects.toMatchObject({ code: 'null_output' });
  });

  it.each([
    ['incomplete', 'incomplete'],
    ['failed', 'unavailable'],
    ['in_progress', 'unavailable'],
    ['cancelled', 'unavailable'],
    ['queued', 'unavailable'],
  ] as const)('maps SDK response status %s to typed provider failure %s', async (
    status,
    expectedCode,
  ) => {
    const provider = createOpenAIQuestioningProvider({
      apiKey: undefined,
      model: 'gpt-5.5',
      client: new ScriptedOpenAIResponsesClient([sdkResponse(status)]),
    });

    await expect(provider.generate({
      operation: 'next_question',
      context: context('next_question'),
      signal: new AbortController().signal,
      safetyIdentifier: 'a'.repeat(64),
    })).rejects.toMatchObject({ code: expectedCode });
  });
});

describe('bounded in-memory rate limiter', () => {
  it('evicts the oldest tracked address when the configured key bound is reached', () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      maximum: 1,
      maximumKeys: 2,
      now: () => 0,
    });

    expect(limiter.consume('address-a').allowed).toBe(true);
    expect(limiter.consume('address-b').allowed).toBe(true);
    expect(limiter.consume('address-c').allowed).toBe(true);
    expect(limiter.consume('address-a').allowed).toBe(true);
  });
});
