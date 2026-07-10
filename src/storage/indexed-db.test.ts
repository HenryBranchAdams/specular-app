import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Thread } from '../domain/contracts';
import {
  capsuleIdSchema,
  capsuleSchema,
  threadIdSchema,
  threadSchema,
  turnIdSchema,
  turnSchema,
} from '../domain/schemas';
import {
  createExportFilename,
  serializeExport,
  type SpecularExport,
} from './export';
import * as indexedDbModule from './indexed-db';
import {
  DATABASE_NAME,
  SPECULAR_DB_VERSION,
  StorageMigrationError,
  createLocalRepositories,
  exportRecoverySnapshot,
} from './indexed-db';
import { migrations, type Migration } from './migrations';
import type { LocalRepositories } from './repositories';

const EXPORTED_AT = Date.UTC(2026, 6, 9, 12);

const EMPTY_UNDERSTANDING = {
  claims: [],
  observations: [],
  stakeholders: [],
  contexts: [],
  distinctions: [],
  tensions: [],
  exploredBlindSpots: [],
  unexploredBlindSpots: [],
};

function asThreadId(value: string) {
  return threadIdSchema.parse(value);
}

function asTurnId(value: string) {
  return turnIdSchema.parse(value);
}

function asCapsuleId(value: string) {
  return capsuleIdSchema.parse(value);
}

function makeTurn(overrides: Record<string, unknown> = {}) {
  return turnSchema.parse({
    id: 'turn-1',
    ownerScope: 'local',
    threadId: 'thread-1',
    role: 'user',
    content: 'A thought worth examining.',
    modality: 'text',
    createdAt: 10,
    position: 0,
    operation: 'next_question',
    deliveryState: 'accepted',
    ...overrides,
  });
}

function makeThread(overrides: Record<string, unknown> = {}) {
  return threadSchema.parse({
    id: 'thread-1',
    ownerScope: 'local',
    title: 'A durable thread',
    lifecycleState: 'active',
    createdAt: 10,
    updatedAt: 20,
    turnIds: [],
    understanding: EMPTY_UNDERSTANDING,
    ...overrides,
  });
}

function makeCapsule(overrides: Record<string, unknown> = {}) {
  return capsuleSchema.parse({
    id: 'capsule-1',
    ownerScope: 'local',
    title: 'A durable capsule',
    createdAt: 30,
    updatedAt: 40,
    conclusion: {
      kind: 'working_conclusion',
      thesis: 'The thesis remains provisional.',
      insights: ['First insight.', 'Second insight.', 'Third insight.'],
      observations: [],
      tensions: [],
      caveats: [],
      provenance: [{ turnId: 'turn-1', excerpt: 'A thought worth examining.' }],
      editState: 'generated',
    },
    sourceThreadId: 'thread-1',
    sourceTurnRange: {
      startTurnId: 'turn-1',
      endTurnId: 'turn-2',
    },
    ...overrides,
  });
}

function makeArchive(overrides: Partial<SpecularExport> = {}): SpecularExport {
  return {
    format: 'specular-export',
    version: 1,
    exportedAt: EXPORTED_AT,
    ownerScope: 'local',
    threads: [],
    turns: [],
    capsules: [],
    preferences: [],
    ...overrides,
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => {
      resolve(request.result);
    });
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('IndexedDB request failed.'));
    });
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => {
      resolve();
    });
    transaction.addEventListener('abort', () => {
      reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    });
    transaction.addEventListener('error', () => {
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    });
  });
}

async function openRawDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return requestResult(factory.open(DATABASE_NAME));
}

async function seedRawAggregate(
  factory: IDBFactory,
  storeName: 'threads' | 'turns' | 'capsules' | 'preferences',
  aggregate: unknown,
): Promise<void> {
  const database = await openRawDatabase(factory);
  const transaction = database.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).put(aggregate);
  await transactionComplete(transaction);
  database.close();
}

async function getRawAggregates(
  factory: IDBFactory,
  storeName: 'threads' | 'turns' | 'capsules' | 'preferences',
): Promise<unknown[]> {
  const database = await openRawDatabase(factory);
  const transaction = database.transaction(storeName, 'readonly');
  const result: unknown = await requestResult(transaction.objectStore(storeName).getAll());
  await transactionComplete(transaction);
  database.close();
  if (!Array.isArray(result)) {
    throw new Error('Expected IndexedDB getAll to return an array.');
  }
  return result.map((value: unknown) => value);
}

async function seedCompleteThread(repositories: LocalRepositories): Promise<void> {
  const firstTurn = makeTurn();
  const secondTurn = makeTurn({
    id: 'turn-2',
    role: 'specular',
    content: 'What detail would change your view?',
    createdAt: 11,
    position: 1,
  });

  await repositories.threads.put(makeThread({
    turnIds: [firstTurn.id, secondTurn.id],
  }));
  await repositories.turns.put(firstTurn);
  await repositories.turns.put(secondTurn);
  await repositories.capsules.put(makeCapsule());
  await repositories.preferences.put('reduced-motion', true);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('versioned owner-scoped IndexedDB persistence', () => {
  it('does not export the raw unscoped database opener', () => {
    expect(Object.hasOwn(indexedDbModule, 'openSpecularDatabase')).toBe(false);
  });

  it('creates the explicit version 1 schema', async () => {
    const factory = new IDBFactory();
    const repositories = await createLocalRepositories('local', factory);
    const database = await openRawDatabase(factory);

    expect(database.name).toBe(DATABASE_NAME);
    expect(database.version).toBe(SPECULAR_DB_VERSION);
    expect([...database.objectStoreNames]).toEqual([
      'capsules',
      'preferences',
      'threads',
      'turns',
    ]);

    const transaction = database.transaction(
      ['threads', 'turns', 'capsules', 'preferences'],
      'readonly',
    );
    expect([...transaction.objectStore('threads').indexNames]).toEqual(['by-owner-updated']);
    expect([...transaction.objectStore('turns').indexNames]).toEqual(['by-thread-position']);
    expect([...transaction.objectStore('capsules').indexNames]).toEqual(['by-owner-updated']);
    expect([...transaction.objectStore('preferences').indexNames]).toEqual([]);
    transaction.abort();

    database.close();
    repositories.close();
  });

  it('recovers a failed first migration without creating a database before a clean retry', async () => {
    const factory = new IDBFactory();
    const failingFirstMigration: Migration = {
      version: 1,
      migrate(database, transaction) {
        migrations[0]?.migrate(database, transaction);
        throw new Error('first migration failure');
      },
    };

    await expect(createLocalRepositories('local', factory, {
      version: 1,
      migrations: [failingFirstMigration],
    })).rejects.toBeInstanceOf(StorageMigrationError);
    expect((await factory.databases()).map((database) => database.name)).not.toContain(
      DATABASE_NAME,
    );

    const recovery = await exportRecoverySnapshot('local', factory);

    expect(recovery.databaseVersion).toBe(0);
    expect(recovery.stores).toEqual({
      threads: [],
      turns: [],
      capsules: [],
      preferences: [],
    });
    expect((await factory.databases()).map((database) => database.name)).not.toContain(
      DATABASE_NAME,
    );

    const repositories = await createLocalRepositories('local', factory);
    const database = await openRawDatabase(factory);
    expect(database.version).toBe(SPECULAR_DB_VERSION);
    expect([...database.objectStoreNames]).toEqual([
      'capsules',
      'preferences',
      'threads',
      'turns',
    ]);
    database.close();
    repositories.close();
  });

  it('never returns another owner scope', async () => {
    const factory = new IDBFactory();
    const local = await createLocalRepositories('local', factory);
    await local.threads.put(makeThread({ id: 'thread-local' }));
    await seedRawAggregate(factory, 'threads', {
      ...makeThread({ id: 'thread-other' }),
      ownerScope: 'other',
    });

    expect((await local.threads.list()).map((thread) => thread.id)).toEqual(['thread-local']);
    expect(await local.threads.get(asThreadId('thread-other'))).toBeUndefined();
    local.close();
  });

  it('persists a pending user turn before any provider await', async () => {
    const factory = new IDBFactory();
    const repositories = await createLocalRepositories('local', factory);
    await repositories.turns.put(makeTurn({
      id: 'turn-pending',
      deliveryState: 'pending',
    }));

    expect((await repositories.turns.get(asTurnId('turn-pending')))?.deliveryState).toBe('pending');
    repositories.close();
  });

  it('rejects writes whose aggregate owner does not match the repository owner', async () => {
    const factory = new IDBFactory();
    const repositories = await createLocalRepositories('local', factory);
    const otherOwnerThread = {
      ...makeThread(),
      ownerScope: 'other',
    } as unknown as Thread;

    await expect(repositories.threads.put(otherOwnerThread)).rejects.toThrow(/owner scope/i);
    expect(await repositories.threads.list()).toEqual([]);
    repositories.close();
  });

  it('lists turns only for the requested thread in position order', async () => {
    const factory = new IDBFactory();
    const repositories = await createLocalRepositories('local', factory);
    await repositories.turns.put(makeTurn({ id: 'turn-3', position: 3 }));
    await repositories.turns.put(makeTurn({ id: 'turn-1', position: 1 }));
    await repositories.turns.put(makeTurn({
      id: 'turn-other',
      threadId: 'thread-other',
      position: 0,
    }));

    expect((await repositories.turns.listByThread(asThreadId('thread-1'))).map((turn) => turn.id)).toEqual([
      'turn-1',
      'turn-3',
    ]);
    repositories.close();
  });

  it('permanently deletes a thread and cascades to only its turns', async () => {
    const factory = new IDBFactory();
    const repositories = await createLocalRepositories('local', factory);
    await repositories.threads.put(makeThread({ id: 'thread-delete' }));
    await repositories.threads.put(makeThread({ id: 'thread-keep' }));
    await repositories.turns.put(makeTurn({
      id: 'turn-delete',
      threadId: 'thread-delete',
    }));
    await repositories.turns.put(makeTurn({
      id: 'turn-keep',
      threadId: 'thread-keep',
    }));

    await repositories.threads.delete(asThreadId('thread-delete'));

    expect(await repositories.threads.get(asThreadId('thread-delete'))).toBeUndefined();
    expect(await repositories.turns.get(asTurnId('turn-delete'))).toBeUndefined();
    expect(await repositories.threads.get(asThreadId('thread-keep'))).toBeDefined();
    expect(await repositories.turns.get(asTurnId('turn-keep'))).toBeDefined();
    repositories.close();
  });

  it('permanently deletes a capsule', async () => {
    const factory = new IDBFactory();
    const repositories = await createLocalRepositories('local', factory);
    await repositories.capsules.put(makeCapsule());

    await repositories.capsules.delete(asCapsuleId('capsule-1'));

    expect(await repositories.capsules.get(asCapsuleId('capsule-1'))).toBeUndefined();
    repositories.close();
  });

  it('round trips stable ids through validated export and import', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(EXPORTED_AT);
    const factory = new IDBFactory();
    const repositories = await createLocalRepositories('local', factory);
    await seedCompleteThread(repositories);

    const archive = await repositories.export.exportAll();
    await repositories.export.deleteAll();
    await repositories.export.importAll(archive);

    expect(await repositories.export.exportAll()).toEqual(archive);
    expect((await repositories.threads.get(asThreadId('thread-1')))?.turnIds).toEqual([
      'turn-1',
      'turn-2',
    ]);
    expect((await repositories.capsules.get(asCapsuleId('capsule-1')))?.sourceThreadId).toBe(
      'thread-1',
    );
    repositories.close();
  });

  it('validates an entire import before writing and rejects non-local ownership', async () => {
    const factory = new IDBFactory();
    const repositories = await createLocalRepositories('local', factory);
    const invalidArchive = {
      format: 'specular-export',
      version: 1,
      exportedAt: EXPORTED_AT,
      ownerScope: 'local',
      threads: [
        makeThread({ id: 'valid-first' }),
        { ...makeThread({ id: 'invalid-second' }), ownerScope: 'other' },
      ],
      turns: [],
      capsules: [],
      preferences: [],
    };

    await expect(repositories.export.importAll(invalidArchive)).rejects.toThrow(/invalid/i);
    expect(await repositories.threads.list()).toEqual([]);
    repositories.close();
  });

  it('rejects duplicate stable ids before an import writes', async () => {
    const factory = new IDBFactory();
    const repositories = await createLocalRepositories('local', factory);
    const duplicateArchive: SpecularExport = {
      format: 'specular-export',
      version: 1,
      exportedAt: EXPORTED_AT,
      ownerScope: 'local',
      threads: [makeThread(), makeThread()],
      turns: [],
      capsules: [],
      preferences: [],
    };

    await expect(repositories.export.importAll(duplicateArchive)).rejects.toThrow(/duplicate/i);
    expect(await repositories.threads.list()).toEqual([]);
    repositories.close();
  });

  it('rejects ids reused across aggregate kinds before an import writes', async () => {
    const factory = new IDBFactory();
    const repositories = await createLocalRepositories('local', factory);
    await repositories.threads.put(makeThread({ id: 'thread-existing' }));

    const sharedThreadTurnId = 'shared-thread-turn';
    const sharedThreadTurn = makeTurn({
      id: sharedThreadTurnId,
      threadId: sharedThreadTurnId,
    });

    const sharedThreadCapsuleId = 'shared-thread-capsule';
    const threadCapsuleFirstTurn = makeTurn({
      id: 'thread-capsule-turn-1',
      threadId: sharedThreadCapsuleId,
    });
    const threadCapsuleSecondTurn = makeTurn({
      id: 'thread-capsule-turn-2',
      threadId: sharedThreadCapsuleId,
      position: 1,
    });
    const threadCapsuleConclusion = {
      ...makeCapsule().conclusion,
      provenance: [{
        turnId: threadCapsuleFirstTurn.id,
        excerpt: 'A thought worth examining.',
      }],
    };

    const sharedTurnCapsuleId = 'shared-turn-capsule';
    const turnCapsuleThreadId = 'thread-for-turn-capsule';
    const sharedTurnCapsule = makeTurn({
      id: sharedTurnCapsuleId,
      threadId: turnCapsuleThreadId,
    });
    const turnCapsuleSecondTurn = makeTurn({
      id: 'turn-capsule-turn-2',
      threadId: turnCapsuleThreadId,
      position: 1,
    });
    const turnCapsuleConclusion = {
      ...makeCapsule().conclusion,
      provenance: [{
        turnId: sharedTurnCapsule.id,
        excerpt: 'A thought worth examining.',
      }],
    };

    const invalidArchives = [
      makeArchive({
        threads: [makeThread({
          id: sharedThreadTurnId,
          turnIds: [sharedThreadTurn.id],
        })],
        turns: [sharedThreadTurn],
      }),
      makeArchive({
        threads: [makeThread({
          id: sharedThreadCapsuleId,
          turnIds: [threadCapsuleFirstTurn.id, threadCapsuleSecondTurn.id],
        })],
        turns: [threadCapsuleFirstTurn, threadCapsuleSecondTurn],
        capsules: [makeCapsule({
          id: sharedThreadCapsuleId,
          sourceThreadId: sharedThreadCapsuleId,
          sourceTurnRange: {
            startTurnId: threadCapsuleFirstTurn.id,
            endTurnId: threadCapsuleSecondTurn.id,
          },
          conclusion: threadCapsuleConclusion,
        })],
      }),
      makeArchive({
        threads: [makeThread({
          id: turnCapsuleThreadId,
          turnIds: [sharedTurnCapsule.id, turnCapsuleSecondTurn.id],
        })],
        turns: [sharedTurnCapsule, turnCapsuleSecondTurn],
        capsules: [makeCapsule({
          id: sharedTurnCapsuleId,
          sourceThreadId: turnCapsuleThreadId,
          sourceTurnRange: {
            startTurnId: sharedTurnCapsule.id,
            endTurnId: turnCapsuleSecondTurn.id,
          },
          conclusion: turnCapsuleConclusion,
        })],
      }),
    ];

    for (const archive of invalidArchives) {
      await expect(repositories.export.importAll(archive)).rejects.toThrow(/duplicate|unique/i);
    }
    expect((await repositories.threads.list()).map((thread) => thread.id)).toEqual([
      'thread-existing',
    ]);
    repositories.close();
  });

  it('rejects relationally corrupt archives before replacing valid local data', async () => {
    const factory = new IDBFactory();
    const repositories = await createLocalRepositories('local', factory);
    await repositories.threads.put(makeThread({ id: 'thread-existing' }));
    const firstTurn = makeTurn({ id: 'turn-import-1', threadId: 'thread-import', position: 0 });
    const secondTurnAtSamePosition = makeTurn({
      id: 'turn-import-2',
      threadId: 'thread-import',
      position: 0,
    });
    const invalidArchives = [
      makeArchive({
        threads: [makeThread({ id: 'thread-import', turnIds: ['turn-missing'] })],
      }),
      makeArchive({
        threads: [makeThread({
          id: 'thread-import',
          turnIds: [firstTurn.id, secondTurnAtSamePosition.id],
        })],
        turns: [firstTurn, secondTurnAtSamePosition],
      }),
      makeArchive({
        threads: [makeThread({ id: 'thread-import', turnIds: [] })],
        turns: [firstTurn],
      }),
      makeArchive({
        threads: [makeThread()],
        capsules: [makeCapsule()],
      }),
    ];

    for (const archive of invalidArchives) {
      await expect(repositories.export.importAll(archive)).rejects.toThrow(/invalid/i);
    }
    expect((await repositories.threads.list()).map((thread) => thread.id)).toEqual([
      'thread-existing',
    ]);
    repositories.close();
  });

  it('sanitizes the export filename and safely serializes user content', () => {
    const archive: SpecularExport = {
      format: 'specular-export',
      version: 1,
      exportedAt: EXPORTED_AT,
      ownerScope: 'local',
      threads: [makeThread({ title: '</script><script>alert(1)</script>' })],
      turns: [],
      capsules: [],
      preferences: [],
    };

    const serialized = serializeExport(archive);

    expect(createExportFilename(EXPORTED_AT)).toBe('specular-export-2026-07-09.json');
    expect(serialized).not.toContain('<script>');
    expect(JSON.parse(serialized)).toEqual(archive);
  });

  it('deletes all local content permanently without deleting another owner', async () => {
    const factory = new IDBFactory();
    const repositories = await createLocalRepositories('local', factory);
    await seedCompleteThread(repositories);
    await seedRawAggregate(factory, 'threads', {
      ...makeThread({ id: 'thread-other' }),
      ownerScope: 'other',
    });

    await repositories.export.deleteAll();

    expect(await repositories.threads.list()).toEqual([]);
    expect(await repositories.turns.listByThread(asThreadId('thread-1'))).toEqual([]);
    expect(await repositories.capsules.list()).toEqual([]);
    expect(await repositories.preferences.list()).toEqual([]);
    expect(await getRawAggregates(factory, 'threads')).toEqual([
      expect.objectContaining({ id: 'thread-other', ownerScope: 'other' }),
    ]);
    repositories.close();
  });

  it('reads recovery data through owner-prefixed key ranges', async () => {
    const factory = new IDBFactory();
    const repositories = await createLocalRepositories('local', factory);
    await repositories.threads.put(makeThread({ id: 'thread-local' }));
    repositories.close();
    await seedRawAggregate(factory, 'threads', {
      ...makeThread({ id: 'thread-other' }),
      ownerScope: 'other',
    });
    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll');

    const recovery = await exportRecoverySnapshot('local', factory);

    expect(recovery.stores.threads).toEqual([
      expect.objectContaining({ id: 'thread-local', ownerScope: 'local' }),
    ]);
    expect(getAll).toHaveBeenCalledTimes(4);
    getAll.mock.calls.forEach(([query]) => {
      expect(query).toBeInstanceOf(IDBKeyRange);
      if (!(query instanceof IDBKeyRange)) {
        throw new Error('Recovery query must use an owner-prefixed key range.');
      }
      expect(query.lower).toEqual(['local', '']);
      expect(query.upper).toEqual(['local', '\uffff']);
    });
  });

  it('aborts a failed migration, blocks writes, and exports recovery data non-destructively', async () => {
    const factory = new IDBFactory();
    const original = await createLocalRepositories('local', factory);
    await original.threads.put(makeThread({
      id: 'thread-preserved',
      title: 'private migration sentinel',
    }));
    original.close();

    const duplicateThread = makeThread({
      id: 'thread-preserved',
      title: 'private migration sentinel',
    });
    const failingMigration: Migration = {
      version: 2,
      migrate(_database, transaction) {
        void transaction.objectStore('threads').add(duplicateThread).catch(() => undefined);
      },
    };

    let migrationError: unknown;
    try {
      await createLocalRepositories('local', factory, {
        version: 2,
        migrations: [...migrations, failingMigration],
      });
    } catch (error) {
      migrationError = error;
    }

    expect(migrationError).toBeInstanceOf(StorageMigrationError);
    expect(migrationError).toMatchObject({
      databaseName: DATABASE_NAME,
      fromVersion: 1,
      toVersion: 2,
    });
    expect(String(migrationError)).not.toContain('private migration sentinel');
    await expect(createLocalRepositories('local', factory)).rejects.toBe(migrationError);

    const firstRecovery = await exportRecoverySnapshot('local', factory);
    const secondRecovery = await exportRecoverySnapshot('local', factory);
    expect(firstRecovery.databaseVersion).toBe(1);
    expect(firstRecovery.stores.threads).toEqual([
      expect.objectContaining({ id: 'thread-preserved', ownerScope: 'local' }),
    ]);
    expect(secondRecovery.stores).toEqual(firstRecovery.stores);

    const preservedDatabase = await openRawDatabase(factory);
    expect(preservedDatabase.version).toBe(1);
    preservedDatabase.close();
  });
});
