import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index';

class MemoryDatabase {
  readonly rows = new Map<string, string>();

  prepare(query: string) {
    let values: unknown[] = [];
    return {
      bind: (...next: unknown[]) => {
        values = next;
        return this.prepareBound(query, () => values);
      },
      first: () => Promise.resolve(null),
      run: () => Promise.resolve({ success: true }),
    };
  }

  private prepareBound(query: string, readValues: () => unknown[]) {
    return {
      bind: (...next: unknown[]) => this.prepareBound(query, () => next),
      first: <T>() => {
        if (!query.startsWith('SELECT payload')) return Promise.resolve(null);
        const payload = this.rows.get(String(readValues()[0]));
        return Promise.resolve((payload === undefined ? null : { payload }) as T | null);
      },
      run: () => {
        if (query.startsWith('INSERT INTO published_snapshots')) {
          const [slug, payload] = readValues();
          this.rows.set(String(slug), String(payload));
        }
        return Promise.resolve({ success: true });
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

describe('Sites worker', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('reports health without a model credential and keeps reflection unavailable', async () => {
    const env = environment();
    const health = await worker.fetch(new Request('https://specular.test/healthz'), env);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ ok: true });
    expect(health.headers.get('permissions-policy')).toContain('microphone=(self)');

    const reflection = await worker.fetch(new Request('https://specular.test/api/reflect', { method: 'POST' }), env);
    expect(reflection.status).toBe(503);
    await expect(reflection.json()).resolves.toEqual({ error: 'provider_unavailable' });
  });

  it('organizes titles and kinds without allowing em dashes through', async () => {
    const provider = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({
        title: 'Attention—without certainty',
        kinds: [{ id: 'block:one', kind: 'hypothesis' }],
      }) }] }],
    }), { status: 200 })));
    vi.stubGlobal('fetch', provider);

    const response = await worker.fetch(new Request('https://specular.test/api/organize', {
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

    const response = await worker.fetch(new Request('https://specular.test/api/reflect', {
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

    const response = await worker.fetch(new Request('https://specular.test/api/dictation/transcribe', {
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

    const response = await worker.fetch(new Request('https://specular.test/api/dictation/transcribe', {
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

    const response = await worker.fetch(new Request('https://specular.test/api/dictation/cleanup', {
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

  it('publishes and reads an immutable user-authored snapshot', async () => {
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
    const created = await worker.fetch(new Request('https://specular.test/api/shares', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }), env);
    expect(created.status).toBe(201);
    const body = await created.json() as { slug: string };
    expect(body.slug).toMatch(/^[a-z0-9]{16}$/u);

    const loaded = await worker.fetch(new Request(`https://specular.test/api/shares/${body.slug}`), env);
    expect(loaded.status).toBe(200);
    await expect(loaded.json()).resolves.toEqual(payload);
  });
});
