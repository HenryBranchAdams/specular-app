import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness } from 'wrangler';
import { createInitialWorkspace } from '../../src/thinking/model';

const harness = createTestHarness({
  root: process.cwd(),
  workers: [{
    configPath: './dist/server/wrangler.json',
    vars: {
      INFERENCE_DAILY_LIMIT: '2',
      INFERENCE_GLOBAL_DAILY_LIMIT: '3',
    },
    secrets: { OPENAI_API_KEY: 'synthetic-test-key' },
  }],
});
let baseUrl: URL;

const AUTHORS = {
  a: {
    'oai-authenticated-user-id': 'synthetic-site-user-a',
    'oai-authenticated-user-email': 'author-a@example.test',
  },
  b: {
    'oai-authenticated-user-id': 'synthetic-site-user-b',
    'oai-authenticated-user-email': 'author-b@example.test',
  },
} as const;

function mutationHeaders(author: typeof AUTHORS.a | typeof AUTHORS.b) {
  return {
    ...author,
    'content-type': 'application/json',
    origin: baseUrl.origin,
    'x-specular-intent': 'mutate',
  };
}

async function prepareDatabase() {
  await harness.getWorker().applyD1Migrations('DB');
}

describe('built Worker with D1', () => {
  beforeAll(async () => {
    ({ url: baseUrl } = await harness.listen());
    await prepareDatabase();
  });

  afterEach(async () => {
    await harness.reset();
    ({ url: baseUrl } = await harness.listen());
    await prepareDatabase();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('creates isolated private workspaces for two verified author accounts', async () => {
    const first = await harness.fetch('/api/session', { headers: AUTHORS.a });
    const second = await harness.fetch('/api/session', { headers: AUTHORS.b });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const firstSession = await first.json() as { cacheNamespace: string; email: string };
    const secondSession = await second.json() as { cacheNamespace: string; email: string };

    expect(firstSession.email).toBe('author-a@example.test');
    expect(secondSession.email).toBe('author-b@example.test');
    expect(firstSession.cacheNamespace).toMatch(/^account:/u);
    expect(secondSession.cacheNamespace).toMatch(/^account:/u);
    expect(firstSession.cacheNamespace).not.toBe(secondSession.cacheNamespace);

    const firstWorkspace = await harness.fetch('/api/workspace', { headers: AUTHORS.a });
    const secondWorkspace = await harness.fetch('/api/workspace', { headers: AUTHORS.b });
    expect(firstWorkspace.status).toBe(200);
    expect(secondWorkspace.status).toBe(200);
    await expect(firstWorkspace.json()).resolves.toMatchObject({ revision: 0 });
    await expect(secondWorkspace.json()).resolves.toMatchObject({ revision: 0 });
  });

  it.each([
    ['GET', '/api/session'],
    ['GET', '/api/workspace'],
    ['PUT', '/api/workspace'],
    ['GET', '/api/archive'],
    ['DELETE', '/api/account'],
    ['GET', '/api/shares'],
    ['POST', '/api/shares'],
    ['POST', '/api/reflect'],
    ['POST', '/api/organize'],
    ['POST', '/api/dictation/transcribe'],
    ['POST', '/api/dictation/cleanup'],
  ] as const)('denies anonymous %s %s before reading a body or D1 tenant state', async (method, path) => {
    const response = await harness.fetch(path, method === 'GET'
      ? { method }
      : { method, body: 'not-even-valid-json' });
    expect(response.status).toBe(401);
  });

  it('rejects authenticated mutations without the same-origin intent boundary', async () => {
    const response = await harness.fetch('/api/account', { method: 'DELETE', headers: AUTHORS.a });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_mutation_origin' });
  });

  it('does not accept another author cache namespace as a direct object reference', async () => {
    const first = await harness.fetch('/api/session', { headers: AUTHORS.a });
    const second = await harness.fetch('/api/session', { headers: AUTHORS.b });
    const firstSession = await first.json() as { cacheNamespace: string };
    const secondSession = await second.json() as { cacheNamespace: string };
    const response = await harness.fetch('/api/workspace', {
      method: 'PUT',
      headers: {
        ...AUTHORS.a,
        'content-type': 'application/json',
        origin: baseUrl.origin,
        'x-specular-intent': 'mutate',
      },
      body: JSON.stringify({
        cacheNamespace: secondSession.cacheNamespace,
        baseRevision: 0,
        mutationId: 'foreign-cache-namespace',
        workspace: createInitialWorkspace(1_800_000_000_000),
      }),
    });

    expect(firstSession.cacheNamespace).not.toBe(secondSession.cacheNamespace);
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({ error: 'stale_workspace_generation' });
  });

  it('accepts exactly one of two concurrent writes based on the same D1 revision', async () => {
    const sessionResponse = await harness.fetch('/api/session', { headers: AUTHORS.a });
    const session = await sessionResponse.json() as { cacheNamespace: string };
    const north = createInitialWorkspace(1_800_000_000_000);
    const south = structuredClone(north);
    if (north.documents[0] === undefined || south.documents[0] === undefined) throw new Error('fixture');
    north.documents[0].title = 'North';
    south.documents[0].title = 'South';
    const headers = {
      ...AUTHORS.a,
      'content-type': 'application/json',
      origin: baseUrl.origin,
      'x-specular-intent': 'mutate',
    };

    const [first, second] = await Promise.all([
      harness.fetch('/api/workspace', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          cacheNamespace: session.cacheNamespace,
          baseRevision: 0,
          mutationId: 'concurrent-north',
          workspace: north,
        }),
      }),
      harness.fetch('/api/workspace', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          cacheNamespace: session.cacheNamespace,
          baseRevision: 0,
          mutationId: 'concurrent-south',
          workspace: south,
        }),
      }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const persisted = await harness.fetch('/api/workspace', { headers: AUTHORS.a });
    const body = await persisted.json() as { revision: number; workspace: ReturnType<typeof createInitialWorkspace> };
    expect(body.revision).toBe(1);
    expect(['North', 'South']).toContain(body.workspace.documents[0]?.title);
  });

  it('enforces tenant and global inference reservations atomically in D1', async () => {
    const request = async (author: typeof AUTHORS.a | typeof AUTHORS.b) => {
      const response = await harness.getWorker().fetch('/api/reflect', {
        method: 'POST',
        headers: {
          ...author,
          'content-type': 'application/json',
          origin: baseUrl.origin,
          'x-specular-intent': 'mutate',
        },
        body: '{}',
      });
      return { status: response.status, body: await response.text() };
    };

    const attempts = await Promise.all([
      request(AUTHORS.a), request(AUTHORS.a), request(AUTHORS.a),
      request(AUTHORS.b), request(AUTHORS.b),
    ]);
    const allowedBody = JSON.stringify({ error: 'invalid_request' });
    const deniedBody = JSON.stringify({ error: 'inference_limit_reached' });
    expect(attempts.filter(({ status, body }) => status === 400 && body === allowedBody)).toHaveLength(3);
    expect(attempts.filter(({ status, body }) => status === 429 && body === deniedBody)).toHaveLength(2);
    expect(attempts.slice(0, 3).filter(({ status }) => status === 400).length).toBeLessThanOrEqual(2);
    expect(attempts.slice(3).filter(({ status }) => status === 400).length).toBeLessThanOrEqual(2);
  });

  it('serves a deliberately public snapshot anonymously without opening protected share management', async () => {
    const snapshot = {
      title: 'Public synthetic thought',
      createdAt: 1_800_000_000_000,
      blocks: [{ id: 'block:public', content: 'A deliberately public projection.', kind: 'thought', references: [] }],
    };
    const created = await harness.fetch('/api/shares', {
      method: 'POST',
      headers: mutationHeaders(AUTHORS.a),
      body: JSON.stringify({ snapshot, visibility: 'public' }),
    });
    expect(created.status).toBe(201);
    const { slug } = await created.json() as { slug: string };

    const anonymousRead = await harness.fetch(`/api/shares/${slug}`);
    expect(anonymousRead.status).toBe(200);
    await expect(anonymousRead.json()).resolves.toEqual(snapshot);
    expect((await harness.fetch('/api/shares')).status).toBe(401);
  });

  it('keeps snapshot, archive, revocation, and account deletion tenant-scoped', async () => {
    const firstSessionResponse = await harness.fetch('/api/session', { headers: AUTHORS.a });
    const firstSession = await firstSessionResponse.json() as { cacheNamespace: string };
    const secondSession = await harness.fetch('/api/session', { headers: AUTHORS.b });
    expect(secondSession.status).toBe(200);
    const authoredWorkspace = createInitialWorkspace(1_800_000_000_000);
    const firstBlock = authoredWorkspace.blocks[0];
    const firstDocument = authoredWorkspace.documents[0];
    if (firstBlock === undefined || firstDocument === undefined) throw new Error('fixture');
    firstBlock.content = 'Canonical synthetic archive writing.';
    authoredWorkspace.annotations.push({
      id: 'annotation:ephemeral',
      documentId: firstDocument.id,
      blockId: firstBlock.id,
      focus: firstBlock.content,
      move: 'reflect',
      mirror: 'Ephemeral assistant interpretation.',
      directions: [{
        label: 'Continue',
        prompt: 'Continue in your own words.',
        move: 'reflect',
      }],
      referencedBlockIds: [firstBlock.id],
      sources: [],
      calibration: [],
      status: 'open',
      createdAt: 1_800_000_000_001,
      updatedAt: 1_800_000_000_001,
    });
    const savedWorkspace = await harness.fetch('/api/workspace', {
      method: 'PUT',
      headers: mutationHeaders(AUTHORS.a),
      body: JSON.stringify({
        cacheNamespace: firstSession.cacheNamespace,
        baseRevision: 0,
        mutationId: 'archive-authored-workspace',
        workspace: authoredWorkspace,
      }),
    });
    expect(savedWorkspace.status).toBe(200);
    const snapshot = {
      title: 'Synthetic published thought',
      createdAt: 1_800_000_000_000,
      blocks: [{
        id: 'block:published',
        content: 'Only deliberate canonical writing is published.',
        kind: 'thought',
        references: [],
      }],
    };
    const created = await harness.fetch('/api/shares', {
      method: 'POST',
      headers: mutationHeaders(AUTHORS.a),
      body: JSON.stringify({ snapshot, visibility: 'signed_in' }),
    });
    expect(created.status).toBe(201);
    const { slug } = await created.json() as { slug: string };

    const otherAuthorList = await harness.fetch('/api/shares', { headers: AUTHORS.b });
    await expect(otherAuthorList.json()).resolves.toEqual({ snapshots: [] });
    const foreignRevoke = await harness.fetch(`/api/shares/${slug}`, {
      method: 'DELETE',
      headers: mutationHeaders(AUTHORS.b),
    });
    expect(foreignRevoke.status).toBe(404);
    const signedInReader = await harness.fetch(`/api/shares/${slug}`, { headers: AUTHORS.b });
    expect(signedInReader.status).toBe(200);
    await expect(signedInReader.json()).resolves.toEqual(snapshot);
    expect((await harness.fetch(`/api/shares/${slug}`)).status).toBe(401);

    const archive = await harness.fetch('/api/archive', { headers: AUTHORS.a });
    const archiveBody = await archive.json() as {
      workspace: { annotations: unknown[]; blocks: { content: string }[] };
      publishedSnapshots: { slug: string }[];
    };
    expect(archiveBody.publishedSnapshots.map((item) => item.slug)).toEqual([slug]);
    expect(archiveBody.workspace.annotations).toEqual([]);
    expect(archiveBody.workspace.blocks.map((block) => block.content)).toContain('Canonical synthetic archive writing.');

    const deleted = await harness.fetch('/api/account', {
      method: 'DELETE',
      headers: mutationHeaders(AUTHORS.a),
    });
    expect(deleted.status).toBe(204);
    expect((await harness.fetch(`/api/shares/${slug}`, { headers: AUTHORS.b })).status).toBe(404);
    expect((await harness.fetch('/api/workspace', { headers: AUTHORS.b })).status).toBe(200);
  });
});
