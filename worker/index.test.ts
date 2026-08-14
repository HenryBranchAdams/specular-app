import { describe, expect, it } from 'vitest';
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
  it('reports health without a model credential and keeps reflection unavailable', async () => {
    const env = environment();
    const health = await worker.fetch(new Request('https://specular.test/healthz'), env);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ ok: true });

    const reflection = await worker.fetch(new Request('https://specular.test/api/reflect', { method: 'POST' }), env);
    expect(reflection.status).toBe(503);
    await expect(reflection.json()).resolves.toEqual({ error: 'provider_unavailable' });
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
