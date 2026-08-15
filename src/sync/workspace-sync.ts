import { openDB, type IDBPDatabase } from 'idb';
import { workspaceStateSchema, type WorkspaceState } from '../thinking/model';
import { recoverWorkspaceState, type WorkspaceStore } from '../thinking/persistence';

export type SynchronizationStatus = 'synchronized' | 'synchronizing' | 'unsynced' | 'locked';

export interface CachedWorkspace {
  workspace: WorkspaceState;
  baseWorkspace?: WorkspaceState;
  revision: number;
  pending: boolean;
  mutationId: string | null;
}

export interface WorkspaceCache {
  get(namespace: string): Promise<CachedWorkspace | null>;
  put(namespace: string, value: CachedWorkspace): Promise<void>;
  delete(namespace: string): Promise<void>;
  close(): void;
}

export interface WorkspaceRemote {
  load(): Promise<{ revision: number; workspace: WorkspaceState }>;
  save(request: { cacheNamespace: string; baseRevision: number; mutationId: string; workspace: WorkspaceState }): Promise<
    { kind: 'saved'; revision: number } | { kind: 'conflict'; revision: number; workspace: WorkspaceState }
  >;
}

function same(value: unknown, other: unknown): boolean {
  return JSON.stringify(value) === JSON.stringify(other);
}

function authenticationLost(error: unknown): boolean {
  return error instanceof Error && error.message === 'authentication_lost';
}

function documentMaterial(state: WorkspaceState, documentId: string): unknown {
  const document = state.documents.find((item) => item.id === documentId);
  if (document === undefined) return null;
  const blocks = new Map(state.blocks.map((block) => [block.id, block]));
  return { document, blocks: document.blockIds.map((blockId) => blocks.get(blockId) ?? null) };
}

function reconcileById<T extends { id: string }>(server: T[], local: T[], base: T[]): T[] {
  const result = new Map(server.map((item) => [item.id, structuredClone(item)]));
  const localById = new Map(local.map((item) => [item.id, item]));
  const serverById = new Map(server.map((item) => [item.id, item]));
  for (const item of local) {
    const baseItem = base.find((candidate) => candidate.id === item.id);
    if (!same(item, baseItem) && same(serverById.get(item.id), baseItem)) result.set(item.id, structuredClone(item));
  }
  for (const baseItem of base) {
    if (!localById.has(baseItem.id) && same(serverById.get(baseItem.id), baseItem)) result.delete(baseItem.id);
  }
  return [...result.values()];
}

function reconcileWorkspaces(server: WorkspaceState, local: WorkspaceState, base: WorkspaceState, id: () => string): WorkspaceState {
  const result = structuredClone(server);
  const serverDocuments = new Map(server.documents.map((document) => [document.id, document]));
  const localBlocks = new Map(local.blocks.map((block) => [block.id, block]));
  let remainingLocalConnections = structuredClone(local.connections);
  let remainingBaseConnections = structuredClone(base.connections);
  let remainingLocalSnapshots = structuredClone(local.snapshots);
  let remainingBaseSnapshots = structuredClone(base.snapshots);

  for (const document of local.documents) {
    const serverDocument = serverDocuments.get(document.id);
    const localChanged = !same(documentMaterial(local, document.id), documentMaterial(base, document.id));
    const serverChanged = !same(documentMaterial(server, document.id), documentMaterial(base, document.id));
    if (!localChanged) continue;
    const locallyAuthoredBlocks = document.blockIds.flatMap((blockId) => {
      const block = localBlocks.get(blockId);
      return block === undefined ? [] : [block];
    });
    if (!serverChanged) {
      result.documents = result.documents.filter((item) => item.id !== document.id);
      result.documents.push(structuredClone(document));
      result.blocks = result.blocks.filter((block) => block.documentId !== document.id);
      result.blocks.push(...structuredClone(locallyAuthoredBlocks));
      continue;
    }

    const documentId = `${id()}:document`;
    const blockIds = new Map(document.blockIds.map((blockId, index) => [blockId, `${id()}:block:${String(index)}`]));
    const copiedBlocks = locallyAuthoredBlocks.map((block) => ({
      ...structuredClone(block),
      id: blockIds.get(block.id) ?? `${id()}:block`,
      documentId,
      parentId: block.parentId === null ? null : blockIds.get(block.parentId) ?? null,
    }));
    result.documents.push({
      ...structuredClone(document),
      id: documentId,
      title: `${document.title.trim().length === 0 ? 'Untitled thought' : document.title} (Conflict copy)`,
      titleSource: 'author',
      conflictOfDocumentId: document.id,
      conflictStatus: 'open',
      blockIds: copiedBlocks.map((block) => block.id),
    });
    result.blocks.push(...copiedBlocks);
    const originalBlockIds = new Set(blockIds.keys());
    const dependentConnections = remainingLocalConnections.filter((connection) => (
      originalBlockIds.has(connection.fromBlockId) || originalBlockIds.has(connection.toBlockId)
    ));
    const dependentConnectionIds = new Set(dependentConnections.map((connection) => connection.id));
    result.connections.push(...dependentConnections.map((connection, index) => ({
      ...structuredClone(connection),
      id: `${id()}:connection:${String(index)}`,
      fromBlockId: blockIds.get(connection.fromBlockId) ?? connection.fromBlockId,
      toBlockId: blockIds.get(connection.toBlockId) ?? connection.toBlockId,
    })));
    remainingLocalConnections = remainingLocalConnections.filter((connection) => !dependentConnectionIds.has(connection.id));
    remainingBaseConnections = remainingBaseConnections.filter((connection) => !dependentConnectionIds.has(connection.id));

    const dependentSnapshots = remainingLocalSnapshots.filter((snapshot) => (
      snapshot.blockIds.some((blockId) => originalBlockIds.has(blockId))
    ));
    const dependentSnapshotIds = new Set(dependentSnapshots.map((snapshot) => snapshot.id));
    result.snapshots.push(...dependentSnapshots.map((snapshot, index) => ({
      ...structuredClone(snapshot),
      id: `${id()}:snapshot:${String(index)}`,
      documentId,
      blockIds: snapshot.blockIds.map((blockId) => blockIds.get(blockId) ?? blockId),
    })));
    remainingLocalSnapshots = remainingLocalSnapshots.filter((snapshot) => !dependentSnapshotIds.has(snapshot.id));
    remainingBaseSnapshots = remainingBaseSnapshots.filter((snapshot) => !dependentSnapshotIds.has(snapshot.id));
    const serverFirst = serverDocument?.blockIds[0];
    const copiedFirst = copiedBlocks[0]?.id;
    if (serverFirst !== undefined && copiedFirst !== undefined) {
      result.connections.push({
        id: `${id()}:connection`,
        fromBlockId: copiedFirst,
        toBlockId: serverFirst,
        relationship: 'revises',
        createdAt: Date.now(),
      });
    }
  }
  for (const baseDocument of base.documents) {
    if (local.documents.some((document) => document.id === baseDocument.id)) continue;
    if (!same(documentMaterial(server, baseDocument.id), documentMaterial(base, baseDocument.id))) continue;
    result.documents = result.documents.filter((document) => document.id !== baseDocument.id);
    result.blocks = result.blocks.filter((block) => block.documentId !== baseDocument.id);
  }
  if (!same(local.settings, base.settings) && same(server.settings, base.settings)) result.settings = structuredClone(local.settings);
  if (!same(local.activeDocumentId, base.activeDocumentId) && same(server.activeDocumentId, base.activeDocumentId)) result.activeDocumentId = local.activeDocumentId;
  if (!same(local.dictationDraft, base.dictationDraft) && same(server.dictationDraft, base.dictationDraft)) result.dictationDraft = structuredClone(local.dictationDraft);
  result.connections = reconcileById(result.connections, remainingLocalConnections, remainingBaseConnections);
  result.annotations = reconcileById(server.annotations, local.annotations, base.annotations);
  result.snapshots = reconcileById(result.snapshots, remainingLocalSnapshots, remainingBaseSnapshots);
  return workspaceStateSchema.parse(result);
}

export class WorkspaceSynchronization implements WorkspaceStore {
  private revision = 0;
  private base: WorkspaceState | null = null;
  private status: SynchronizationStatus = 'synchronizing';
  private readonly listeners = new Set<(status: SynchronizationStatus) => void>();
  private cacheQueue: Promise<void> = Promise.resolve();
  private syncQueue: Promise<void> = Promise.resolve();
  private saveSequence = 0;

  constructor(
    private readonly namespace: string,
    private readonly cache: WorkspaceCache,
    private readonly remote: WorkspaceRemote,
    private readonly id: () => string = () => globalThis.crypto.randomUUID(),
  ) {}

  currentStatus(): SynchronizationStatus { return this.status; }

  subscribeStatus(listener: (status: SynchronizationStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => { this.listeners.delete(listener); };
  }

  private setStatus(status: SynchronizationStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }

  async load(): Promise<WorkspaceState> {
    const cached = await this.cache.get(this.namespace);
    try {
      const remote = await this.remote.load();
      if (cached?.pending) {
        this.revision = cached.revision;
        this.base = structuredClone(cached.baseWorkspace ?? cached.workspace);
        this.setStatus('unsynced');
        return recoverWorkspaceState(cached.workspace);
      }
      this.revision = remote.revision;
      this.base = structuredClone(remote.workspace);
      await this.cache.put(this.namespace, { workspace: remote.workspace, baseWorkspace: remote.workspace, revision: remote.revision, pending: false, mutationId: null });
      this.setStatus('synchronized');
      return recoverWorkspaceState(remote.workspace);
    } catch (error) {
      if (authenticationLost(error)) {
        this.setStatus('locked');
        throw error;
      }
      if (cached === null) throw error;
      this.revision = cached.revision;
      this.base = structuredClone(cached.baseWorkspace ?? cached.workspace);
      this.setStatus(cached.pending ? 'unsynced' : 'synchronized');
      return recoverWorkspaceState(cached.workspace);
    }
  }

  async save(state: WorkspaceState): Promise<void> {
    const workspace = workspaceStateSchema.parse(state);
    const mutationId = globalThis.crypto.randomUUID();
    const sequence = ++this.saveSequence;
    const cacheOperation = this.cacheQueue.then(async () => {
      await this.cache.put(this.namespace, { workspace, baseWorkspace: this.base ?? workspace, revision: this.revision, pending: true, mutationId });
      this.setStatus('synchronizing');
    });
    this.cacheQueue = cacheOperation.catch(() => undefined);
    const syncOperation = this.syncQueue.then(async () => {
      await cacheOperation;
      await this.push(workspace, mutationId, sequence);
    });
    this.syncQueue = syncOperation.catch(() => undefined);
    return syncOperation;
  }

  private async push(workspace: WorkspaceState, mutationId: string, sequence: number): Promise<void> {
    try {
      const result = await this.remote.save({ cacheNamespace: this.namespace, baseRevision: this.revision, mutationId, workspace });
      if (result.kind === 'saved') {
        this.revision = result.revision;
        this.base = structuredClone(workspace);
        if (sequence === this.saveSequence) {
          await this.cache.put(this.namespace, { workspace, baseWorkspace: workspace, revision: result.revision, pending: false, mutationId: null });
          this.setStatus('synchronized');
        }
        return;
      }

      const reconciled = reconcileWorkspaces(result.workspace, workspace, this.base ?? result.workspace, this.id);
      const retryId = globalThis.crypto.randomUUID();
      if (sequence === this.saveSequence) {
        await this.cache.put(this.namespace, { workspace: reconciled, baseWorkspace: result.workspace, revision: result.revision, pending: true, mutationId: retryId });
      }
      const retried = await this.remote.save({ cacheNamespace: this.namespace, baseRevision: result.revision, mutationId: retryId, workspace: reconciled });
      if (retried.kind === 'conflict') throw new Error('repeated_conflict');
      this.revision = retried.revision;
      this.base = structuredClone(reconciled);
      if (sequence === this.saveSequence) {
        await this.cache.put(this.namespace, { workspace: reconciled, baseWorkspace: reconciled, revision: retried.revision, pending: false, mutationId: null });
        this.setStatus('synchronized');
      }
    } catch (error) {
      if (sequence === this.saveSequence || authenticationLost(error)) {
        this.setStatus(authenticationLost(error) ? 'locked' : 'unsynced');
      }
    }
  }

  async clear(): Promise<void> { await this.cache.delete(this.namespace); }
  lock(): void { this.setStatus('locked'); }
  close(): void { this.cache.close(); }
}

class IndexedDbWorkspaceCache implements WorkspaceCache {
  private database: Promise<IDBPDatabase> | null = null;

  private open(): Promise<IDBPDatabase> {
    this.database ??= openDB('specular-account-cache', 1, {
      upgrade(database) { if (!database.objectStoreNames.contains('workspaces')) database.createObjectStore('workspaces'); },
    });
    return this.database;
  }

  async get(namespace: string): Promise<CachedWorkspace | null> {
    const value = await (await this.open()).get('workspaces', namespace) as unknown;
    if (typeof value !== 'object' || value === null) return null;
    const record = value as CachedWorkspace;
    const parsed = workspaceStateSchema.safeParse(record.workspace);
    return parsed.success && Number.isInteger(record.revision)
      ? { ...record, workspace: parsed.data }
      : null;
  }

  async put(namespace: string, value: CachedWorkspace): Promise<void> { await (await this.open()).put('workspaces', value, namespace); }
  async delete(namespace: string): Promise<void> { await (await this.open()).delete('workspaces', namespace); }
  close(): void { void this.database?.then((database) => { database.close(); }); }
}

class HttpWorkspaceRemote implements WorkspaceRemote {
  async load(): Promise<{ revision: number; workspace: WorkspaceState }> {
    const response = await fetch('/api/workspace');
    if (!response.ok) throw new Error(response.status === 401 ? 'authentication_lost' : 'workspace_unavailable');
    const body = await response.json() as { revision?: unknown; workspace?: unknown };
    if (!Number.isInteger(body.revision)) throw new Error('invalid_workspace_response');
    return { revision: body.revision as number, workspace: workspaceStateSchema.parse(body.workspace) };
  }

  async save(request: { cacheNamespace: string; baseRevision: number; mutationId: string; workspace: WorkspaceState }) {
    const response = await fetch('/api/workspace', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-specular-intent': 'mutate' },
      body: JSON.stringify(request),
    });
    const body = await response.json() as { revision?: unknown; workspace?: unknown };
    if (response.status === 409 && Number.isInteger(body.revision)) {
      return { kind: 'conflict' as const, revision: body.revision as number, workspace: workspaceStateSchema.parse(body.workspace) };
    }
    if (!response.ok || !Number.isInteger(body.revision)) throw new Error(response.status === 401 || response.status === 410 ? 'authentication_lost' : 'workspace_unavailable');
    return { kind: 'saved' as const, revision: body.revision as number };
  }
}

export function createSynchronizedWorkspaceStore(namespace: string): Promise<WorkspaceStore> {
  if (globalThis.localStorage.getItem('specular-legacy-cache-discarded') !== 'yes' && 'indexedDB' in globalThis) {
    const request = globalThis.indexedDB.deleteDatabase('specular-local');
    request.addEventListener('success', () => { globalThis.localStorage.setItem('specular-legacy-cache-discarded', 'yes'); });
  }
  return Promise.resolve(new WorkspaceSynchronization(namespace, new IndexedDbWorkspaceCache(), new HttpWorkspaceRemote()));
}
