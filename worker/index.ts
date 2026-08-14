import { z } from 'zod';
import {
  contextScopeSchema,
  reflectionMoveSchema,
} from '../src/thinking/model';
import { reflectionResponseSchema } from '../src/thinking/reflect-client';

interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatement;
}

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetFetcher;
  DB: D1DatabaseLike;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
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
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
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
    return json(reflectionResponseSchema.parse(JSON.parse(output) as unknown));
  } catch {
    return json({ error: 'invalid_output' }, 502);
  }
}

let shareSchemaReady: Promise<void> | undefined;

function ensureShareSchema(database: D1DatabaseLike): Promise<void> {
  shareSchemaReady ??= database.prepare(`CREATE TABLE IF NOT EXISTS published_snapshots (
    slug TEXT PRIMARY KEY NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`).run().then(() => undefined);
  return shareSchemaReady;
}

function randomSlug(): string {
  return globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 16);
}

async function createShare(request: Request, env: Env): Promise<Response> {
  let snapshot: z.infer<typeof publishedSnapshotSchema>;
  try {
    snapshot = publishedSnapshotSchema.parse(await boundedJson(request, 512 * 1024));
  } catch {
    return json({ error: 'invalid_snapshot' }, 400);
  }
  await ensureShareSchema(env.DB);
  const slug = randomSlug();
  await env.DB.prepare('INSERT INTO published_snapshots (slug, payload, created_at) VALUES (?, ?, ?)')
    .bind(slug, JSON.stringify(snapshot), Date.now())
    .run();
  return json({ slug, url: `/s/${slug}` }, 201);
}

async function readShare(slug: string, env: Env): Promise<Response> {
  await ensureShareSchema(env.DB);
  const row = await env.DB.prepare('SELECT payload FROM published_snapshots WHERE slug = ?')
    .bind(slug)
    .first<{ payload: string }>();
  if (row === null) return json({ error: 'not_found' }, 404);
  try {
    return json(publishedSnapshotSchema.parse(JSON.parse(row.payload) as unknown));
  } catch {
    return json({ error: 'invalid_snapshot' }, 500);
  }
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') return json({ ok: true });
    if (url.pathname === '/api/reflect' && request.method === 'POST') {
      try { return await handleReflection(request, env); } catch { return json({ error: 'provider_unavailable' }, 503); }
    }
    if (url.pathname === '/api/shares' && request.method === 'POST') {
      try { return await createShare(request, env); } catch { return json({ error: 'storage_failure' }, 503); }
    }
    const shareMatch = /^\/api\/shares\/([a-z0-9]{16})$/u.exec(url.pathname);
    if (shareMatch?.[1] !== undefined && request.method === 'GET') {
      try { return await readShare(shareMatch[1], env); } catch { return json({ error: 'storage_failure' }, 503); }
    }
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404 || !url.pathname.startsWith('/s/')) {
      return withSecurityHeaders(asset);
    }
    return withSecurityHeaders(await env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request)));
  },
};

export default worker;
