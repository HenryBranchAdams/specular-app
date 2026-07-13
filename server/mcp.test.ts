import {
  CallToolResultSchema,
  type CallToolResult,
  type JSONRPCMessage,
} from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import { assertNever } from '../src/domain/contracts';
import type {
  OperationResult,
  OperationResponse,
  SpecularErrorCode,
} from '../src/domain/contracts';
import {
  MAX_CONTEXT_TURNS,
  requestIdSchema,
} from '../src/domain/schemas';
import {
  createServiceError,
  ProviderRequestError,
  type ProviderAttempt,
} from './operation-service';
import {
  EXPECTED_ANNOTATIONS,
  EXPECTED_TOOL_COPY,
  EXPECTED_TOOL_STATUS,
  IMMEDIATE_SAFETY,
  PRIVATE_SENTINEL,
  RESOURCE_URI,
  RecordingOperationService,
  ScriptedProvider,
  VALID_CONCLUSION,
  VALID_NEXT_QUESTION,
  WIDGET_HTML,
  attempt,
  call,
  closeMcpHarnesses,
  connectMcp,
  context,
  expectTextResult,
  type JsonSchema,
  operationForTool,
  resultForOperation,
  serviceWithProvider,
  type ToolName,
  typedError,
} from './mcp-test-harness';

afterEach(closeMcpHarnesses);

describe('createSpecularMcpServer descriptors and resource', () => {
  it('advertises explicit thread-scoped stateless instructions and exactly three bounded tools', async () => {
    const { client } = await connectMcp(new RecordingOperationService());
    const instructions = client.getInstructions() ?? '';
    const openingInstructions = instructions.slice(0, 512).toLocaleLowerCase('en-US');

    expect(openingInstructions).toContain('explicit');
    expect(openingInstructions).toContain('thread-scoped');
    expect(openingInstructions).toContain('stateless');
    expect(openingInstructions).toContain('test this thread');
    expect(openingInstructions).toContain('gather this thread');
    expect(openingInstructions).toContain('exact user-authored excerpts');
    expect(openingInstructions).toContain('must not draft new content');
    expect(openingInstructions).toContain('opt-in');

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      'next_question',
      'challenge',
      'draft_conclusion',
    ]);

    listed.tools.forEach((tool) => {
      const name = tool.name as ToolName;
      expect(tool.title).toBe(EXPECTED_TOOL_COPY[name].title);
      expect(tool.description).toBe(EXPECTED_TOOL_COPY[name].description);
      expect(tool.annotations).toEqual(EXPECTED_ANNOTATIONS);
      expect(tool._meta).toMatchObject({
        ui: { resourceUri: RESOURCE_URI },
        'ui/resourceUri': RESOURCE_URI,
        'openai/outputTemplate': RESOURCE_URI,
        'openai/toolInvocation/invoking': EXPECTED_TOOL_STATUS[name].invoking,
        'openai/toolInvocation/invoked': EXPECTED_TOOL_STATUS[name].invoked,
      });

      const inputSchema = tool.inputSchema as JsonSchema;
      const contextSchema = inputSchema.properties?.context;
      expect(inputSchema.type).toBe('object');
      expect(inputSchema.additionalProperties).toBe(false);
      expect(inputSchema.required).toEqual(['context']);
      expect(contextSchema?.type).toBe('object');
      expect(contextSchema?.additionalProperties).toBe(false);
      expect(contextSchema?.required).toEqual(expect.arrayContaining([
        'thread',
        'turns',
        'understanding',
        'operation',
      ]));

      const serializedInput = JSON.stringify(inputSchema);
      expect(serializedInput).toContain(`"maxItems":${String(MAX_CONTEXT_TURNS)}`);
      expect(serializedInput).toContain('"maxLength":12000');
      expect(serializedInput).toContain('"additionalProperties":false');

      const serializedOutput = JSON.stringify(tool.outputSchema);
      expect(serializedOutput).toContain('immediate_safety');
      expect(serializedOutput).toContain('guidance');
      expect(serializedOutput).toContain('"additionalProperties":false');
      switch (name) {
        case 'next_question':
          expect(serializedOutput).toContain('question');
          expect(serializedOutput).toContain('understanding');
          break;
        case 'challenge':
          expect(serializedOutput).toContain('blind_spot');
          expect(serializedOutput).toContain('counter_position');
          break;
        case 'draft_conclusion':
          expect(serializedOutput).toContain('working_conclusion');
          expect(serializedOutput).toContain('provenance');
          break;
        default:
          assertNever(name);
      }
    });
  });

  it('advertises the three exact conditional Challenge output shapes', async () => {
    const { client } = await connectMcp(new RecordingOperationService());
    const listed = await client.listTools();
    const challenge = listed.tools.find((tool) => tool.name === 'challenge');
    const outputSchema = challenge?.outputSchema as JsonSchema | undefined;
    const branches = outputSchema?.oneOf as JsonSchema[] | undefined;

    expect(outputSchema?.type).toBe('object');
    expect(branches).toHaveLength(3);
    expect(branches?.map((branch) => ({
      additionalProperties: branch.additionalProperties,
      kind: branch.properties?.kind?.const,
      properties: Object.keys(branch.properties ?? {}).sort(),
      required: [...(branch.required ?? [])].sort(),
      type: branch.type,
    }))).toEqual([
      {
        additionalProperties: false,
        kind: 'blind_spot',
        properties: ['kind', 'question'],
        required: ['kind', 'question'],
        type: 'object',
      },
      {
        additionalProperties: false,
        kind: 'counter_position',
        properties: ['counterPosition', 'kind', 'question'],
        required: ['counterPosition', 'kind', 'question'],
        type: 'object',
      },
      {
        additionalProperties: false,
        kind: 'immediate_safety',
        properties: ['guidance', 'kind', 'question'],
        required: ['guidance', 'kind', 'question'],
        type: 'object',
      },
    ]);
  });

  it.each([
    {
      label: 'blind spot',
      valid: {
        kind: 'blind_spot',
        question: 'Which stakeholder carries a cost the current frame does not expose?',
      },
    },
    {
      label: 'counter-position',
      valid: {
        kind: 'counter_position',
        counterPosition: 'A smaller launch may protect learning better than a broad launch.',
        question: 'Which evidence would distinguish useful caution from avoidable delay?',
      },
    },
  ] as const)('accepts the exact $label shape through the real MCP output boundary', async ({ valid }) => {
    const service = new RecordingOperationService(() => ({ ok: true, value: valid }));
    const { client } = await connectMcp(service);
    const result = await call(client, 'challenge', context('challenge'));

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(valid);
    expectTextResult(result);
  });

  it.each([
    ['next_question', 'next_question'],
    ['challenge', 'challenge'],
    ['draft_conclusion', 'conclusion'],
  ] as const)(
    'accepts strict immediate safety through the real %s output boundary',
    async (tool, operation) => {
      const service = new RecordingOperationService(() => ({
        ok: true,
        value: IMMEDIATE_SAFETY,
      }));
      const { client } = await connectMcp(service);
      const result = await call(client, tool, context(operation));

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(IMMEDIATE_SAFETY);
      expectTextResult(result);
      expect(JSON.stringify(result.content)).toContain('Immediate support');
    },
  );

  it.each([
    ['next_question', 'next_question'],
    ['challenge', 'challenge'],
    ['draft_conclusion', 'conclusion'],
  ] as const)(
    'rejects unknown immediate-safety fields through the real %s output boundary',
    async (tool, operation) => {
      const service = new RecordingOperationService(() => ({
        ok: true,
        value: { ...IMMEDIATE_SAFETY, extra: 'rejected' } as unknown as OperationResponse,
      }));
      const { client } = await connectMcp(service);
      await client.listTools();
      const result = await call(client, tool, context(operation));

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expectTextResult(result);
    },
  );

  it.each([
    {
      label: 'counter-position without counterPosition',
      invalid: {
        kind: 'counter_position',
        question: 'Which evidence would change the decision?',
      },
    },
    {
      label: 'blind spot with counterPosition',
      invalid: {
        kind: 'blind_spot',
        counterPosition: 'This field is forbidden for a blind spot.',
        question: 'Which stakeholder carries the hidden cost?',
      },
    },
  ])('rejects $label through the real MCP output boundary', async ({ invalid }) => {
    const service = new RecordingOperationService(() => ({
      ok: true,
      value: invalid as unknown as OperationResult,
    }));
    const { client } = await connectMcp(service);
    await client.listTools();
    const result = await call(client, 'challenge', context('challenge'));

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expectTextResult(result);
  });

  it('serves the literal compact widget with MCP Apps MIME type and closed CSP metadata', async () => {
    const { client } = await connectMcp(new RecordingOperationService());
    const listed = await client.listResources();
    expect(listed.resources).toHaveLength(1);
    expect(listed.resources[0]).toMatchObject({
      name: 'Specular result widget',
      uri: RESOURCE_URI,
      mimeType: 'text/html;profile=mcp-app',
      description: 'Compact Specular surface for one question, testing a thread, and gathering exact user-authored excerpts.',
      _meta: {
        ui: {
          csp: {
            connectDomains: [],
            resourceDomains: [],
            frameDomains: [],
            baseUriDomains: [],
          },
          permissions: {},
          prefersBorder: true,
        },
      },
    });

    const read = await client.readResource({ uri: RESOURCE_URI });
    expect(read.contents).toHaveLength(1);
    expect(read.contents[0]).toEqual({
      uri: RESOURCE_URI,
      mimeType: 'text/html;profile=mcp-app',
      text: WIDGET_HTML,
      _meta: {
        ui: {
          csp: {
            connectDomains: [],
            resourceDomains: [],
            frameDomains: [],
            baseUriDomains: [],
          },
          permissions: {},
          prefersBorder: true,
        },
      },
    });
  });
});

describe('createSpecularMcpServer operation delegation', () => {
  it('delegates all successful tools to one service with matching operations and fresh request data', async () => {
    const service = new RecordingOperationService();
    const { client } = await connectMcp(service);
    await client.listTools();
    const cases = [
      ['next_question', context('next_question')],
      ['challenge', context('challenge')],
      ['draft_conclusion', context('conclusion')],
    ] as const;

    const results: CallToolResult[] = [];
    for (const [name, suppliedContext] of cases) {
      results.push(await call(client, name, suppliedContext));
    }

    expect(service.calls).toHaveLength(3);
    service.calls.forEach((request, index) => {
      const current = cases[index];
      if (current === undefined) {
        throw new Error('Expected a matching MCP test case.');
      }
      expect(request.operation).toBe(operationForTool(current[0]));
      expect(request.context).toEqual(current[1]);
      expect(request.signal).toBeInstanceOf(AbortSignal);
      expect(request.signal.aborted).toBe(false);
      expect(requestIdSchema.safeParse(request.requestId).success).toBe(true);
    });
    expect(new Set(service.calls.map(({ requestId }) => requestId)).size).toBe(3);

    results.forEach((result, index) => {
      const current = cases[index];
      if (current === undefined) {
        throw new Error('Expected a matching MCP result case.');
      }
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(resultForOperation(operationForTool(current[0])));
      expectTextResult(result);
    });
  });

  it('uses testing and extractive gathering semantics in text fallbacks', async () => {
    const { client } = await connectMcp(new RecordingOperationService());
    const tested = await call(client, 'challenge', context('challenge'));
    const gathered = await call(client, 'draft_conclusion', context('conclusion'));
    const testedText = tested.content.flatMap((block) => block.type === 'text' ? [block.text] : []);
    const gatheredText = gathered.content.flatMap(
      (block) => block.type === 'text' ? [block.text] : [],
    );

    expect(testedText.join(' ')).toContain('Test this thread');
    expect(testedText.join(' ')).not.toContain('Challenge');
    expect(gatheredText.join(' ')).toContain('Gather this thread');
    expect(gatheredText.join(' ')).toContain('exact user-authored excerpt');
    expect(gatheredText.join(' ')).toContain('no new content drafted');
    expect(gatheredText.join(' ')).not.toContain('Working conclusion');
  });

  it.each([
    ['next_question', 'next_question'],
    ['challenge', 'challenge'],
    ['draft_conclusion', 'conclusion'],
  ] as const)(
    'returns local immediate safety for %s without provider work',
    async (tool, operation) => {
      const provider = new ScriptedProvider();
      const { client } = await connectMcp(serviceWithProvider(provider));
      const result = await call(client, tool, context(operation, {
        content: 'I am going to kill myself tonight and I have the means ready.',
      }));

      expect(result.structuredContent).toMatchObject({ kind: 'immediate_safety' });
      expect(JSON.stringify(result.structuredContent)).not.toContain('provenance');
      expect(provider.generateCalls).toBe(0);
      expect(provider.repairCalls).toBe(0);
    },
  );

  it.each([
    {
      label: 'a tool/context operation mismatch',
      name: 'challenge' as const,
      mutate: () => context('next_question'),
    },
    {
      label: 'an extra top-level input field',
      name: 'next_question' as const,
      mutate: () => ({ context: context('next_question'), extra: 'rejected' }),
      wrap: false,
    },
    {
      label: 'a cross-thread turn',
      name: 'next_question' as const,
      mutate: () => {
        const value = structuredClone(context('next_question')) as Record<string, unknown>;
        const turns = value.turns as Record<string, unknown>[];
        const first = turns[0];
        if (first === undefined) {
          throw new Error('Expected a context turn.');
        }
        first.threadId = 'other-thread';
        return value;
      },
    },
    {
      label: 'duplicate turn positions',
      name: 'next_question' as const,
      mutate: () => {
        const value = structuredClone(context('next_question', { turns: 2 })) as Record<string, unknown>;
        const turns = value.turns as Record<string, unknown>[];
        const second = turns[1];
        if (second === undefined) {
          throw new Error('Expected a second context turn.');
        }
        second.position = 0;
        return value;
      },
    },
    {
      label: 'out-of-order turn positions',
      name: 'next_question' as const,
      mutate: () => {
        const value = structuredClone(context('next_question', { turns: 2 })) as Record<string, unknown>;
        const turns = value.turns as Record<string, unknown>[];
        const first = turns[0];
        const second = turns[1];
        if (first === undefined || second === undefined) {
          throw new Error('Expected two context turns.');
        }
        first.position = 2;
        second.position = 1;
        return value;
      },
    },
    {
      label: 'invalid conclusion provenance',
      name: 'draft_conclusion' as const,
      mutate: () => ({
        ...context('conclusion'),
        provisionalConclusion: {
          ...VALID_CONCLUSION,
          editState: 'generated',
          provenance: [],
        },
      }),
    },
    {
      label: 'an oversized bounded context',
      name: 'next_question' as const,
      mutate: () => ({
        ...context('next_question'),
        turns: Array.from({ length: MAX_CONTEXT_TURNS + 1 }, (_, position) => ({
          id: `oversized-turn-${String(position)}`,
          ownerScope: 'local',
          threadId: 'thread-1',
          role: 'user',
          content: `Bounded turn ${String(position)}.`,
          modality: 'text',
          createdAt: position,
          position,
          deliveryState: 'accepted',
        })),
      }),
    },
  ])('rejects $label before the operation service runs', async ({ name, mutate, wrap = true }) => {
    const service = new RecordingOperationService();
    const { client } = await connectMcp(service);
    const supplied = mutate();
    const result = wrap
      ? await call(client, name, supplied)
      : CallToolResultSchema.parse(await client.callTool({ name, arguments: supplied }));

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expectTextResult(result);
    expect(service.calls).toHaveLength(0);
  });
});

describe('shared model validation and MCP errors', () => {
  it.each([
    {
      label: 'the no-why rule',
      tool: 'next_question' as const,
      operation: 'next_question' as const,
      invalid: { ...VALID_NEXT_QUESTION, question: 'Why did the launch stall?' },
    },
    {
      label: 'the exact question count',
      tool: 'next_question' as const,
      operation: 'next_question' as const,
      invalid: { ...VALID_NEXT_QUESTION, question: 'Who noticed first? What changed next?' },
    },
    {
      label: 'the operation word limit',
      tool: 'next_question' as const,
      operation: 'next_question' as const,
      invalid: {
        ...VALID_NEXT_QUESTION,
        question: `${Array.from({ length: 46 }, () => 'boundary').join(' ')}?`,
      },
    },
    {
      label: 'Challenge credibility and shape',
      tool: 'challenge' as const,
      operation: 'challenge' as const,
      invalid: {
        kind: 'counter_position',
        counterPosition: '',
        question: 'Which evidence would change the decision?',
      },
    },
    {
      label: 'conclusion grounding',
      tool: 'draft_conclusion' as const,
      operation: 'conclusion' as const,
      invalid: { ...VALID_CONCLUSION, provenance: [] },
    },
    {
      label: 'the local-only immediate-safety discriminator',
      tool: 'next_question' as const,
      operation: 'next_question' as const,
      invalid: IMMEDIATE_SAFETY,
    },
  ])('enforces $label through one repair and never returns the invalid payload', async ({
    invalid,
    operation,
    tool,
  }) => {
    const provider = new ScriptedProvider({
      generate: [attempt(invalid)],
      repair: [attempt(invalid)],
    });
    const { client } = await connectMcp(serviceWithProvider(provider));
    await client.listTools();
    const result = await call(client, tool, context(operation));

    expect(provider.generateCalls).toBe(1);
    expect(provider.repairCalls).toBe(1);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(typedError(result)).toMatchObject({
      code: 'invalid_output',
      retryable: true,
    });
    expectTextResult(result);
    expect(JSON.stringify(result)).not.toContain(JSON.stringify(invalid));
  });

  it.each([
    {
      label: 'provider unavailable',
      provider: () => new ScriptedProvider({ configured: false }),
      code: 'provider_unavailable' as const,
    },
    {
      label: 'provider timeout',
      provider: () => new ScriptedProvider({
        generate: [new ProviderRequestError('timeout')],
      }),
      code: 'timeout' as const,
    },
    {
      label: 'provider refusal',
      provider: () => new ScriptedProvider({
        generate: [new ProviderRequestError('refusal')],
      }),
      code: 'provider_unavailable' as const,
    },
    {
      label: 'provider null output',
      provider: () => new ScriptedProvider({
        generate: [new ProviderRequestError('null_output')],
      }),
      code: 'invalid_output' as const,
    },
  ])('returns a typed, recoverable, text-only MCP error for $label', async ({ provider, code }) => {
    const { client } = await connectMcp(serviceWithProvider(provider()));
    await client.listTools();
    const result = await call(
      client,
      'next_question',
      context('next_question', { content: PRIVATE_SENTINEL }),
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const error = typedError(result);
    expect(error).toMatchObject({ code, retryable: true });
    expect(requestIdSchema.safeParse(error.requestId).success).toBe(true);
    expectTextResult(result);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_SENTINEL);
  });

  it('propagates cancellation while the SDK rejects locally and suppresses the server result', async () => {
    let resolveStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    let resolveProviderCompleted: (() => void) | undefined;
    const providerCompleted = new Promise<void>((resolve) => {
      resolveProviderCompleted = resolve;
    });
    const provider = new ScriptedProvider({
      generate: [async (request) => await new Promise<ProviderAttempt>((resolve) => {
        resolveStarted?.();
        request.signal.addEventListener('abort', () => {
          resolveProviderCompleted?.();
          resolve(attempt({
            ...VALID_NEXT_QUESTION,
            setup: PRIVATE_SENTINEL,
          }));
        }, { once: true });
      })],
    });
    const { client, serverTransport } = await connectMcp(serviceWithProvider(provider));
    const serverMessages: JSONRPCMessage[] = [];
    const sendFromServer = serverTransport.send.bind(serverTransport);
    serverTransport.send = async (message, options) => {
      serverMessages.push(message);
      await sendFromServer(message, options);
    };
    const controller = new AbortController();
    const pending = client.callTool({
      name: 'next_question',
      arguments: { context: context('next_question', { content: PRIVATE_SENTINEL }) },
    }, CallToolResultSchema, { signal: controller.signal });

    await started;
    controller.abort();
    await expect(pending).rejects.toThrow();
    await providerCompleted;
    await Promise.resolve();
    await Promise.resolve();

    // SDK 1.29.0 shared/protocol.js deletes the client response handler on abort and
    // suppresses the server handler's eventual result once its request signal is aborted.
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.signal.aborted).toBe(true);
    expect(serverMessages).toEqual([]);
  });

  it('keeps every handled service failure text-bearing and free of hidden request content', async () => {
    const codes: SpecularErrorCode[] = [
      'offline',
      'timeout',
      'provider_unavailable',
      'invalid_output',
      'rate_limited',
      'storage_failure',
    ];
    let index = 0;
    const service = new RecordingOperationService((request) => {
      const code = codes[index];
      index += 1;
      if (code === undefined) {
        throw new Error('Expected a scripted service error code.');
      }
      return { ok: false, error: createServiceError(code, request.requestId) };
    });
    const { client } = await connectMcp(service);

    for (const code of codes) {
      const result = await call(
        client,
        'next_question',
        context('next_question', { content: PRIVATE_SENTINEL }),
      );
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(typedError(result)).toMatchObject({ code });
      expectTextResult(result);
      expect(JSON.stringify(result)).not.toContain(PRIVATE_SENTINEL);
    }
  });
});

describe('MCP request statelessness', () => {
  it('retains no conversation content across repeated calls or separate server instances', async () => {
    const provider = new ScriptedProvider({
      generate: [
        (request) => attempt({
          ...VALID_NEXT_QUESTION,
          setup: `Current marker: ${request.context.turns[0]?.content ?? 'missing'}.`,
        }),
        (request) => attempt({
          ...VALID_NEXT_QUESTION,
          setup: `Current marker: ${request.context.turns[0]?.content ?? 'missing'}.`,
        }),
        (request) => attempt({
          ...VALID_NEXT_QUESTION,
          setup: `Current marker: ${request.context.turns[0]?.content ?? 'missing'}.`,
        }),
      ],
    });
    const sharedStatelessService = serviceWithProvider(provider);
    const first = await connectMcp(sharedStatelessService);
    const alpha = await call(
      first.client,
      'next_question',
      context('next_question', { threadId: 'thread-alpha', content: 'alpha' }),
    );
    const beta = await call(
      first.client,
      'next_question',
      context('next_question', { threadId: 'thread-beta', content: 'beta' }),
    );
    const second = await connectMcp(sharedStatelessService);
    const gamma = await call(
      second.client,
      'next_question',
      context('next_question', { threadId: 'thread-gamma', content: 'gamma' }),
    );

    expect(JSON.stringify(alpha.structuredContent)).toContain('alpha');
    expect(JSON.stringify(beta.structuredContent)).toContain('beta');
    expect(JSON.stringify(beta.structuredContent)).not.toContain('alpha');
    expect(JSON.stringify(gamma.structuredContent)).toContain('gamma');
    expect(JSON.stringify(gamma.structuredContent)).not.toContain('alpha');
    expect(JSON.stringify(gamma.structuredContent)).not.toContain('beta');
    expect(provider.requests.map(({ context: requestContext }) => requestContext.thread.id)).toEqual([
      'thread-alpha',
      'thread-beta',
      'thread-gamma',
    ]);
  });
});
