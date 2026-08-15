import { describe, expect, it, vi } from 'vitest';
import { createInitialWorkspace, type WorkspaceState } from '../thinking/model';
import {
  WorkspaceSynchronization,
  type CachedWorkspace,
  type WorkspaceCache,
  type WorkspaceRemote,
} from './workspace-sync';

class MemoryCache implements WorkspaceCache {
  readonly values = new Map<string, CachedWorkspace>();
  get = (namespace: string) => Promise.resolve(this.values.get(namespace) ?? null);
  put = (namespace: string, value: CachedWorkspace) => { this.values.set(namespace, structuredClone(value)); return Promise.resolve(); };
  delete = (namespace: string) => { this.values.delete(namespace); return Promise.resolve(); };
  close = () => undefined;
}

function titled(title: string): WorkspaceState {
  const state = createInitialWorkspace(1_800_000_000_000);
  const document = state.documents[0];
  const block = state.blocks[0];
  if (document === undefined || block === undefined) throw new Error('fixture');
  state.documents[0] = { ...document, title, titleSource: 'author' };
  state.blocks[0] = { ...block, content: `${title} prose` };
  return state;
}

function retitle(state: WorkspaceState, title: string): WorkspaceState {
  const next = structuredClone(state);
  const document = next.documents[0];
  const block = next.blocks[0];
  if (document === undefined || block === undefined) throw new Error('fixture');
  next.documents[0] = { ...document, title, titleSource: 'author' };
  next.blocks[0] = { ...block, content: `${title} prose` };
  return next;
}

describe('workspace synchronization', () => {
  it('durably caches authored state before attempting its server write', async () => {
    const cache = new MemoryCache();
    const order: string[] = [];
    cache.put = (namespace, value) => { order.push('cache'); cache.values.set(namespace, structuredClone(value)); return Promise.resolve(); };
    const remote: WorkspaceRemote = {
      load: vi.fn(() => Promise.resolve({ revision: 0, workspace: titled('Server') })),
      save: vi.fn(() => { order.push('remote'); return Promise.reject(new Error('offline')); }),
    };
    const sync = new WorkspaceSynchronization('account:one', cache, remote);
    await sync.load();
    await sync.save(titled('Offline draft'));

    expect(order.slice(-2)).toEqual(['cache', 'remote']);
    expect(cache.values.get('account:one')).toMatchObject({ pending: true });
    expect(cache.values.get('account:one')?.workspace.documents[0]?.title).toBe('Offline draft');
    expect(sync.currentStatus()).toBe('unsynced');
  });

  it('keeps account caches isolated in one browser', async () => {
    const cache = new MemoryCache();
    const offline: WorkspaceRemote = { load: () => Promise.reject(new Error('offline')), save: () => Promise.reject(new Error('offline')) };
    await cache.put('account:one', { workspace: titled('One'), revision: 2, pending: true, mutationId: 'one' });
    await cache.put('account:two', { workspace: titled('Two'), revision: 4, pending: false, mutationId: null });

    await expect(new WorkspaceSynchronization('account:one', cache, offline).load()).resolves.toMatchObject({ documents: [expect.objectContaining({ title: 'One' })] });
    await expect(new WorkspaceSynchronization('account:two', cache, offline).load()).resolves.toMatchObject({ documents: [expect.objectContaining({ title: 'Two' })] });
  });

  it('does not write an unchanged workspace merely because another tab opened it', async () => {
    const cache = new MemoryCache();
    const base = titled('Base');
    const save = vi.fn<WorkspaceRemote['save']>();
    const sync = new WorkspaceSynchronization('account:one', cache, {
      load: () => Promise.resolve({ revision: 4, workspace: base }),
      save,
    });
    const loaded = await sync.load();

    await sync.save(loaded);

    expect(save).not.toHaveBeenCalled();
    expect(sync.currentStatus()).toBe('synchronized');
  });

  it('preserves concurrent prose as a visibly named conflict copy', async () => {
    const cache = new MemoryCache();
    const base = titled('Base');
    const server = retitle(base, 'Server revision');
    const local = retitle(base, 'Local revision');
    let calls = 0;
    const remote: WorkspaceRemote = {
      load: () => Promise.resolve({ revision: 1, workspace: base }),
      save: vi.fn(() => {
        calls += 1;
        if (calls === 1) return Promise.resolve({ kind: 'conflict' as const, revision: 2, workspace: server });
        return Promise.resolve({ kind: 'saved' as const, revision: 3 });
      }),
    };
    const sync = new WorkspaceSynchronization('account:one', cache, remote, () => 'conflict-id');
    await sync.load();
    await sync.save(local);

    const saved = cache.values.get('account:one');
    expect(saved?.pending).toBe(false);
    expect(saved?.workspace.documents.map((document) => document.title)).toEqual([
      'Server revision',
      'Local revision (Conflict copy)',
    ]);
    expect(saved?.workspace.blocks.some((block) => block.content === 'Local revision prose')).toBe(true);
  });

  it('locks instead of rendering cached writing when authentication is lost', async () => {
    const cache = new MemoryCache();
    await cache.put('account:one', { workspace: titled('Private cache'), revision: 2, pending: true, mutationId: 'pending' });
    const remote: WorkspaceRemote = {
      load: () => Promise.reject(new Error('authentication_lost')),
      save: () => Promise.reject(new Error('authentication_lost')),
    };
    const sync = new WorkspaceSynchronization('account:one', cache, remote);

    await expect(sync.load()).rejects.toThrow('authentication_lost');
    expect(sync.currentStatus()).toBe('locked');
  });

  it('combines independent document changes without creating a conflict copy', async () => {
    const base = titled('First base');
    const firstDocument = base.documents[0];
    const firstBlock = base.blocks[0];
    if (firstDocument === undefined || firstBlock === undefined) throw new Error('fixture');
    base.documents.push({ ...structuredClone(firstDocument), id: 'document:two', title: 'Second base', blockIds: ['block:two'] });
    base.blocks.push({ ...structuredClone(firstBlock), id: 'block:two', documentId: 'document:two', content: 'Second base prose' });
    const server = structuredClone(base);
    server.documents[0] = { ...firstDocument, title: 'First from server' };
    const local = structuredClone(base);
    const secondDocument = base.documents[1];
    const secondBlock = base.blocks[1];
    if (secondDocument === undefined || secondBlock === undefined) throw new Error('fixture');
    local.documents[1] = { ...secondDocument, title: 'Second from local' };
    local.blocks[1] = { ...secondBlock, content: 'Second from local prose' };
    let calls = 0;
    const cache = new MemoryCache();
    const remote: WorkspaceRemote = {
      load: () => Promise.resolve({ revision: 1, workspace: base }),
      save: () => Promise.resolve(++calls === 1
        ? { kind: 'conflict' as const, revision: 2, workspace: server }
        : { kind: 'saved' as const, revision: 3 }),
    };
    const sync = new WorkspaceSynchronization('account:one', cache, remote);
    await sync.load();
    await sync.save(local);

    expect(cache.values.get('account:one')?.workspace.documents.map((document) => document.title)).toEqual([
      'First from server', 'Second from local',
    ]);
  });

  it('serializes rapid saves so later writing uses the acknowledged revision', async () => {
    const cache = new MemoryCache();
    let releaseFirst: ((value: { kind: 'saved'; revision: number }) => void) | undefined;
    const bases: number[] = [];
    const remote: WorkspaceRemote = {
      load: () => Promise.resolve({ revision: 0, workspace: titled('Base') }),
      save: (request) => {
        bases.push(request.baseRevision);
        if (bases.length === 1) return new Promise((resolve) => { releaseFirst = resolve; });
        return Promise.resolve({ kind: 'saved' as const, revision: 2 });
      },
    };
    const sync = new WorkspaceSynchronization('account:one', cache, remote);
    await sync.load();
    const first = sync.save(titled('First fast edit'));
    const second = sync.save(titled('Second fast edit'));
    await vi.waitFor(() => { expect(bases).toEqual([0]); });
    releaseFirst?.({ kind: 'saved', revision: 1 });
    await Promise.all([first, second]);

    expect(bases).toEqual([0, 1]);
    expect(cache.values.get('account:one')?.workspace.documents[0]?.title).toBe('Second fast edit');
  });

  it('preserves both branches when two tabs save the same base revision concurrently', async () => {
    const cache = new MemoryCache();
    const base = titled('Base');
    let server = structuredClone(base);
    let revision = 1;
    const pending: {
      request: Parameters<WorkspaceRemote['save']>[0];
      resolve: (result: Awaited<ReturnType<WorkspaceRemote['save']>>) => void;
    }[] = [];
    const remote: WorkspaceRemote = {
      load: () => Promise.resolve({ revision, workspace: structuredClone(server) }),
      save: (request) => {
        if (pending.length >= 2) {
          if (request.baseRevision !== revision) {
            return Promise.resolve({ kind: 'conflict' as const, revision, workspace: structuredClone(server) });
          }
          server = structuredClone(request.workspace);
          revision += 1;
          return Promise.resolve({ kind: 'saved' as const, revision });
        }
        return new Promise((resolve) => {
          pending.push({ request, resolve });
          if (pending.length !== 2) return;
          const winner = pending.find((entry) => entry.request.workspace.documents[0]?.title === 'South');
          const loser = pending.find((entry) => entry !== winner);
          if (winner === undefined || loser === undefined) throw new Error('fixture');
          server = structuredClone(winner.request.workspace);
          revision += 1;
          winner.resolve({ kind: 'saved', revision });
          loser.resolve({ kind: 'conflict', revision, workspace: structuredClone(server) });
        });
      },
    };
    const north = new WorkspaceSynchronization('account:one', cache, remote, () => 'north-copy');
    const south = new WorkspaceSynchronization('account:one', cache, remote, () => 'south-copy');
    await Promise.all([north.load(), south.load()]);

    await Promise.all([north.save(retitle(base, 'North')), south.save(retitle(base, 'South'))]);

    expect(server.documents.map((document) => document.title)).toEqual([
      'South',
      'North (Conflict copy)',
    ]);
    expect(server.blocks.some((block) => block.content === 'North prose')).toBe(true);
  });

  it('keeps reconciling when a conflict-copy retry races with another tab', async () => {
    const cache = new MemoryCache();
    const base = titled('Base');
    const local = retitle(base, 'North');
    const firstWinner = retitle(base, 'South');
    const secondWinner = retitle(base, 'South again');
    let calls = 0;
    let server = structuredClone(firstWinner);
    const remote: WorkspaceRemote = {
      load: () => Promise.resolve({ revision: 1, workspace: structuredClone(base) }),
      save: (request) => {
        calls += 1;
        if (calls === 1) {
          server = structuredClone(firstWinner);
          return Promise.resolve({ kind: 'conflict' as const, revision: 2, workspace: structuredClone(server) });
        }
        if (calls === 2) {
          server = structuredClone(secondWinner);
          return Promise.resolve({ kind: 'conflict' as const, revision: 3, workspace: structuredClone(server) });
        }
        server = structuredClone(request.workspace);
        return Promise.resolve({ kind: 'saved' as const, revision: 4 });
      },
    };
    const sync = new WorkspaceSynchronization('account:one', cache, remote, () => 'north-copy');
    await sync.load();

    await sync.save(local);

    expect(calls).toBe(3);
    expect(sync.currentStatus()).toBe('synchronized');
    expect(server.documents.map((document) => document.title)).toEqual([
      'South again',
      'North (Conflict copy)',
    ]);
  });

  it('reconciles a pending device edit against a newer hosted revision after reconnect', async () => {
    const cache = new MemoryCache();
    const base = titled('Base');
    const local = retitle(base, 'Device edit');
    const server = retitle(base, 'Hosted edit');
    await cache.put('account:one', {
      workspace: local,
      baseWorkspace: base,
      revision: 1,
      pending: true,
      mutationId: 'pending-device-edit',
    });
    const bases: number[] = [];
    const remote: WorkspaceRemote = {
      load: () => Promise.resolve({ revision: 2, workspace: server }),
      save: (request) => {
        bases.push(request.baseRevision);
        return Promise.resolve(bases.length === 1
          ? { kind: 'conflict' as const, revision: 2, workspace: server }
          : { kind: 'saved' as const, revision: 3 });
      },
    };
    const sync = new WorkspaceSynchronization('account:one', cache, remote, () => 'reconnect-conflict');

    await expect(sync.load()).resolves.toMatchObject({ documents: [expect.objectContaining({ title: 'Device edit' })] });
    await sync.save(local);

    expect(bases).toEqual([1, 2]);
    expect(cache.values.get('account:one')?.workspace.documents.map((document) => document.title)).toEqual([
      'Hosted edit',
      'Device edit (Conflict copy)',
    ]);
  });

  it('remaps connections and snapshots onto the preserved conflict-copy blocks', async () => {
    const base = titled('Base');
    const baseDocument = base.documents[0];
    const baseBlock = base.blocks[0];
    if (baseDocument === undefined || baseBlock === undefined) throw new Error('fixture');
    base.connections = [{
      id: 'connection:one',
      fromBlockId: baseBlock.id,
      toBlockId: baseBlock.id,
      relationship: 'supports',
      createdAt: 1_800_000_000_000,
    }];
    base.snapshots = [{
      id: 'snapshot:one',
      documentId: baseDocument.id,
      title: 'Base snapshot',
      titleConfirmed: true,
      blockIds: [baseBlock.id],
      createdAt: 1_800_000_000_000,
      publishedUrl: null,
    }];
    const server = retitle(base, 'Hosted edit');
    const local = retitle(base, 'Device edit');
    const cache = new MemoryCache();
    let calls = 0;
    const remote: WorkspaceRemote = {
      load: () => Promise.resolve({ revision: 1, workspace: base }),
      save: () => Promise.resolve(++calls === 1
        ? { kind: 'conflict' as const, revision: 2, workspace: server }
        : { kind: 'saved' as const, revision: 3 }),
    };
    const sync = new WorkspaceSynchronization('account:one', cache, remote, () => 'structure-conflict');
    await sync.load();
    await sync.save(local);

    const saved = cache.values.get('account:one')?.workspace;
    const copy = saved?.documents.find((document) => document.conflictStatus === 'open');
    const copiedBlockId = copy?.blockIds[0];
    expect(copiedBlockId).toBeDefined();
    expect(saved?.connections).toContainEqual(expect.objectContaining({ fromBlockId: copiedBlockId, toBlockId: copiedBlockId }));
    expect(saved?.snapshots).toContainEqual(expect.objectContaining({ blockIds: [copiedBlockId] }));
  });

  it('orders cache persistence with remote writes even when an earlier cache write resolves late', async () => {
    const cache = new MemoryCache();
    let releaseFirstSave: (() => void) | undefined;
    let cacheSaveCalls = 0;
    const originalPut = cache.put;
    cache.put = (namespace, value) => {
      cacheSaveCalls += 1;
      if (cacheSaveCalls === 2) {
        return new Promise<void>((resolve) => {
          releaseFirstSave = () => { void originalPut(namespace, value).then(resolve); };
        });
      }
      return originalPut(namespace, value);
    };
    const remoteSave = vi.fn<WorkspaceRemote['save']>((request) => Promise.resolve({
      kind: 'saved' as const,
      revision: request.baseRevision + 1,
    }));
    const remote: WorkspaceRemote = {
      load: () => Promise.resolve({ revision: 0, workspace: titled('Base') }),
      save: remoteSave,
    };
    const sync = new WorkspaceSynchronization('account:one', cache, remote);
    await sync.load();
    const first = sync.save(titled('First edit'));
    const second = sync.save(titled('Second edit'));
    await Promise.resolve();
    await Promise.resolve();

    expect(cacheSaveCalls).toBe(2);
    expect(remoteSave).not.toHaveBeenCalled();
    releaseFirstSave?.();
    await Promise.all([first, second]);

    expect(cache.values.get('account:one')?.workspace.documents[0]?.title).toBe('Second edit');
  });

  it('durably caches newer writing while an earlier remote write is still pending', async () => {
    const cache = new MemoryCache();
    let releaseRemote: ((value: { kind: 'saved'; revision: number }) => void) | undefined;
    let remoteCalls = 0;
    const remote: WorkspaceRemote = {
      load: () => Promise.resolve({ revision: 0, workspace: titled('Base') }),
      save: () => {
        remoteCalls += 1;
        if (remoteCalls === 1) return new Promise((resolve) => { releaseRemote = resolve; });
        return Promise.resolve({ kind: 'saved' as const, revision: 2 });
      },
    };
    const sync = new WorkspaceSynchronization('account:one', cache, remote);
    await sync.load();
    const first = sync.save(titled('First edit'));
    await vi.waitFor(() => { expect(remoteCalls).toBe(1); });
    const second = sync.save(titled('Newest edit'));

    await vi.waitFor(() => {
      expect(cache.values.get('account:one')?.workspace.documents[0]?.title).toBe('Newest edit');
    });
    expect(remoteCalls).toBe(1);
    releaseRemote?.({ kind: 'saved', revision: 1 });
    await Promise.all([first, second]);
  });
});
