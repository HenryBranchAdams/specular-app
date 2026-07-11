import { randomUUID } from 'node:crypto';
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AnySchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { z as z4 } from 'zod/v4';
import { assertNever } from '../src/domain/contracts';
import type {
  Operation,
  OperationResult,
  RequestId,
  SpecularError,
  ThreadContext,
} from '../src/domain/contracts';
import {
  challengeResultSchema,
  MAX_RESULT_TEXT_LENGTH,
  nextQuestionResultSchema,
  requestIdSchema,
  threadContextSchema,
  workingConclusionResultSchema,
} from '../src/domain/schemas';
import {
  createServiceError,
  type OperationService,
} from './operation-service';

const RESOURCE_URI = 'ui://widget/specular.html';
const SERVER_INSTRUCTIONS = [
  'Every tool call is explicit, thread-scoped, and stateless: supply the complete bounded ThreadContext on every request.',
  'Testing and gathering operations are opt-in; never invoke either as an automatic follow-up.',
  'Use next_question for one concise next question and challenge only when the user requests to test this thread with one focused question.',
  'Use draft_conclusion only when the user requests to gather this thread; it organizes distinct exact user-authored excerpts and must not draft new content.',
  'The server retains no transcript, thread, or conversation state between calls.',
].join(' ');

const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

type ToolRequestExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

interface CompatibleAppToolConfig<
  InputSchema extends z.AnyZodObject,
  OutputSchema extends AnySchema,
> {
  title: string;
  description: string;
  inputSchema: InputSchema;
  outputSchema: OutputSchema;
  annotations: ToolAnnotations;
  _meta: Record<string, unknown> & {
    ui: { resourceUri: string };
  };
}

type RegisterCompatibleAppTool = <
  InputSchema extends z.AnyZodObject,
  OutputSchema extends AnySchema,
>(
  server: McpServer,
  name: string,
  config: CompatibleAppToolConfig<InputSchema, OutputSchema>,
  callback: (
    input: z.infer<InputSchema>,
    extra: ToolRequestExtra,
  ) => CallToolResult | Promise<CallToolResult>,
) => unknown;

// ext-apps 1.7.2's public generic omits Zod 3 object instances even though
// its SDK 1.29 runtime supports and validates them. Keep the compatibility
// cast at this one registration boundary so handlers remain fully typed.
const registerCompatibleAppTool = registerAppTool as unknown as RegisterCompatibleAppTool;

const challengeResultTextSchema = z4
  .string()
  .trim()
  .min(1)
  .max(MAX_RESULT_TEXT_LENGTH);

const challengeToolOutputSchema = z4.object({
  kind: z4.enum(['blind_spot', 'counter_position']),
  question: challengeResultTextSchema,
  counterPosition: challengeResultTextSchema.optional(),
}).strict().check(({ value, issues }) => {
  if (!challengeResultSchema.safeParse(value).success) {
    issues.push({
      code: 'custom',
      input: value,
      message: 'The result must match exactly one shared Challenge shape.',
    });
  }
}).meta({
  oneOf: [
    {
      type: 'object',
      properties: {
        kind: { type: 'string', const: 'blind_spot' },
        question: {
          type: 'string',
          minLength: 1,
          maxLength: MAX_RESULT_TEXT_LENGTH,
        },
      },
      required: ['kind', 'question'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: { type: 'string', const: 'counter_position' },
        counterPosition: {
          type: 'string',
          minLength: 1,
          maxLength: MAX_RESULT_TEXT_LENGTH,
        },
        question: {
          type: 'string',
          minLength: 1,
          maxLength: MAX_RESULT_TEXT_LENGTH,
        },
      },
      required: ['kind', 'counterPosition', 'question'],
      additionalProperties: false,
    },
  ],
});

export interface CreateSpecularMcpServerOptions {
  service: OperationService;
  widgetHtml: string;
}

function requestId(): RequestId {
  return requestIdSchema.parse(randomUUID());
}

function inputSchemaFor(operation: Operation) {
  return z.object({
    context: threadContextSchema.refine(
      (context) => context.operation === operation,
      {
        message: `context.operation must be ${operation}.`,
        path: ['operation'],
      },
    ),
  }).strict();
}

function resourceUiMetadata() {
  return {
    csp: {
      connectDomains: [],
      resourceDomains: [],
      frameDomains: [],
      baseUriDomains: [],
    },
    permissions: {},
    prefersBorder: true,
  };
}

function toolMetadata(invoking: string, invoked: string) {
  return {
    ui: { resourceUri: RESOURCE_URI },
    'openai/outputTemplate': RESOURCE_URI,
    'openai/toolInvocation/invoking': invoking,
    'openai/toolInvocation/invoked': invoked,
  };
}

function textFallback(value: OperationResult): string {
  switch (value.kind) {
    case 'question':
      return value.setup === undefined
        ? value.question
        : `${value.setup} ${value.question}`;
    case 'blind_spot':
      return `Test this thread: ${value.question}`;
    case 'counter_position':
      return `Test this thread: ${value.counterPosition} ${value.question}`;
    case 'working_conclusion':
      return `Gather this thread — exact user-authored excerpt organized; no new content drafted: ${value.thesis}`;
    default:
      return assertNever(value);
  }
}

function errorResult(error: SpecularError): CallToolResult {
  return {
    isError: true,
    content: [{
      type: 'text',
      text: `${error.message} Error code: ${error.code}. ${error.retryable ? 'Retry is safe.' : 'Retry is not advised.'}`,
    }],
    _meta: {
      'specular/error': {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
      },
    },
  };
}

async function execute(
  service: OperationService,
  operation: Operation,
  context: ThreadContext,
  signal: AbortSignal,
): Promise<CallToolResult> {
  const id = requestId();
  try {
    const result = await service.execute({
      operation,
      context,
      requestId: id,
      signal,
    });
    if (!result.ok) {
      return errorResult(result.error);
    }
    return {
      structuredContent: result.value,
      content: [{ type: 'text', text: textFallback(result.value) }],
    };
  } catch {
    return errorResult(createServiceError('provider_unavailable', id));
  }
}

export function createSpecularMcpServer(
  options: CreateSpecularMcpServerOptions,
): McpServer {
  const server = new McpServer(
    { name: 'Specular', version: '1.0.0' },
    { instructions: SERVER_INSTRUCTIONS },
  );

  const ui = resourceUiMetadata();
  registerAppResource(
    server,
    'Specular result widget',
    RESOURCE_URI,
    {
      description: 'Compact Specular surface for one question, testing a thread, and gathering exact user-authored excerpts.',
      _meta: { ui },
    },
    () => ({
      contents: [{
        uri: RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: options.widgetHtml,
        _meta: { ui },
      }],
    }),
  );

  registerCompatibleAppTool(
    server,
    'next_question',
    {
      title: 'Ask the next question',
      description: 'Ask one concise, independent next question using only the supplied thread context.',
      inputSchema: inputSchemaFor('next_question'),
      outputSchema: nextQuestionResultSchema,
      annotations: TOOL_ANNOTATIONS,
      _meta: toolMetadata('Finding the next question…', 'Next question ready.'),
    },
    async ({ context }, extra) => await execute(
      options.service,
      'next_question',
      context,
      extra.signal,
    ),
  );

  registerCompatibleAppTool(
    server,
    'challenge',
    {
      title: 'Test this thread',
      description: 'Ask one focused blind-spot or testing question using only the supplied thread context.',
      inputSchema: inputSchemaFor('challenge'),
      outputSchema: challengeToolOutputSchema,
      annotations: TOOL_ANNOTATIONS,
      _meta: toolMetadata('Testing this thread…', 'Testing question ready.'),
    },
    async ({ context }, extra) => await execute(
      options.service,
      'challenge',
      context,
      extra.signal,
    ),
  );

  registerCompatibleAppTool(
    server,
    'draft_conclusion',
    {
      title: 'Gather this thread',
      description: 'Organize distinct exact user-authored excerpts from accepted user turns; do not draft, paraphrase, or add content.',
      inputSchema: inputSchemaFor('conclusion'),
      outputSchema: workingConclusionResultSchema,
      annotations: TOOL_ANNOTATIONS,
      _meta: toolMetadata(
        'Gathering exact user-authored excerpts without drafting new content…',
        'Exact user-authored excerpts gathered; no new content drafted.',
      ),
    },
    async ({ context }, extra) => await execute(
      options.service,
      'conclusion',
      context,
      extra.signal,
    ),
  );

  return server;
}
