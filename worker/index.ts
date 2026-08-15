import { z } from 'zod';
import {
  contextScopeSchema,
  reflectionMoveSchema,
  thoughtKindSchema,
} from '../src/thinking/model';
import { reflectionResponseSchema } from '../src/thinking/reflect-client';
import { createInitialWorkspace, workspaceStateSchema } from '../src/thinking/model';
import {
  authorAccountFrom,
  CHATGPT_SIGN_IN_URL,
  CHATGPT_SIGN_OUT_URL,
  requireSameOriginMutation,
} from './chatgpt-auth';

interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta?: { changes?: number };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetFetcher;
  DB: D1DatabaseLike;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_TRANSCRIPTION_MODEL?: string;
  INFERENCE_DAILY_LIMIT?: string;
  INFERENCE_GLOBAL_DAILY_LIMIT?: string;
}

const reflectionRequestSchema = z.object({
  focus: z.string().trim().min(1).max(12_000),
  focusBlockId: z.string().min(1).max(128),
  move: reflectionMoveSchema,
  scope: contextScopeSchema,
  blocks: z.array(z.object({
    id: z.string().min(1).max(128),
    content: z.string().trim().min(1).max(40_000),
    kind: z.string().min(1).max(40),
  }).strict()).min(1).max(200),
  calibration: z.string().trim().min(1).max(2_000).optional(),
  priorMirror: z.string().trim().min(1).max(600).optional(),
}).strict();

const sourceSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().trim().min(1).max(300),
  author: z.string().trim().max(200),
  url: z.string().url().max(2_000).or(z.literal('')),
  excerpt: z.string().trim().max(2_000),
  accessedAt: z.number().int().nonnegative(),
}).strict();

const publishedSnapshotSchema = z.object({
  title: z.string().trim().min(1).max(300),
  createdAt: z.number().int().nonnegative(),
  blocks: z.array(z.object({
    id: z.string().min(1).max(128),
    content: z.string().trim().min(1).max(40_000),
    kind: z.string().min(1).max(40),
    references: z.array(sourceSchema).max(50),
  }).strict()).min(1).max(1_000),
}).strict();

const cleanupRequestSchema = z.object({
  verbatim: z.string().trim().min(1).max(40_000),
}).strict();

const workspaceSaveSchema = z.object({
  cacheNamespace: z.string().min(1).max(128),
  baseRevision: z.number().int().nonnegative(),
  mutationId: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/u),
  workspace: workspaceStateSchema,
}).strict();

const cleanupResponseSchema = z.object({
  cleaned: z.string().trim().min(1).max(40_000),
}).strict();

const transcriptionProviderSchema = z.object({ text: z.string().trim().max(40_000) }).passthrough();

const organizationRequestSchema = z.object({
  documentId: z.string().min(1).max(128),
  blocks: z.array(z.object({
    id: z.string().min(1).max(128),
    content: z.string().trim().min(1).max(40_000),
  }).strict()).min(1).max(200),
}).strict();

const organizationResponseSchema = z.object({
  title: z.string().trim().min(1).max(80),
  kinds: z.array(z.object({
    id: z.string().min(1).max(128),
    kind: thoughtKindSchema,
  }).strict()).max(200),
}).strict();

const responseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['mirror', 'directions', 'referencedBlockIds', 'sources'],
  properties: {
    mirror: { type: 'string', minLength: 1, maxLength: 600 },
    directions: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'prompt', 'move'],
        properties: {
          label: { type: 'string', minLength: 1, maxLength: 80 },
          prompt: { type: 'string', minLength: 1, maxLength: 400 },
          move: {
            type: 'string',
            enum: ['reflect', 'clarify', 'distinguish', 'challenge', 'implications', 'perspective', 'check_premise'],
          },
        },
      },
    },
    referencedBlockIds: {
      type: 'array',
      maxItems: 100,
      items: { type: 'string' },
    },
    sources: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'url', 'excerpt'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 300 },
          url: { type: 'string', minLength: 1, maxLength: 2_000 },
          excerpt: { type: 'string', maxLength: 600 },
        },
      },
    },
  },
} as const;

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:",
  'permissions-policy': 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...SECURITY_HEADERS,
    },
  });
}

function withSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    secured.headers.set(name, value);
  }
  return secured;
}

async function boundedJson(request: Request, maximumBytes: number): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > maximumBytes) {
    throw new Error('payload_too_large');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new Error('payload_too_large');
  }
  return JSON.parse(text) as unknown;
}

const providerOutputSchema = z.object({
  output: z.array(z.object({
    content: z.array(z.object({
      type: z.string(),
      text: z.string().optional(),
    }).passthrough()).optional(),
  }).passthrough()),
}).passthrough();

function responseText(value: unknown): string | null {
  const parsed = providerOutputSchema.safeParse(value);
  if (!parsed.success) return null;
  for (const item of parsed.data.output) {
    for (const part of item.content ?? []) {
      if (part.type === 'output_text' && part.text !== undefined) return part.text;
    }
  }
  return null;
}

function reflectionInstructions(move: string): string {
  return [
    'You are Specular, a rigorous philosophical interlocutor working in the margin of a human-authored thinking document.',
    'The user owns every substantive word in the canonical document. Never draft, rewrite, finish, improve, or supply their thought.',
    'First mirror what the selected writing appears to mean in one or two provisional sentences. Do not praise, diagnose, editorialize, moralize, or interpret the person.',
    'Then offer two to four sparse possible directions. Point to an unresolved edge without supplying an answer, thesis, or polished formulation the user could lazily adopt.',
    'Prefer precise prompts such as naming a distinction, locating an assumption, following an implication, or testing a tension. Avoid generic questions and productivity language.',
    'Be relentless toward ambiguity and respectful toward the thinker. Use plain language. Keep every direction concise.',
    'Never use an em dash character. Use a period, comma, colon, semicolon, or parentheses instead.',
    'Only cite block IDs that materially informed the response.',
    move === 'perspective' || move === 'check_premise'
      ? 'Outside material was explicitly requested. Use web research when useful and include every relied-on source in sources with a valid URL and a short paraphrased relevance note.'
      : 'Do not introduce outside thinkers, facts, frameworks, or sources. Return an empty sources array.',
    move === 'calibrate'
      ? 'The user is correcting a prior reflection. Revise the mirror to honor the correction, then offer restrained directions that send them back to clarify the canonical document.'
      : `Requested move: ${move}.`,
    'Return only the strict structured object.',
  ].join('\n');
}

function withoutEmDashes(value: string): string {
  return value.replaceAll(/\s*—\s*/gu, ': ');
}

function sanitizeReflection(value: z.infer<typeof reflectionResponseSchema>): z.infer<typeof reflectionResponseSchema> {
  return {
    ...value,
    mirror: withoutEmDashes(value.mirror),
    directions: value.directions.map((direction) => ({
      ...direction,
      label: withoutEmDashes(direction.label),
      prompt: withoutEmDashes(direction.prompt),
    })),
  };
}

async function handleReflection(request: Request, env: Env): Promise<Response> {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    return json({ error: 'provider_unavailable' }, 503);
  }
  let input: z.infer<typeof reflectionRequestSchema>;
  try {
    input = reflectionRequestSchema.parse(await boundedJson(request, 512 * 1024));
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  const useWeb = input.move === 'perspective' || input.move === 'check_premise';
  const configuredModel = env.OPENAI_MODEL?.trim();
  const providerResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: configuredModel === undefined || configuredModel.length === 0 ? 'gpt-5.5' : configuredModel,
      instructions: reflectionInstructions(input.move),
      input: JSON.stringify({
        focus: input.focus,
        focusBlockId: input.focusBlockId,
        contextScope: input.scope,
        contextBlocks: input.blocks,
        calibration: input.calibration ?? null,
        priorMirror: input.priorMirror ?? null,
      }),
      text: {
        format: {
          type: 'json_schema',
          name: 'specular_reflection',
          strict: true,
          schema: responseJsonSchema,
        },
      },
      ...(useWeb ? { tools: [{ type: 'web_search', search_context_size: 'low' }] } : {}),
      max_output_tokens: 1_400,
      store: false,
    }),
  });
  if (!providerResponse.ok) {
    return json({ error: 'provider_unavailable' }, 503);
  }
  const providerBody = await providerResponse.json() as unknown;
  const output = responseText(providerBody);
  if (output === null) {
    return json({ error: 'invalid_output' }, 502);
  }
  try {
    return json(sanitizeReflection(reflectionResponseSchema.parse(JSON.parse(output) as unknown)));
  } catch {
    return json({ error: 'invalid_output' }, 502);
  }
}

const organizationJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'kinds'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 80 },
    kinds: {
      type: 'array',
      maxItems: 200,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'kind'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 128 },
          kind: { type: 'string', enum: ['thought', 'question', 'definition', 'hypothesis', 'reference'] },
        },
      },
    },
  },
} as const;

async function handleOrganization(request: Request, env: Env): Promise<Response> {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) return json({ error: 'provider_unavailable' }, 503);
  let input: z.infer<typeof organizationRequestSchema>;
  try { input = organizationRequestSchema.parse(await boundedJson(request, 512 * 1024)); }
  catch { return json({ error: 'invalid_request' }, 400); }
  const configuredModel = env.OPENAI_MODEL?.trim();
  const providerResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: configuredModel === undefined || configuredModel.length === 0 ? 'gpt-5.5' : configuredModel,
      instructions: [
        'Organize a human-authored thinking document without rewriting or evaluating it.',
        'Return a concise descriptive title of at most eight words and one kind for every supplied block.',
        'Use question only for a genuine question, definition only when the block defines a term, hypothesis for a testable or provisional claim, and reference only when the block primarily discusses an outside source. Otherwise use thought.',
        'Never use an em dash character. Do not add claims, interpretation, praise, or prose for the author.',
        'Return only the strict structured object.',
      ].join('\n'),
      input: JSON.stringify(input),
      text: { format: { type: 'json_schema', name: 'specular_organization', strict: true, schema: organizationJsonSchema } },
      max_output_tokens: 1_200,
      store: false,
    }),
  });
  if (!providerResponse.ok) return json({ error: 'provider_unavailable' }, 503);
  const output = responseText(await providerResponse.json());
  if (output === null) return json({ error: 'invalid_output' }, 502);
  try {
    const parsed = organizationResponseSchema.parse(JSON.parse(output) as unknown);
    const knownIds = new Set(input.blocks.map((block) => block.id));
    return json({
      title: withoutEmDashes(parsed.title),
      kinds: parsed.kinds.filter((item) => knownIds.has(item.id)),
    });
  } catch {
    return json({ error: 'invalid_output' }, 502);
  }
}

async function handleTranscription(request: Request, env: Env): Promise<Response> {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) return json({ error: 'provider_unavailable' }, 503);
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > 5 * 1024 * 1024) return json({ error: 'payload_too_large' }, 413);

  let audio: Blob;
  try {
    const form = await request.formData();
    const value = form.get('audio');
    if (value === null || typeof value === 'string' || value.size === 0 || value.size > 5 * 1024 * 1024) {
      return json({ error: 'invalid_audio' }, 400);
    }
    const allowed = new Set(['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-m4a', 'audio/flac']);
    const mime = value.type.split(';', 1)[0]?.toLowerCase() ?? '';
    if (!allowed.has(mime)) return json({ error: 'invalid_audio' }, 400);
    const audioBytes = await value.arrayBuffer();
    if (audioBytes.byteLength === 0) return json({ error: 'invalid_audio' }, 400);
    audio = new Blob([audioBytes], { type: value.type });
  } catch {
    return json({ error: 'invalid_audio' }, 400);
  }

  const providerForm = new FormData();
  const extensionByMime: Readonly<Record<string, string>> = {
    'audio/flac': 'flac',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'mp4',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'audio/x-m4a': 'm4a',
  };
  const extension = extensionByMime[audio.type.split(';', 1)[0]?.toLowerCase() ?? ''] ?? 'webm';
  providerForm.set('file', audio, `checkpoint.${extension}`);
  const configuredTranscriptionModel = env.OPENAI_TRANSCRIPTION_MODEL?.trim();
  providerForm.set('model', configuredTranscriptionModel === undefined || configuredTranscriptionModel.length === 0 ? 'gpt-4o-mini-transcribe' : configuredTranscriptionModel);
  providerForm.set('language', 'en');
  const providerResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: providerForm,
  });
  if (!providerResponse.ok) return json({ error: 'provider_unavailable' }, 503);
  try {
    const result = transcriptionProviderSchema.parse(await providerResponse.json());
    return json({ transcript: result.text });
  } catch {
    return json({ error: 'invalid_output' }, 502);
  }
}

const cleanupJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['cleaned'],
  properties: { cleaned: { type: 'string', minLength: 1, maxLength: 40_000 } },
} as const;

function cleanupInstructions(): string {
  return [
    'Faithfully clean a voice dictation transcript while preserving the speaker\'s substance, sequence, uncertainty, emphasis, and voice.',
    'Remove filler words, immediate accidental repetitions, and explicit false starts that the speaker clearly corrected.',
    'Add only punctuation, capitalization, paragraph breaks, and minimal grammatical agreement needed to make the spoken words readable.',
    'Never summarize, reorder, add, complete, or reinterpret any idea. Never improve the argument or supply missing reasoning.',
    'When a correction is ambiguous, preserve both phrasings. When unsure, preserve the original words.',
    'Return only the strict structured object.',
  ].join('\n');
}

async function handleCleanup(request: Request, env: Env): Promise<Response> {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) return json({ error: 'provider_unavailable' }, 503);
  let input: z.infer<typeof cleanupRequestSchema>;
  try { input = cleanupRequestSchema.parse(await boundedJson(request, 64 * 1024)); }
  catch { return json({ error: 'invalid_request' }, 400); }
  const configuredCleanupModel = env.OPENAI_MODEL?.trim();

  const providerResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: configuredCleanupModel === undefined || configuredCleanupModel.length === 0 ? 'gpt-5.5' : configuredCleanupModel,
      instructions: cleanupInstructions(),
      input: input.verbatim,
      text: { format: { type: 'json_schema', name: 'faithful_dictation_cleanup', strict: true, schema: cleanupJsonSchema } },
      max_output_tokens: 12_000,
      store: false,
    }),
  });
  if (!providerResponse.ok) return json({ error: 'provider_unavailable' }, 503);
  const output = responseText(await providerResponse.json());
  if (output === null) return json({ error: 'invalid_output' }, 502);
  try {
    const parsed = cleanupResponseSchema.parse(JSON.parse(output) as unknown);
    const maximumExpansion = Math.max(input.verbatim.length + 200, Math.ceil(input.verbatim.length * 1.25));
    if (parsed.cleaned.length > maximumExpansion) return json({ error: 'unfaithful_output' }, 422);
    return json(parsed);
  } catch {
    return json({ error: 'invalid_output' }, 502);
  }
}

function utcDay(now = Date.now()): string { return new Date(now).toISOString().slice(0, 10); }

async function allowInference(tenantId: string, env: Env): Promise<boolean> {
  const day = utcDay();
  const configured = Number(env.INFERENCE_DAILY_LIMIT ?? '500');
  const limit = Number.isInteger(configured) && configured > 0 ? configured : 500;
  const configuredGlobal = Number(env.INFERENCE_GLOBAL_DAILY_LIMIT ?? '5000');
  const globalLimit = Number.isInteger(configuredGlobal) && configuredGlobal > 0 ? configuredGlobal : 5_000;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(tenantId));
  const tenantKey = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  const tenantPath = `$."${tenantKey}"`;
  const reservationId = globalThis.crypto.randomUUID();
  const current = await env.DB.prepare(`SELECT global_count,
      COALESCE(json_extract(tenant_counts, ?), 0) AS tenant_count
    FROM inference_daily_usage WHERE usage_day = ?`)
    .bind(tenantPath, day)
    .first<{ global_count: number; tenant_count: number }>();
  if (current !== null && (current.global_count >= globalLimit || current.tenant_count >= limit)) return false;
  const updateReservation = () => env.DB.prepare(`UPDATE inference_daily_usage SET
      global_count = CASE
        WHEN inference_daily_usage.global_count < ?
          AND COALESCE(json_extract(inference_daily_usage.tenant_counts, ?), 0) < ?
        THEN inference_daily_usage.global_count + 1
        ELSE inference_daily_usage.global_count
      END,
      tenant_counts = CASE
        WHEN inference_daily_usage.global_count < ?
          AND COALESCE(json_extract(inference_daily_usage.tenant_counts, ?), 0) < ?
        THEN json_set(
          inference_daily_usage.tenant_counts,
          ?,
          COALESCE(json_extract(inference_daily_usage.tenant_counts, ?), 0) + 1
        )
        ELSE inference_daily_usage.tenant_counts
      END,
      last_reservation_id = ?,
      last_reservation_accepted = CASE
        WHEN inference_daily_usage.global_count < ?
          AND COALESCE(json_extract(inference_daily_usage.tenant_counts, ?), 0) < ?
        THEN 1
        ELSE 0
      END
    WHERE usage_day = ?
    RETURNING last_reservation_id, last_reservation_accepted`)
    .bind(
      globalLimit, tenantPath, limit,
      globalLimit, tenantPath, limit, tenantPath, tenantPath,
      reservationId, globalLimit, tenantPath, limit, day,
    )
    .first<{ last_reservation_id: string | null; last_reservation_accepted: number }>();
  let reserved = await updateReservation();
  if (reserved === null) {
    reserved = await env.DB.prepare(`INSERT INTO inference_daily_usage
      (usage_day, global_count, tenant_counts, last_reservation_id, last_reservation_accepted)
      VALUES (?, 1, json_object(?, 1), ?, 1)
      ON CONFLICT (usage_day) DO NOTHING
      RETURNING last_reservation_id, last_reservation_accepted`)
      .bind(day, tenantKey, reservationId)
      .first<{ last_reservation_id: string | null; last_reservation_accepted: number }>();
    reserved ??= await updateReservation();
  }
  return reserved?.last_reservation_id === reservationId && reserved.last_reservation_accepted === 1;
}

interface WorkspaceRow {
  cache_namespace: string;
  revision: number;
  state: string;
}

async function workspaceFor(tenantId: string, env: Env): Promise<WorkspaceRow> {
  const existing = await env.DB.prepare('SELECT cache_namespace, revision, state FROM author_workspaces WHERE tenant_id = ?')
    .bind(tenantId).first<WorkspaceRow>();
  if (existing !== null) return existing;
  const created: WorkspaceRow = {
    cache_namespace: `account:${globalThis.crypto.randomUUID()}`,
    revision: 0,
    state: JSON.stringify(createInitialWorkspace()),
  };
  await env.DB.prepare('INSERT INTO author_workspaces (tenant_id, cache_namespace, revision, state, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(tenantId, created.cache_namespace, created.revision, created.state, Date.now()).run();
  return await env.DB.prepare('SELECT cache_namespace, revision, state FROM author_workspaces WHERE tenant_id = ?')
    .bind(tenantId).first<WorkspaceRow>() ?? created;
}

async function readWorkspace(tenantId: string, env: Env): Promise<Response> {
  const row = await workspaceFor(tenantId, env);
  try {
    return json({
      cacheNamespace: row.cache_namespace,
      revision: row.revision,
      workspace: workspaceStateSchema.parse(JSON.parse(row.state) as unknown),
    });
  } catch {
    return json({ error: 'invalid_workspace' }, 500);
  }
}

async function saveWorkspace(request: Request, tenantId: string, env: Env): Promise<Response> {
  let input: z.infer<typeof workspaceSaveSchema>;
  try { input = workspaceSaveSchema.parse(await boundedJson(request, 8 * 1024 * 1024)); }
  catch { return json({ error: 'invalid_workspace' }, 400); }

  const current = await workspaceFor(tenantId, env);
  if (current.cache_namespace !== input.cacheNamespace) return json({ error: 'stale_workspace_generation' }, 410);
  const priorMutation = await env.DB.prepare('SELECT revision FROM workspace_mutations WHERE tenant_id = ? AND mutation_id = ?')
    .bind(tenantId, input.mutationId).first<{ revision: number }>();
  if (priorMutation !== null) return json({ revision: priorMutation.revision, idempotent: true });
  if (current.revision !== input.baseRevision) {
    return json({
      error: 'revision_conflict',
      revision: current.revision,
      workspace: workspaceStateSchema.parse(JSON.parse(current.state) as unknown),
    }, 409);
  }

  const revision = current.revision + 1;
  const state = JSON.stringify(input.workspace);
  const now = Date.now();
  const [updated] = await env.DB.batch([
    env.DB.prepare('UPDATE author_workspaces SET state = ?, revision = ?, updated_at = ? WHERE tenant_id = ? AND revision = ?')
      .bind(state, revision, now, tenantId, current.revision),
    env.DB.prepare(`INSERT INTO workspace_mutations (tenant_id, mutation_id, revision, created_at)
      SELECT ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM author_workspaces WHERE tenant_id = ? AND revision = ? AND state = ?
      )`)
      .bind(tenantId, input.mutationId, revision, now, tenantId, revision, state),
  ]);
  if (updated?.meta?.changes !== 1) {
    const concurrentReceipt = await env.DB.prepare('SELECT revision FROM workspace_mutations WHERE tenant_id = ? AND mutation_id = ?')
      .bind(tenantId, input.mutationId).first<{ revision: number }>();
    if (concurrentReceipt !== null) return json({ revision: concurrentReceipt.revision, idempotent: true });
    const latest = await workspaceFor(tenantId, env);
    return json({
      error: 'revision_conflict',
      revision: latest.revision,
      workspace: workspaceStateSchema.parse(JSON.parse(latest.state) as unknown),
    }, 409);
  }
  return json({ revision, idempotent: false });
}

function randomSlug(): string {
  return globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 16);
}

async function createShare(request: Request, tenantId: string, env: Env): Promise<Response> {
  let snapshot: z.infer<typeof publishedSnapshotSchema>;
  try {
    snapshot = publishedSnapshotSchema.parse(await boundedJson(request, 512 * 1024));
  } catch {
    return json({ error: 'invalid_snapshot' }, 400);
  }
  const slug = randomSlug();
  await env.DB.prepare('INSERT INTO published_snapshots_v2 (slug, owner_id, payload, created_at, revoked_at) VALUES (?, ?, ?, ?, NULL)')
    .bind(slug, tenantId, JSON.stringify(snapshot), Date.now())
    .run();
  return json({ slug, url: `/s/${slug}` }, 201);
}

async function readShare(slug: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare('SELECT payload FROM published_snapshots_v2 WHERE slug = ? AND revoked_at IS NULL')
    .bind(slug)
    .first<{ payload: string }>();
  if (row === null) return json({ error: 'not_found' }, 404);
  try {
    return json(publishedSnapshotSchema.parse(JSON.parse(row.payload) as unknown));
  } catch {
    return json({ error: 'invalid_snapshot' }, 500);
  }
}

async function revokeShare(slug: string, tenantId: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare('SELECT owner_id FROM published_snapshots_v2 WHERE slug = ? AND revoked_at IS NULL')
    .bind(slug).first<{ owner_id: string }>();
  if (row?.owner_id !== tenantId) return json({ error: 'not_found' }, 404);
  await env.DB.prepare('UPDATE published_snapshots_v2 SET revoked_at = ? WHERE slug = ? AND owner_id = ?')
    .bind(Date.now(), slug, tenantId).run();
  return new Response(null, { status: 204, headers: SECURITY_HEADERS });
}

async function listShares(tenantId: string, env: Env): Promise<Response> {
  const rows = await env.DB.prepare('SELECT slug, payload, created_at, revoked_at FROM published_snapshots_v2 WHERE owner_id = ? ORDER BY created_at DESC')
    .bind(tenantId).all<{ slug: string; payload: string; created_at: number; revoked_at: number | null }>();
  return json({ snapshots: (rows.results ?? []).map((row) => {
    const snapshot = publishedSnapshotSchema.parse(JSON.parse(row.payload) as unknown);
    return { slug: row.slug, title: snapshot.title, createdAt: row.created_at, revokedAt: row.revoked_at };
  }) });
}

async function downloadArchive(tenantId: string, env: Env): Promise<Response> {
  const row = await workspaceFor(tenantId, env);
  const workspace = workspaceStateSchema.parse(JSON.parse(row.state) as unknown);
  const snapshots = await env.DB.prepare('SELECT slug, payload, created_at, revoked_at FROM published_snapshots_v2 WHERE owner_id = ? ORDER BY created_at ASC')
    .bind(tenantId).all<{ slug: string; payload: string; created_at: number; revoked_at: number | null }>();
  const archive = {
    format: 'specular-archive',
    version: 1,
    exportedAt: Date.now(),
    workspace: { ...workspace, annotations: [] },
    publishedSnapshots: (snapshots.results ?? []).map((snapshot) => ({
      slug: snapshot.slug,
      createdAt: snapshot.created_at,
      revokedAt: snapshot.revoked_at,
      snapshot: publishedSnapshotSchema.parse(JSON.parse(snapshot.payload) as unknown),
    })),
  };
  return new Response(JSON.stringify(archive, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="specular-archive-${utcDay()}.json"`,
      'cache-control': 'no-store',
      ...SECURITY_HEADERS,
    },
  });
}

async function deleteAccount(tenantId: string, env: Env): Promise<Response> {
  await env.DB.prepare('DELETE FROM published_snapshots_v2 WHERE owner_id = ?').bind(tenantId).run();
  await env.DB.prepare('DELETE FROM workspace_mutations WHERE tenant_id = ?').bind(tenantId).run();
  await env.DB.prepare('DELETE FROM author_workspaces WHERE tenant_id = ?').bind(tenantId).run();
  return new Response(null, { status: 204, headers: SECURITY_HEADERS });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') return json({ ok: true });
    if (url.pathname.startsWith('/api/')) {
      const account = authorAccountFrom(request);
      if (account === null) {
        return url.pathname === '/api/session'
          ? json({ authenticated: false, signInUrl: CHATGPT_SIGN_IN_URL }, 401)
          : json({ error: 'authentication_required' }, 401);
      }
      if (!requireSameOriginMutation(request)) return json({ error: 'invalid_mutation_origin' }, 403);
      if (url.pathname === '/api/session' && request.method === 'GET') {
        try {
          const workspace = await workspaceFor(account.id, env);
          return json({
            authenticated: true,
            email: account.email,
            cacheNamespace: workspace.cache_namespace,
            signOutUrl: CHATGPT_SIGN_OUT_URL,
          });
        } catch {
          return json({ error: 'storage_failure' }, 503);
        }
      }
      if (url.pathname === '/api/workspace' && request.method === 'GET') {
        try { return await readWorkspace(account.id, env); } catch { return json({ error: 'storage_failure' }, 503); }
      }
      if (url.pathname === '/api/workspace' && request.method === 'PUT') {
        try { return await saveWorkspace(request, account.id, env); } catch { return json({ error: 'storage_failure' }, 503); }
      }
      if (url.pathname === '/api/archive' && request.method === 'GET') {
        try { return await downloadArchive(account.id, env); } catch { return json({ error: 'storage_failure' }, 503); }
      }
      if (url.pathname === '/api/account' && request.method === 'DELETE') {
        try { return await deleteAccount(account.id, env); } catch { return json({ error: 'storage_failure' }, 503); }
      }
      const inferencePaths = new Set([
        '/api/reflect',
        '/api/organize',
        '/api/dictation/transcribe',
        '/api/dictation/cleanup',
      ]);
      if (request.method === 'POST' && inferencePaths.has(url.pathname)) {
        try {
          if (!await allowInference(account.id, env)) return json({ error: 'inference_limit_reached' }, 429);
        } catch {
          return json({ error: 'storage_failure' }, 503);
        }
      }
    }
    if (url.pathname === '/api/reflect' && request.method === 'POST') {
      try { return await handleReflection(request, env); } catch { return json({ error: 'provider_unavailable' }, 503); }
    }
    if (url.pathname === '/api/organize' && request.method === 'POST') {
      try { return await handleOrganization(request, env); } catch { return json({ error: 'provider_unavailable' }, 503); }
    }
    if (url.pathname === '/api/dictation/transcribe' && request.method === 'POST') {
      try { return await handleTranscription(request, env); } catch { return json({ error: 'provider_unavailable' }, 503); }
    }
    if (url.pathname === '/api/dictation/cleanup' && request.method === 'POST') {
      try { return await handleCleanup(request, env); } catch { return json({ error: 'provider_unavailable' }, 503); }
    }
    if (url.pathname === '/api/shares' && request.method === 'POST') {
      const account = authorAccountFrom(request);
      if (account === null) return json({ error: 'authentication_required' }, 401);
      try { return await createShare(request, account.id, env); } catch { return json({ error: 'storage_failure' }, 503); }
    }
    if (url.pathname === '/api/shares' && request.method === 'GET') {
      const account = authorAccountFrom(request);
      if (account === null) return json({ error: 'authentication_required' }, 401);
      try { return await listShares(account.id, env); } catch { return json({ error: 'storage_failure' }, 503); }
    }
    const shareMatch = /^\/api\/shares\/([a-z0-9]{16})$/u.exec(url.pathname);
    if (shareMatch?.[1] !== undefined && request.method === 'GET') {
      try { return await readShare(shareMatch[1], env); } catch { return json({ error: 'storage_failure' }, 503); }
    }
    if (shareMatch?.[1] !== undefined && request.method === 'DELETE') {
      const account = authorAccountFrom(request);
      if (account === null) return json({ error: 'authentication_required' }, 401);
      try { return await revokeShare(shareMatch[1], account.id, env); } catch { return json({ error: 'storage_failure' }, 503); }
    }
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404 || !url.pathname.startsWith('/s/')) {
      return withSecurityHeaders(asset);
    }
    return withSecurityHeaders(await env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request)));
  },
};

export default worker;
