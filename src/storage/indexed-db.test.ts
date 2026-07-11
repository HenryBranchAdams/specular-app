import {
  IDBFactory,
  IDBObjectStore as FakeIdbObjectStore,
} from 'fake-indexeddb';
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
  createRecoveryFilename,
  serializeExport,
  serializeRecoverySnapshot,
  type RecoverySnapshot,
  type SpecularExport,
} from './export';
import * as indexedDbModule from './indexed-db';
import {
  DATABASE_NAME,
  SPECULAR_DB_VERSION,
  StorageMigrationError,
  createLocalRepositories,
  exportRecoverySnapshot,
  resetLocalDatabase,
} from './indexed-db';
import {
  AbortNextUpgradeFactory,
  getRawAggregates,
  openRawDatabase,
  seedRawAggregate,
} from './indexed-db.test-support';
import type { LocalRepositories } from './repositories';

const EXPORTED_AT = Date.UTC(2026, 6, 9, 12);

class ObserveBlockedDeleteFactory implements IDBFactory {
  readonly blocked: Promise<void>;
  private resolveBlocked: (() => void) | undefined;

  constructor(private readonly factory: IDBFactory) {
    this.blocked = new Promise((resolve) => {
      this.resolveBlocked = resolve;
    });
  }

  cmp(first: IDBValidKey, second: IDBValidKey): number {
    return this.factory.cmp(first, second);
  }

  databases(): Promise<IDBDatabaseInfo[]> {
    return this.factory.databases();
  }

  deleteDatabase(name: string): IDBOpenDBRequest {
    const request = this.factory.deleteDatabase(name);
    request.addEventListener('blocked', () => {
      this.resolveBlocked?.();
    });
    return request;
  }

  open(name: string, version?: number): IDBOpenDBRequest {
    return version === undefined
      ? this.factory.open(name)
      : this.factory.open(name, version);
  }
}

type CreateParameterCount = Parameters<typeof createLocalRepositories>['length'];
const HAS_EXACT_TWO_ARGUMENT_API: CreateParameterCount extends 1 | 2 ? true : false = true;

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

function abortOnNthPut(storeName: string, occurrence: number): void {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- restored with the object-store receiver below.
  const originalPut = FakeIdbObjectStore.prototype.put;
  let matches = 0;
  vi.spyOn(FakeIdbObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    const request = key === undefined
      ? originalPut.call(this, value)
      : originalPut.call(this, value, key);
    if (this.name === storeName) {
      matches += 1;
      if (matches === occurrence) {
        this.transaction.abort();
      }
    }
    return request;
  });
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
  it('exports only the bounded owner-scoped runtime surface', () => {
    expect(Object.keys(indexedDbModule).sort()).toEqual([
      'DATABASE_NAME',
      'SPECULAR_DB_VERSION',
      'StorageMigrationError',
      'StorageValidationError',
      'createLocalRepositories',
      'exportRecoverySnapshot',
      'resetLocalDatabase',
    ]);
    expect(HAS_EXACT_TWO_ARGUMENT_API).toBe(true);
  });

  it('does not accept a third-argument migration capability at runtime', async () => {
    const factory = new IDBFactory();
    let migrationInvoked = false;
    // @ts-expect-error Runtime regression: production construction intentionally has no third arg.
    const repositories = await createLocalRepositories('local', factory, {
      version: 1,
      migrations: [{
        version: 1,
        migrate() {
          migrationInvoked = true;
        },
      }],
    });

    expect(migrationInvoked).toBe(false);
    expect(await repositories.threads.list()).toEqual([]);
    repositories.close();
  });

  it('creates the explicit version 1 schema', async () => {
    const factory = new IDBFactory();
    const repositories = await createLocalRepositories('local', factory);
    const database = await openRawDatabase(factory, DATABASE_NAME);

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

  it('keeps a failed first migration locked until an explicit reset permits a clean retry', async () => {
    const baseFactory = new IDBFactory();
    const factory = new AbortNextUpgradeFactory(baseFactory);

    await expect(createLocalRepositories('local', factory)).rejects.toBeInstanceOf(
      StorageMigrationError,
    );
    expect((await baseFactory.databases()).map((database) => database.name)).not.toContain(
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
    expect((await baseFactory.databases()).map((database) => database.name)).not.toContain(
      DATABASE_NAME,
    );

    await expect(createLocalRepositories('local', factory)).rejects.toBeInstanceOf(
      StorageMigrationError,
    );
    await resetLocalDatabase('local', factory);
    const repositories = await createLocalRepositories('local', factory);
    const database = await openRawDatabase(baseFactory, DATABASE_NAME);
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
    await seedRawAggregate(factory, DATABASE_NAME, 'threads', {
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

  it('rolls back pending turn and thread reference writes as one unit', async () => {
    const factory = new IDBFactory();
    const repositories = await createLocalRepositories('local', factory);
    const originalThread = makeThread();
    const pendingTurn = makeTurn({ deliveryState: 'pending' });
    const updatedThread = makeThread({ turnIds: [pendingTurn.id], updatedAt: 21 });
    await repositories.threads.put(originalThread);
    abortOnNthPut('threads', 1);

    await expect(repositories.conversation.persistPendingTurn({
      thread: updatedThread,
      userTurn: pendingTurn,
    })).rejects.toBeDefined();

    expect(await repositories.turns.get(pendingTurn.id)).toBeUndefined();
    expect(await repositories.threads.get(originalThread.id)).toEqual(originalThread);
    repositories.close();
  });

  it('rolls back accepted user, assistant, and thread updates as one unit', async () => {
    const factory = new IDBFactory();
    const repositories = await createLocalRepositories('local', factory);
    const pendingTurn = makeTurn({ deliveryState: 'pending' });
    const pendingThread = makeThread({ turnIds: [pendingTurn.id] });
    const acceptedTurn = makeTurn({ deliveryState: 'accepted' });
    const responseTurn = makeTurn({
      id: 'turn-2',
      role: 'specular',
      content: 'Which customer would notice first?',
      position: 1,
      deliveryState: 'accepted',
    });
    const acceptedThread = makeThread({
      turnIds: [acceptedTurn.id, responseTurn.id],
      updatedAt: 30,
      understanding: {
        ...EMPTY_UNDERSTANDING,
        stakeholders: ['The first customer cohort.'],
      },
    });
    await repositories.threads.put(pendingThread);
    await repositories.turns.put(pendingTurn);
    abortOnNthPut('turns', 2);

    await expect(repositories.conversation.acceptExchange({
      thread: acceptedThread,
      userTurn: acceptedTurn,
      responseTurn,
    })).rejects.toBeDefined();

    expect(await repositories.turns.get(pendingTurn.id)).toEqual(pendingTurn);
    expect(await repositories.turns.get(responseTurn.id)).toBeUndefined();
    expect(await repositories.threads.get(pendingThread.id)).toEqual(pendingThread);
    repositories.close();
  });

  it('rolls back an assistant turn and thread reference as one unit', async () => {
    const factory = new IDBFactory();
    const repositories = await createLocalRepositories('local', factory);
    const originalThread = makeThread();
    const responseTurn = makeTurn({
      id: 'turn-challenge',
      role: 'specular',
      content: 'Which stakeholder bears the hidden cost?',
      operation: 'challenge',
      deliveryState: 'accepted',
    });
    const updatedThread = makeThread({
      turnIds: [responseTurn.id],
      updatedAt: 31,
    });
    await repositories.threads.put(originalThread);
    abortOnNthPut('threads', 1);

    await expect(repositories.conversation.persistSpecularTurn({
      thread: updatedThread,
      responseTurn,
    })).rejects.toBeDefined();

    expect(await repositories.turns.get(responseTurn.id)).toBeUndefined();
    expect(await repositories.threads.get(originalThread.id)).toEqual(originalThread);
    repositories.close();
  });

  it('rolls back old-thread completion and fresh-thread creation as one unit', async () => {
    const factory = new IDBFactory();
    const repositories = await createLocalRepositories('local', factory);
    const activeThread = makeThread();
    const completedThread = makeThread({
      lifecycleState: 'completed',
      completedAt: 40,
      updatedAt: 40,
    });
    const freshThread = makeThread({
      id: 'thread-fresh',
      title: 'New topic',
      createdAt: 40,
      updatedAt: 40,
    });
    const capsule = makeCapsule({ sourceThreadId: completedThread.id });
    await repositories.threads.put(activeThread);
    abortOnNthPut('threads', 2);

    await expect(repositories.conversation.finishAndStart({
      capsule,
      completedThread,
      freshThread,
    })).rejects.toBeDefined();

    expect(await repositories.threads.get(activeThread.id)).toEqual(activeThread);
    expect(await repositories.threads.get(freshThread.id)).toBeUndefined();
    expect(await repositories.capsules.get(capsule.id)).toBeUndefined();
    repositories.close();
  });

  it('commits a finished thread, fresh thread, and saved capsule as one unit', async () => {
    const factory = new IDBFactory();
    const repositories = await createLocalRepositories('local', factory);
    const activeThread = makeThread();
    const completedThread = makeThread({
      lifecycleState: 'completed',
      completedAt: 40,
      updatedAt: 40,
    });
    const freshThread = makeThread({
      id: 'thread-fresh',
      title: 'New topic',
      createdAt: 40,
      updatedAt: 40,
    });
    const capsule = makeCapsule({ sourceThreadId: completedThread.id });
    await repositories.threads.put(activeThread);

    await repositories.conversation.finishAndStart({
      capsule,
      completedThread,
      freshThread,
    });

    expect(await repositories.threads.get(completedThread.id)).toEqual(completedThread);
    expect(await repositories.threads.get(freshThread.id)).toEqual(freshThread);
    expect(await repositories.capsules.get(capsule.id)).toEqual(capsule);
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

  it('validates and safely serializes an owner-scoped recovery copy', () => {
    const snapshot: RecoverySnapshot = {
      format: 'specular-recovery',
      version: 1,
      exportedAt: EXPORTED_AT,
      ownerScope: 'local',
      databaseName: DATABASE_NAME,
      databaseVersion: 1,
      stores: {
        threads: [{
          ownerScope: 'local',
          id: 'thread-recovery',
          title: '</script><script>alert(1)</script>\u2028unsafe\u2029',
        }],
        turns: [],
        capsules: [],
        preferences: [],
      },
    };

    const serialized = serializeRecoverySnapshot(snapshot);

    expect(createRecoveryFilename(EXPORTED_AT)).toBe('specular-recovery-2026-07-09.json');
    expect(serialized).not.toContain('<script>');
    expect(serialized).not.toContain('\u2028');
    expect(serialized).not.toContain('\u2029');
    expect(JSON.parse(serialized)).toEqual(snapshot);
    expect(() => serializeRecoverySnapshot({
      ...snapshot,
      stores: {
        ...snapshot.stores,
        threads: [{ ownerScope: 'other', id: 'foreign' }],
      },
    })).toThrow(/invalid/i);
  });

  it('deletes all local content permanently without deleting another owner', async () => {
    const factory = new IDBFactory();
    const repositories = await createLocalRepositories('local', factory);
    await seedCompleteThread(repositories);
    await seedRawAggregate(factory, DATABASE_NAME, 'threads', {
      ...makeThread({ id: 'thread-other' }),
      ownerScope: 'other',
    });

    await repositories.export.deleteAll();

    expect(await repositories.threads.list()).toEqual([]);
    expect(await repositories.turns.listByThread(asThreadId('thread-1'))).toEqual([]);
    expect(await repositories.capsules.list()).toEqual([]);
    expect(await repositories.preferences.list()).toEqual([]);
    expect(await getRawAggregates(factory, DATABASE_NAME, 'threads')).toEqual([
      expect.objectContaining({ id: 'thread-other', ownerScope: 'other' }),
    ]);
    repositories.close();
  });

  it('reads recovery data through owner-prefixed key ranges', async () => {
    const factory = new IDBFactory();
    const repositories = await createLocalRepositories('local', factory);
    await repositories.threads.put(makeThread({ id: 'thread-local' }));
    repositories.close();
    await seedRawAggregate(factory, DATABASE_NAME, 'threads', {
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
    const baseFactory = new IDBFactory();
    const original = await createLocalRepositories('local', baseFactory);
    await original.threads.put(makeThread({
      id: 'thread-preserved',
      title: 'private migration sentinel',
    }));
    original.close();

    const factory = new AbortNextUpgradeFactory(baseFactory, 2);

    let migrationError: unknown;
    try {
      await createLocalRepositories('local', factory);
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

    const preservedDatabase = await openRawDatabase(baseFactory, DATABASE_NAME);
    expect(preservedDatabase.version).toBe(1);
    preservedDatabase.close();
  });

  it('preserves the failed database until authorized reset and then initializes fresh storage', async () => {
    const baseFactory = new IDBFactory();
    const original = await createLocalRepositories('local', baseFactory);
    await original.threads.put(makeThread({
      id: 'thread-preserved-until-reset',
      title: 'Preserve before explicit reset',
    }));
    original.close();
    const factory = new AbortNextUpgradeFactory(baseFactory, 2);

    await expect(createLocalRepositories('local', factory)).rejects.toBeInstanceOf(
      StorageMigrationError,
    );
    expect(await getRawAggregates(baseFactory, DATABASE_NAME, 'threads')).toEqual([
      expect.objectContaining({ id: 'thread-preserved-until-reset' }),
    ]);

    await resetLocalDatabase('local', factory);
    const fresh = await createLocalRepositories('local', factory);

    expect(await fresh.threads.list()).toEqual([]);
    expect(await fresh.capsules.list()).toEqual([]);
    fresh.close();
  });

  it('rejects an invalid reset owner without deleting local data', async () => {
    const factory = new IDBFactory();
    const repositories = await createLocalRepositories('local', factory);
    await repositories.threads.put(makeThread({ id: 'thread-blocked-reset' }));
    repositories.close();

    await expect(
      resetLocalDatabase('other' as unknown as 'local', factory),
    ).rejects.toThrow(/local ownership/i);
    expect(await getRawAggregates(factory, DATABASE_NAME, 'threads')).toEqual([
      expect.objectContaining({ id: 'thread-blocked-reset' }),
    ]);
  });

  it('keeps a blocked reset pending until the delete request reaches terminal success', async () => {
    const baseFactory = new IDBFactory();
    const repositories = await createLocalRepositories('local', baseFactory);
    await repositories.threads.put(makeThread({ id: 'thread-blocked-reset' }));
    repositories.close();
    const blocker = await openRawDatabase(baseFactory, DATABASE_NAME);
    const factory = new ObserveBlockedDeleteFactory(baseFactory);
    let outcome: 'pending' | 'rejected' | 'resolved' = 'pending';

    const reset = resetLocalDatabase('local', factory);
    void reset.then(
      () => { outcome = 'resolved'; },
      () => { outcome = 'rejected'; },
    );
    await factory.blocked;
    await Promise.resolve();
    await Promise.resolve();

    expect(outcome).toBe('pending');
    const transaction = blocker.transaction('threads', 'readonly');
    const records = await new Promise<unknown[]>((resolve, reject) => {
      const request = transaction.objectStore('threads').getAll();
      request.addEventListener('success', () => { resolve(request.result); });
      request.addEventListener('error', () => {
        reject(request.error ?? new Error('Unable to inspect blocked reset data.'));
      });
    });
    expect(records).toEqual([
      expect.objectContaining({ id: 'thread-blocked-reset' }),
    ]);

    blocker.close();
    await expect(reset).resolves.toBeUndefined();
    expect(outcome).toBe('resolved');
  });
});
