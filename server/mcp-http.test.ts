import { EventEmitter } from 'node:events';
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  Server,
  ServerResponse,
} from 'node:http';
import { Readable } from 'node:stream';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { describe, expect, it } from 'vitest';
import type { ServerConfig } from './config';
import { createHttpServer } from './http';
import { RecordingOperationService } from './mcp-test-harness';

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
    this.body = options.body === undefined ? undefined : Buffer.from(options.body);
    this.headers = {
      ...(options.body === undefined ? {} : { 'content-length': String(this.body?.byteLength ?? 0) }),
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
    requestTimeoutMs: 500,
    requestBytes: 64 * 1024,
    rateLimitWindowMs: 60_000,
    rateLimitMax: 100,
    enableRealtime: false,
    crisisRegion: 'US',
    ...overrides,
  };
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
  await completed;
  return response;
}

describe('native /mcp integration without sockets', () => {
  it('creates a fresh stateless SDK transport and MCP server for every accepted request', async () => {
    const transports: StreamableHTTPServerTransport[] = [];
    const parsedBodies: unknown[] = [];
    let serverCount = 0;
    let closeCount = 0;
    const httpServer = createHttpServer({
      config: testConfig(),
      service: new RecordingOperationService(),
      createMcpServer: () => {
        serverCount += 1;
        return {
          connect(transport: Transport): Promise<void> {
            const nodeTransport = transport as unknown as StreamableHTTPServerTransport;
            transports.push(nodeTransport);
            nodeTransport.handleRequest = (request, response, parsedBody) => {
              parsedBodies.push(parsedBody);
              const status = request.method === 'POST' ? 200 : 405;
              response.writeHead(status, { 'content-type': 'application/json' });
              response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
              return Promise.resolve();
            };
            return Promise.resolve();
          },
          close(): Promise<void> {
            closeCount += 1;
            return Promise.resolve();
          },
        };
      },
    });
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });

    const first = await dispatchNativeRequest(httpServer, {
      method: 'POST',
      url: '/mcp',
      headers: {
        origin: 'https://specular.test',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: payload,
    });
    const second = await dispatchNativeRequest(httpServer, {
      method: 'POST',
      url: '/mcp',
      headers: {
        origin: 'https://specular.test',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: payload,
    });
    const get = await dispatchNativeRequest(httpServer, {
      method: 'GET',
      url: '/mcp',
      headers: { origin: 'https://specular.test' },
    });
    const remove = await dispatchNativeRequest(httpServer, {
      method: 'DELETE',
      url: '/mcp',
      headers: { origin: 'https://specular.test' },
    });

    expect([first.statusCode, second.statusCode, get.statusCode, remove.statusCode]).toEqual([
      200,
      200,
      405,
      405,
    ]);
    expect(serverCount).toBe(4);
    expect(transports).toHaveLength(4);
    expect(new Set(transports).size).toBe(4);
    transports.forEach((transport) => {
      expect(transport).toBeInstanceOf(StreamableHTTPServerTransport);
      expect(transport.sessionId).toBeUndefined();
    });
    expect(parsedBodies.slice(0, 2)).toEqual([JSON.parse(payload), JSON.parse(payload)]);
    expect(parsedBodies.slice(2)).toEqual([undefined, undefined]);
    expect(first.getHeader('access-control-allow-origin')).toBe('https://specular.test');
    expect(first.getHeader('access-control-allow-origin')).not.toBe('*');
    expect(first.getHeader('content-security-policy')).toBeTypeOf('string');
    expect(first.getHeader('cache-control')).toBe('no-store');
    expect(first.getHeader('x-request-id')).toBeTypeOf('string');
    expect(closeCount).toBe(4);
  });

  it('handles allowlisted preflight while preserving origin and content boundaries', async () => {
    let serverCount = 0;
    const httpServer = createHttpServer({
      config: testConfig({ requestBytes: 128 }),
      service: new RecordingOperationService(),
      createMcpServer: () => {
        serverCount += 1;
        throw new Error('Rejected MCP requests must not construct a server.');
      },
    });
    const preflight = await dispatchNativeRequest(httpServer, {
      method: 'OPTIONS',
      url: '/mcp',
      headers: {
        origin: 'https://specular.test',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, accept, mcp-protocol-version',
      },
    });
    const forbidden = await dispatchNativeRequest(httpServer, {
      method: 'POST',
      url: '/mcp',
      headers: {
        origin: 'https://wrong.test',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    const oversized = await dispatchNativeRequest(httpServer, {
      method: 'POST',
      url: '/mcp',
      headers: {
        origin: 'https://specular.test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ value: 'x'.repeat(256) }),
    });

    expect(preflight.statusCode).toBe(204);
    expect(preflight.getHeader('access-control-allow-origin')).toBe('https://specular.test');
    expect(preflight.getHeader('access-control-allow-methods')).toBe('POST, GET, DELETE, OPTIONS');
    expect(preflight.getHeader('access-control-allow-headers')).toBe(
      'content-type, accept, mcp-protocol-version',
    );
    expect(forbidden.statusCode).toBe(403);
    expect(oversized.statusCode).toBe(413);
    expect(serverCount).toBe(0);
  });
});
