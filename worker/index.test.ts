import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index';

class MemoryDatabase {
  readonly rows = new Map<string, { payload: string; owner_id: string; created_at: number; revoked_at: number | null }>();
  readonly workspaces = new Map<string, { cache_namespace: string; revision: number; state: string }>();
  readonly mutations = new Map<string, number>();
  readonly usage = new Map<string, number>();
  failNextWorkspaceUpdate = false;
  failNextMutationInsert = false;
  raceWithIdenticalWorkspaceUpdate = false;

  async batch(statements: { run: () => Promise<{ success: boolean; meta?: { changes?: number } }> }[]) {
    const workspaceSnapshot = structuredClone([...this.workspaces]);
    const mutationSnapshot = structuredClone([...this.mutations]);
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    } catch (error) {
      this.workspaces.clear();
      for (const [key, value] of workspaceSnapshot) this.workspaces.set(key, value);
      this.mutations.clear();
      for (const [key, value] of mutationSnapshot) this.mutations.set(key, value);
      throw error;
    }
  }

  prepare(query: string) {
    let values: unknown[] = [];
    return {
      bind: (...next: unknown[]) => {
        values = next;
        return this.prepareBound(query, () => values);
      },
      first: () => Promise.resolve(null),
      run: () => Promise.resolve({ success: true }),
      // The fake mirrors D1's generic projection API.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
      all: <T>() => Promise.resolve({ success: true, results: [] as T[] }),
    };
  }

  private prepareBound(query: string, readValues: () => unknown[]) {
    return {
      bind: (...next: unknown[]) => this.prepareBound(query, () => next),
      first: <T>() => {
        if (query.startsWith('SELECT payload')) {
          const row = this.rows.get(String(readValues()[0]));
          return Promise.resolve((row?.revoked_at !== null ? null : { payload: row.payload }) as T | null);
        }
        if (query.startsWith('SELECT owner_id')) {
          const row = this.rows.get(String(readValues()[0]));
          return Promise.resolve((row ?? null) as T | null);
        }
        if (query.startsWith('SELECT cache_namespace')) {
          return Promise.resolve((this.workspaces.get(String(readValues()[0])) ?? null) as T | null);
        }
        if (query.startsWith('SELECT revision FROM workspace_mutations')) {
          const [tenantId, mutationId] = readValues();
          const revision = this.mutations.get(`${String(tenantId)}:${String(mutationId)}`);
          return Promise.resolve((revision === undefined ? null : { revision }) as T | null);
        }
        if (query.startsWith('INSERT INTO inference_daily_usage')) {
          const [day, tenantKey, , , globalMaximum, , tenantMaximum] = readValues();
          const globalKey = `__global__:${String(day)}`;
          const accountKey = `${String(tenantKey)}:${String(day)}`;
          const globalCount = this.usage.get(globalKey) ?? 0;
          const tenantCount = this.usage.get(accountKey) ?? 0;
          if (globalCount >= Number(globalMaximum) || tenantCount >= Number(tenantMaximum)) return Promise.resolve(null);
          this.usage.set(globalKey, globalCount + 1);
          this.usage.set(accountKey, tenantCount + 1);
          return Promise.resolve({ global_count: globalCount + 1 } as T);
        }
        return Promise.resolve(null);
      },
      run: () => {
        let changes: number | undefined;
        if (query.startsWith('INSERT INTO published_snapshots_v2')) {
          const [slug, ownerId, payload, createdAt] = readValues();
          this.rows.set(String(slug), { payload: String(payload), owner_id: String(ownerId), created_at: Number(createdAt), revoked_at: null });
        }
        if (query.startsWith('UPDATE published_snapshots_v2')) {
          const [revokedAt, slug, ownerId] = readValues();
          const row = this.rows.get(String(slug));
          if (row?.owner_id === String(ownerId)) row.revoked_at = Number(revokedAt);
        }
        if (query.startsWith('INSERT INTO author_workspaces')) {
          const [tenantId, cacheNamespace, revision, state] = readValues();
          if (!this.workspaces.has(String(tenantId))) this.workspaces.set(String(tenantId), {
            cache_namespace: String(cacheNamespace), revision: Number(revision), state: String(state),
          });
        }
        if (query.startsWith('UPDATE author_workspaces')) {
          const [state, revision, , tenantId, expectedRevision] = readValues();
          const current = this.workspaces.get(String(tenantId));
          if (this.raceWithIdenticalWorkspaceUpdate && current !== undefined) {
            this.raceWithIdenticalWorkspaceUpdate = false;
            this.workspaces.set(String(tenantId), { ...current, state: String(state), revision: Number(revision) });
            changes = 0;
          } else if (this.failNextWorkspaceUpdate) {
            this.failNextWorkspaceUpdate = false;
            changes = 0;
          } else if (current?.revision === Number(expectedRevision)) {
            this.workspaces.set(String(tenantId), { ...current, state: String(state), revision: Number(revision) });
            changes = 1;
          } else changes = 0;
        }
        if (query.startsWith('INSERT INTO workspace_mutations')) {
          if (this.failNextMutationInsert) {
            this.failNextMutationInsert = false;
            return Promise.reject(new Error('mutation receipt unavailable'));
          }
          const [tenantId, mutationId, revision, , checkTenantId, checkRevision, checkState] = readValues();
          const current = this.workspaces.get(String(checkTenantId ?? tenantId));
          if (checkTenantId === undefined || (current?.revision === Number(checkRevision) && current.state === String(checkState))) {
            this.mutations.set(`${String(tenantId)}:${String(mutationId)}`, Number(revision));
          }
        }
        if (query.startsWith('DELETE FROM author_workspaces')) this.workspaces.delete(String(readValues()[0]));
        if (query.startsWith('DELETE FROM workspace_mutations')) {
          const prefix = `${String(readValues()[0])}:`;
          for (const key of this.mutations.keys()) if (key.startsWith(prefix)) this.mutations.delete(key);
        }
        if (query.startsWith('DELETE FROM published_snapshots_v2')) {
          const ownerId = String(readValues()[0]);
          for (const [slug, row] of this.rows) if (row.owner_id === ownerId) this.rows.delete(slug);
        }
        if (query.startsWith('UPDATE published_snapshots_v2') && query.includes('owner_id = ? AND revoked_at')) {
          const [revokedAt, ownerId] = readValues();
          for (const row of this.rows.values()) if (row.owner_id === String(ownerId)) row.revoked_at = Number(revokedAt);
        }
        return Promise.resolve({ success: true, ...(changes === undefined ? {} : { meta: { changes } }) });
      },
      // The fake mirrors D1's generic projection API.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
      all: <T>() => {
        if (query.startsWith('SELECT slug, payload')) {
          const ownerId = String(readValues()[0]);
          return Promise.resolve({ success: true, results: [...this.rows.entries()].flatMap(([slug, row]) => row.owner_id === ownerId
            ? [{ slug, payload: row.payload, created_at: row.created_at, revoked_at: row.revoked_at }]
            : []) as T[] });
        }
        return Promise.resolve({ success: true, results: [] as T[] });
      },
    };
  }
}

function environment(database = new MemoryDatabase()) {
  return {
    ASSETS: { fetch: () => Promise.resolve(new Response('asset', { status: 200 })) },
    DB: database,
  };
}

const AUTHOR_HEADERS = {
  'oai-authenticated-user-id': 'site-user-one',
  'oai-authenticated-user-email': 'writer@example.com',
} as const;

function protectedRequest(path: string, init: RequestInit = {}, authorHeaders: Readonly<Record<string, string>> = AUTHOR_HEADERS): Request {
  const method = init.method ?? 'GET';
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(authorHeaders)) headers.set(name, value);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
    headers.set('origin', 'https://specular.test');
    headers.set('x-specular-intent', 'mutate');
  }
  return new Request(`https://specular.test${path}`, { ...init, method, headers });
}

describe('Sites worker', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('reports health without a model credential and keeps reflection unavailable', async () => {
    const env = environment();
    const health = await worker.fetch(new Request('https://specular.test/healthz'), env);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ ok: true });
    expect(health.headers.get('permissions-policy')).toContain('microphone=(self)');

    const reflection = await worker.fetch(protectedRequest('/api/reflect', { method: 'POST' }), env);
    expect(reflection.status).toBe(503);
    await expect(reflection.json()).resolves.toEqual({ error: 'provider_unavailable' });
  });

  it('fails closed when ChatGPT identity is missing', async () => {
    const session = await worker.fetch(new Request('https://specular.test/api/session'), environment());
    expect(session.status).toBe(401);
    await expect(session.json()).resolves.toEqual({
      authenticated: false,
      signInUrl: '/signin-with-chatgpt?return_to=%2F',
    });

    const reflection = await worker.fetch(new Request('https://specular.test/api/reflect', {
      method: 'POST',
      headers: { origin: 'https://specular.test', 'x-specular-intent': 'mutate' },
    }), environment());
    expect(reflection.status).toBe(401);
    await expect(reflection.json()).resolves.toEqual({ error: 'authentication_required' });
  });

  it('projects only display-safe account metadata into the browser session', async () => {
    const response = await worker.fetch(protectedRequest('/api/session'), environment());
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      authenticated: true,
      email: 'writer@example.com',
      signOutUrl: '/signout-with-chatgpt?return_to=%2F',
    });
    expect(body.cacheNamespace).toEqual(expect.stringMatching(/^account:/u));
    expect(JSON.stringify(body)).not.toContain('site-user-one');
  });

  it('requires verified id and email headers together', async () => {
    const response = await worker.fetch(new Request('https://specular.test/api/session', {
      headers: { 'oai-authenticated-user-id': 'site-user-one' },
    }), environment());
    expect(response.status).toBe(401);
  });

  it('rejects cross-origin or unmarked mutations before reading their payload', async () => {
    const missingIntent = await worker.fetch(new Request('https://specular.test/api/organize', {
      method: 'POST',
      headers: { ...AUTHOR_HEADERS, origin: 'https://specular.test' },
    }), environment());
    expect(missingIntent.status).toBe(403);

    const crossOrigin = await worker.fetch(new Request('https://specular.test/api/organize', {
      method: 'POST',
      headers: { ...AUTHOR_HEADERS, origin: 'https://attacker.example', 'x-specular-intent': 'mutate' },
    }), environment());
    expect(crossOrigin.status).toBe(403);
  });

  it('creates one isolated server workspace per ChatGPT account', async () => {
    const database = new MemoryDatabase();
    const env = environment(database);
    const first = await worker.fetch(protectedRequest('/api/workspace'), env);
    const second = await worker.fetch(protectedRequest('/api/workspace', {}, {
      'oai-authenticated-user-id': 'site-user-two',
      'oai-authenticated-user-email': 'other@example.com',
    }), env);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = await first.json() as { cacheNamespace: string; revision: number; workspace: unknown };
    const secondBody = await second.json() as { cacheNamespace: string; revision: number; workspace: unknown };
    expect(firstBody.revision).toBe(0);
    expect(secondBody.revision).toBe(0);
    expect([...database.workspaces.keys()]).toEqual(['site-user-one', 'site-user-two']);
    expect(firstBody.cacheNamespace).not.toBe(secondBody.cacheNamespace);
    expect(database.workspaces).toHaveLength(2);
  });

  it('checks workspace revisions and makes retried mutation ids idempotent', async () => {
    const database = new MemoryDatabase();
    const env = environment(database);
    const opened = await worker.fetch(protectedRequest('/api/workspace'), env);
    const initial = await opened.json() as { workspace: Record<string, unknown> };
    const changed = structuredClone(initial.workspace);
    const documents = changed.documents as { title: string }[];
    documents[0] = { ...documents[0], title: 'A private revision' };
    const openedBody = await worker.fetch(protectedRequest('/api/workspace'), env).then((response) => response.json()) as { cacheNamespace: string };
    const payload = { cacheNamespace: openedBody.cacheNamespace, baseRevision: 0, mutationId: 'mutation-one', workspace: changed };

    const saved = await worker.fetch(protectedRequest('/api/workspace', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    }), env);
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({ revision: 1 });

    const retried = await worker.fetch(protectedRequest('/api/workspace', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    }), env);
    expect(retried.status).toBe(200);
    await expect(retried.json()).resolves.toMatchObject({ revision: 1, idempotent: true });

    const stale = await worker.fetch(protectedRequest('/api/workspace', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, mutationId: 'mutation-two' }),
    }), env);
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: 'revision_conflict', revision: 1 });
  });

  it('applies content-free inference limits per tenant', async () => {
    const database = new MemoryDatabase();
    const env = { ...environment(database), OPENAI_API_KEY: 'test-key', INFERENCE_DAILY_LIMIT: '1' };
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({ title: 'One', kinds: [] }) }] }],
    }), { status: 200 }))));
    const body = JSON.stringify({ documentId: 'document:one', blocks: [{ id: 'block:one', content: 'One thought.' }] });

    const first = await worker.fetch(protectedRequest('/api/organize', { method: 'POST', headers: { 'content-type': 'application/json' }, body }), env);
    const limited = await worker.fetch(protectedRequest('/api/organize', { method: 'POST', headers: { 'content-type': 'application/json' }, body }), env);
    const other = await worker.fetch(protectedRequest('/api/organize', { method: 'POST', headers: { 'content-type': 'application/json' }, body }, {
      'oai-authenticated-user-id': 'site-user-two', 'oai-authenticated-user-email': 'other@example.com',
    }), env);

    expect(first.status).toBe(200);
    expect(limited.status).toBe(429);
    expect(other.status).toBe(200);
    expect([...database.usage.keys()].every((key) => !key.includes('One thought'))).toBe(true);
  });

  it('reserves global and per-account inference capacity in one atomic counter update', async () => {
    const database = new MemoryDatabase();
    const env = {
      ...environment(database),
      OPENAI_API_KEY: 'test-key',
      INFERENCE_DAILY_LIMIT: '5',
      INFERENCE_GLOBAL_DAILY_LIMIT: '1',
    };
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({ title: 'One', kinds: [] }) }] }],
    }), { status: 200 }))));
    const body = JSON.stringify({ documentId: 'document:one', blocks: [{ id: 'block:one', content: 'One thought.' }] });
    const first = await worker.fetch(protectedRequest('/api/organize', { method: 'POST', headers: { 'content-type': 'application/json' }, body }), env);
    const rejected = await worker.fetch(protectedRequest('/api/organize', { method: 'POST', headers: { 'content-type': 'application/json' }, body }, {
      'oai-authenticated-user-id': 'site-user-two', 'oai-authenticated-user-email': 'other@example.com',
    }), env);

    expect(first.status).toBe(200);
    expect(rejected.status).toBe(429);
    expect([...database.usage.keys()].filter((key) => !key.startsWith('__global__:'))).toHaveLength(1);
  });

  it('does not acknowledge a workspace write when its conditional update loses a race', async () => {
    const database = new MemoryDatabase();
    const env = environment(database);
    const opened = await worker.fetch(protectedRequest('/api/workspace'), env);
    const openedBody = await opened.json() as { cacheNamespace: string; revision: number; workspace: unknown };
    database.failNextWorkspaceUpdate = true;

    const response = await worker.fetch(protectedRequest('/api/workspace', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cacheNamespace: openedBody.cacheNamespace,
        baseRevision: openedBody.revision,
        mutationId: 'losing-mutation',
        workspace: openedBody.workspace,
      }),
    }), env);

    expect(response.status).toBe(409);
    expect(database.mutations.has('site-user-one:losing-mutation')).toBe(false);
  });

  it('rolls back an accepted workspace update when its idempotency receipt cannot commit', async () => {
    const database = new MemoryDatabase();
    const env = environment(database);
    const opened = await worker.fetch(protectedRequest('/api/workspace'), env);
    const openedBody = await opened.json() as { cacheNamespace: string; revision: number; workspace: unknown };
    database.failNextMutationInsert = true;

    const response = await worker.fetch(protectedRequest('/api/workspace', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cacheNamespace: openedBody.cacheNamespace,
        baseRevision: openedBody.revision,
        mutationId: 'atomic-mutation',
        workspace: openedBody.workspace,
      }),
    }), env);

    expect(response.status).toBe(503);
    expect(database.workspaces.get('site-user-one')?.revision).toBe(0);
    expect(database.mutations.has('site-user-one:atomic-mutation')).toBe(false);
  });

  it('treats an identical concurrent workspace winner as an idempotent acknowledgement', async () => {
    const database = new MemoryDatabase();
    const env = environment(database);
    const opened = await worker.fetch(protectedRequest('/api/workspace'), env);
    const openedBody = await opened.json() as { cacheNamespace: string; revision: number; workspace: unknown };
    database.raceWithIdenticalWorkspaceUpdate = true;

    const response = await worker.fetch(protectedRequest('/api/workspace', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cacheNamespace: openedBody.cacheNamespace,
        baseRevision: openedBody.revision,
        mutationId: 'identical-concurrent-mutation',
        workspace: openedBody.workspace,
      }),
    }), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ revision: 1, idempotent: true });
  });

  it('organizes titles and kinds without allowing em dashes through', async () => {
    const provider = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({
        title: 'Attention—without certainty',
        kinds: [{ id: 'block:one', kind: 'hypothesis' }],
      }) }] }],
    }), { status: 200 })));
    vi.stubGlobal('fetch', provider);

    const response = await worker.fetch(protectedRequest('/api/organize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentId: 'document:one', blocks: [{ id: 'block:one', content: 'Attention may matter without becoming certainty.' }] }),
    }), { ...environment(), OPENAI_API_KEY: 'test-key' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      title: 'Attention: without certainty',
      kinds: [{ id: 'block:one', kind: 'hypothesis' }],
    });
    const providerBody = provider.mock.calls[0]?.[1]?.body;
    if (typeof providerBody !== 'string') throw new Error('Expected organization JSON.');
    expect(JSON.parse(providerBody)).toMatchObject({ store: false });
  });

  it('repairs em dashes in model reflection prose but not source material', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({
        mirror: 'Attention—without certainty.',
        directions: [{ label: 'Test—the edge', prompt: 'What changes—if attention matters?', move: 'challenge' }],
        referencedBlockIds: ['block:one'],
        sources: [{ title: 'Source—title', url: 'https://example.com/source', excerpt: 'Quoted—material.' }],
      }) }] }],
    }), { status: 200 }))));

    const response = await worker.fetch(protectedRequest('/api/reflect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        focus: 'Attention matters.',
        focusBlockId: 'block:one',
        move: 'perspective',
        scope: 'document',
        blocks: [{ id: 'block:one', content: 'Attention matters.', kind: 'thought' }],
      }),
    }), { ...environment(), OPENAI_API_KEY: 'test-key' });

    const result = await response.json() as { mirror: string; directions: { label: string; prompt: string }[]; sources: { title: string; excerpt: string }[] };
    expect(result.mirror).toBe('Attention: without certainty.');
    expect(result.directions[0]).toMatchObject({ label: 'Test: the edge', prompt: 'What changes: if attention matters?' });
    expect(result.sources[0]).toMatchObject({ title: 'Source—title', excerpt: 'Quoted—material.' });
  });

  it('proxies a bounded audio checkpoint to the transcription endpoint', async () => {
    const provider = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response(JSON.stringify({ text: 'A checkpointed thought.' }), { status: 200 })));
    vi.stubGlobal('fetch', provider);
    const form = new FormData();
    form.set('audio', new Blob(['audio'], { type: 'audio/webm' }), 'checkpoint.webm');

    const response = await worker.fetch(protectedRequest('/api/dictation/transcribe', {
      method: 'POST',
      body: form,
    }), { ...environment(), OPENAI_API_KEY: 'test-key' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ transcript: 'A checkpointed thought.' });
    expect(provider).toHaveBeenCalledWith('https://api.openai.com/v1/audio/transcriptions', expect.objectContaining({ method: 'POST' }));
    const providerForm = provider.mock.calls[0]?.[1]?.body as FormData;
    expect(providerForm.get('model')).toBe('gpt-4o-mini-transcribe');
    expect(providerForm.get('language')).toBe('en');
    expect(providerForm.get('file')).toBeInstanceOf(Blob);
  });

  it('treats an empty provider transcript as a successful silent checkpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ text: '' }), { status: 200 }))));
    const form = new FormData();
    form.set('audio', new Blob(['audio'], { type: 'audio/webm' }), 'checkpoint.webm');

    const response = await worker.fetch(protectedRequest('/api/dictation/transcribe', {
      method: 'POST',
      body: form,
    }), { ...environment(), OPENAI_API_KEY: 'test-key' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ transcript: '' });
  });

  it('runs faithful cleanup separately with storage disabled', async () => {
    const provider = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({ cleaned: 'The thought is clearer.' }) }] }],
    }), { status: 200 })));
    vi.stubGlobal('fetch', provider);

    const response = await worker.fetch(protectedRequest('/api/dictation/cleanup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ verbatim: 'Um, the thought is clearer.' }),
    }), { ...environment(), OPENAI_API_KEY: 'test-key' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ cleaned: 'The thought is clearer.' });
    const providerBody = provider.mock.calls[0]?.[1]?.body;
    if (typeof providerBody !== 'string') throw new Error('Expected a JSON provider body.');
    const request = JSON.parse(providerBody) as Record<string, unknown>;
    expect(request).toMatchObject({ store: false });
    expect(String(request.instructions)).toContain('Never summarize, reorder, add, complete, or reinterpret');
  });

  it('publishes a signed-in link that another signed-in reader can open', async () => {
    const database = new MemoryDatabase();
    const env = environment(database);
    const payload = {
      title: 'Attention without certainty',
      createdAt: 1_800_000_000_000,
      blocks: [{
        id: 'block:one',
        content: 'Attention can justify another look without becoming proof.',
        kind: 'thought',
        references: [],
      }],
    };
    const created = await worker.fetch(protectedRequest('/api/shares', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }), env);
    expect(created.status).toBe(201);
    const body = await created.json() as { slug: string };
    expect(body.slug).toMatch(/^[a-z0-9]{16}$/u);

    const listed = await worker.fetch(protectedRequest('/api/shares'), env);
    await expect(listed.json()).resolves.toMatchObject({ snapshots: [{ slug: body.slug, title: payload.title }] });
    const otherList = await worker.fetch(protectedRequest('/api/shares', {}, {
      'oai-authenticated-user-id': 'site-user-two', 'oai-authenticated-user-email': 'other@example.com',
    }), env);
    await expect(otherList.json()).resolves.toEqual({ snapshots: [] });

    const loaded = await worker.fetch(protectedRequest(`/api/shares/${body.slug}`, {}, {
      'oai-authenticated-user-id': 'site-user-two', 'oai-authenticated-user-email': 'other@example.com',
    }), env);
    expect(loaded.status).toBe(200);
    await expect(loaded.json()).resolves.toEqual(payload);
  });

  it('allows only the snapshot owner to revoke a published link', async () => {
    const database = new MemoryDatabase();
    const env = environment(database);
    const payload = {
      title: 'Revocable thought', createdAt: 1_800_000_000_000,
      blocks: [{ id: 'block:one', content: 'Authored words.', kind: 'thought', references: [] }],
    };
    const created = await worker.fetch(protectedRequest('/api/shares', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    }), env);
    const { slug } = await created.json() as { slug: string };

    const forbidden = await worker.fetch(protectedRequest(`/api/shares/${slug}`, { method: 'DELETE' }, {
      'oai-authenticated-user-id': 'site-user-two', 'oai-authenticated-user-email': 'other@example.com',
    }), env);
    expect(forbidden.status).toBe(404);

    const revoked = await worker.fetch(protectedRequest(`/api/shares/${slug}`, { method: 'DELETE' }), env);
    expect(revoked.status).toBe(204);
    const loaded = await worker.fetch(protectedRequest(`/api/shares/${slug}`), env);
    expect(loaded.status).toBe(404);
  });

  it('downloads a content archive without ChatGPT identity or interlocutor annotations', async () => {
    const database = new MemoryDatabase();
    const env = environment(database);
    const opened = await worker.fetch(protectedRequest('/api/workspace'), env);
    const { workspace } = await opened.json() as { workspace: Record<string, unknown> };
    const documents = workspace.documents as { id: string }[];
    const blocks = workspace.blocks as { id: string }[];
    const documentId = documents[0]?.id;
    const blockId = blocks[0]?.id;
    if (documentId === undefined || blockId === undefined) throw new Error('Expected archive fixture workspace.');
    workspace.annotations = [{
      id: 'annotation:one', documentId, blockId,
      focus: 'Authored focus', move: 'reflect', mirror: 'interlocutor',
      directions: [{ label: 'Clarify', prompt: 'What is unclear?', move: 'clarify' }],
      referencedBlockIds: [blockId], sources: [], calibration: [], status: 'open',
      createdAt: 1_800_000_000_000, updatedAt: 1_800_000_000_000,
    }];
    await worker.fetch(protectedRequest('/api/workspace', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cacheNamespace: (await worker.fetch(protectedRequest('/api/workspace'), env).then((response) => response.json()) as { cacheNamespace: string }).cacheNamespace, baseRevision: 0, mutationId: 'archive-save', workspace }),
    }), env);

    const otherHeaders = {
      'oai-authenticated-user-id': 'site-user-two',
      'oai-authenticated-user-email': 'other@example.com',
    } as const;
    const otherOpened = await worker.fetch(protectedRequest('/api/workspace', {}, otherHeaders), env);
    const other = await otherOpened.json() as { cacheNamespace: string; workspace: Record<string, unknown> };
    const otherDocuments = other.workspace.documents as Record<string, unknown>[];
    const otherFirstDocument = otherDocuments[0];
    if (otherFirstDocument === undefined) throw new Error('Expected a second-account archive fixture.');
    otherDocuments[0] = { ...otherFirstDocument, title: 'Other account private marker', titleSource: 'author' };
    await worker.fetch(protectedRequest('/api/workspace', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cacheNamespace: other.cacheNamespace, baseRevision: 0, mutationId: 'other-archive-save', workspace: other.workspace }),
    }, otherHeaders), env);

    const archive = await worker.fetch(protectedRequest('/api/archive'), env);
    expect(archive.status).toBe(200);
    expect(archive.headers.get('content-disposition')).toContain('specular-archive');
    const text = await archive.text();
    expect(text).not.toContain('site-user-one');
    expect(text).not.toContain('writer@example.com');
    expect(text).not.toContain('interlocutor');
    expect(text).not.toContain('Other account private marker');
  });

  it('deletes only the current account workspace and revokes its links', async () => {
    const database = new MemoryDatabase();
    const env = environment(database);
    const first = await worker.fetch(protectedRequest('/api/workspace'), env);
    const firstBody = await first.json() as { cacheNamespace: string; workspace: unknown };
    await worker.fetch(protectedRequest('/api/workspace', {}, {
      'oai-authenticated-user-id': 'site-user-two', 'oai-authenticated-user-email': 'other@example.com',
    }), env);

    const deleted = await worker.fetch(protectedRequest('/api/account', { method: 'DELETE' }), env);
    expect(deleted.status).toBe(204);
    expect(database.workspaces.has('site-user-one')).toBe(false);
    expect(database.workspaces.has('site-user-two')).toBe(true);

    const reopened = await worker.fetch(protectedRequest('/api/workspace'), env);
    const reopenedBody = await reopened.json() as { cacheNamespace: string };
    expect(reopenedBody.cacheNamespace).not.toBe(firstBody.cacheNamespace);
    const stale = await worker.fetch(protectedRequest('/api/workspace', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cacheNamespace: firstBody.cacheNamespace, baseRevision: 0, mutationId: 'stale-device', workspace: firstBody.workspace }),
    }), env);
    expect(stale.status).toBe(410);
  });
});
