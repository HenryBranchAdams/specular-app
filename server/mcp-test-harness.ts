import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolResultSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { expect } from 'vitest';
import { assertNever } from '../src/domain/contracts';
import type {
  Operation,
  OperationResult,
  ThreadContext,
} from '../src/domain/contracts';
import {
  threadContextSchema,
  threadUnderstandingSchema,
  workingConclusionResultSchema,
} from '../src/domain/schemas';
import { createSpecularMcpServer } from './mcp';
import {
  createOperationService,
  type ExecuteOperationRequest,
  type OperationService,
  type OperationServiceResult,
  type ProviderAttempt,
  type ProviderRepairRequest,
  type ProviderRequest,
  type RepairingQuestioningProvider,
} from './operation-service';
import { NullMetadataSink } from './telemetry';

export const RESOURCE_URI = 'ui://widget/specular.html';
export const WIDGET_HTML = '<!doctype html><main data-specular-widget>Literal Spectral widget</main>';
export const PRIVATE_SENTINEL = 'PRIVATE-TRANSCRIPT-DO-NOT-RETURN';

export const UNDERSTANDING = threadUnderstandingSchema.parse({
  claims: [],
  observations: [],
  stakeholders: [],
  contexts: [],
  distinctions: [],
  tensions: [],
  exploredBlindSpots: [],
  unexploredBlindSpots: [],
});

export const VALID_NEXT_QUESTION = {
  kind: 'question',
  question: 'Which launch constraint would change the decision most?',
  understanding: UNDERSTANDING,
} as const;

export const VALID_CHALLENGE = {
  kind: 'counter_position',
  counterPosition: 'A smaller launch may protect learning better than a broad launch.',
  question: 'Which evidence would distinguish useful caution from avoidable delay?',
} as const;

export const VALID_CONCLUSION = workingConclusionResultSchema.parse({
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
  provenance: [{
    turnId: 'thread-1-turn-1',
    excerpt: 'The handoff is where the launch gets stuck.',
  }],
});

export const EXPECTED_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const EXPECTED_TOOL_COPY = {
  next_question: {
    title: 'Ask the next question',
    description: 'Ask one concise, independent next question using only the supplied thread context.',
  },
  challenge: {
    title: 'Challenge this thread',
    description: 'Opt in to a credible blind spot or counter-position using only the supplied thread context.',
  },
  draft_conclusion: {
    title: 'Draft a working conclusion',
    description: 'Opt in to a grounded working conclusion using only the supplied thread context.',
  },
} as const;

export type ToolName = keyof typeof EXPECTED_TOOL_COPY;

type GenerateStep =
  | ProviderAttempt
  | Error
  | ((request: ProviderRequest) => ProviderAttempt | Promise<ProviderAttempt>);

type RepairStep =
  | ProviderAttempt
  | Error
  | ((request: ProviderRepairRequest) => ProviderAttempt | Promise<ProviderAttempt>);

export interface McpHarness {
  client: Client;
  clientTransport: InMemoryTransport;
  server: McpServer;
  serverTransport: InMemoryTransport;
}

export interface JsonSchema {
  additionalProperties?: boolean;
  maxItems?: number;
  maxLength?: number;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  type?: string;
  [key: string]: unknown;
}

export class ScriptedProvider implements RepairingQuestioningProvider {
  readonly configured: boolean;
  readonly modelId = 'scripted-model';
  readonly providerId = 'scripted-provider';
  generateCalls = 0;
  repairCalls = 0;
  readonly requests: ProviderRequest[] = [];
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
    this.requests.push(request);
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

export class RecordingOperationService implements OperationService {
  readonly calls: ExecuteOperationRequest[] = [];
  private readonly respond: (request: ExecuteOperationRequest) => OperationServiceResult;

  constructor(
    respond: (request: ExecuteOperationRequest) => OperationServiceResult = (request) => ({
      ok: true,
      value: resultForOperation(request.operation),
    }),
  ) {
    this.respond = respond;
  }

  isReady(): boolean {
    return true;
  }

  execute(request: ExecuteOperationRequest): Promise<OperationServiceResult> {
    this.calls.push(request);
    return Promise.resolve(this.respond(request));
  }
}

const openHarnesses: McpHarness[] = [];

export async function closeMcpHarnesses(): Promise<void> {
  const harnesses = openHarnesses.splice(0);
  await Promise.all(harnesses.map(async ({ client, server }) => {
    await Promise.allSettled([client.close(), server.close()]);
  }));
}

export function context(
  operation: Operation,
  options: {
    content?: string;
    threadId?: string;
    turns?: number;
  } = {},
): ThreadContext {
  const threadId = options.threadId ?? 'thread-1';
  const turnCount = options.turns ?? 1;
  return threadContextSchema.parse({
    thread: { id: threadId },
    turns: Array.from({ length: turnCount }, (_, position) => ({
      id: `${threadId}-turn-${String(position + 1)}`,
      ownerScope: 'local',
      threadId,
      role: position % 2 === 0 ? 'user' : 'specular',
      content: position === 0
        ? (options.content ?? 'The handoff is where the launch gets stuck.')
        : `Bounded context turn ${String(position + 1)}.`,
      modality: 'text',
      createdAt: position + 1,
      position,
      deliveryState: 'accepted',
    })),
    understanding: UNDERSTANDING,
    operation,
  });
}

export function resultForOperation(operation: Operation): OperationResult {
  switch (operation) {
    case 'next_question':
      return VALID_NEXT_QUESTION;
    case 'challenge':
      return VALID_CHALLENGE;
    case 'conclusion':
      return VALID_CONCLUSION;
    default:
      return assertNever(operation);
  }
}

export function operationForTool(name: ToolName): Operation {
  switch (name) {
    case 'next_question':
      return 'next_question';
    case 'challenge':
      return 'challenge';
    case 'draft_conclusion':
      return 'conclusion';
    default:
      return assertNever(name);
  }
}

export function attempt(value: unknown): ProviderAttempt {
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

export function serviceWithProvider(provider: RepairingQuestioningProvider): OperationService {
  return createOperationService({
    provider,
    telemetry: new NullMetadataSink(),
    safetyRegion: 'US',
    safetySecret: new Uint8Array(32).fill(7),
  });
}

export async function connectMcp(
  service: OperationService,
  widgetHtml = WIDGET_HTML,
): Promise<McpHarness> {
  const server = createSpecularMcpServer({ service, widgetHtml });
  const client = new Client({ name: 'specular-mcp-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const harness = { client, clientTransport, server, serverTransport };
  openHarnesses.push(harness);
  return harness;
}

export function expectTextResult(result: CallToolResult): void {
  const texts = result.content.flatMap((block) => block.type === 'text' ? [block.text] : []);
  expect(texts.length).toBeGreaterThan(0);
  expect(texts.every((text) => text.trim().length > 0)).toBe(true);
}

export function typedError(result: CallToolResult): Record<string, unknown> {
  const error = result._meta?.['specular/error'];
  expect(error).toBeTypeOf('object');
  expect(error).not.toBeNull();
  return error as Record<string, unknown>;
}

export async function call(
  client: Client,
  name: ToolName,
  suppliedContext: unknown,
): Promise<CallToolResult> {
  return CallToolResultSchema.parse(await client.callTool({
    name,
    arguments: { context: suppliedContext },
  }));
}
