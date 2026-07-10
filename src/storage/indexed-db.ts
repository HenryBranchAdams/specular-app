import {
  wrap,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
} from 'idb';
import type {
  Capsule,
  CapsuleId,
  OwnerScope,
  Thread,
  ThreadId,
  Turn,
  TurnId,
} from '../domain/contracts';
import {
  capsuleSchema,
  ownerScopeSchema,
  threadSchema,
  turnSchema,
} from '../domain/schemas';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  RECOVERY_FORMAT,
  RECOVERY_VERSION,
  parseSpecularExport,
  userPreferenceSchema,
  type RecoverySnapshot,
  type RecoveryStores,
  type SpecularExport,
} from './export';
import { migrations as schemaMigrations, type Migration } from './migrations';
import type {
  AcceptedExchangeWrite,
  CapsuleRepository,
  ConversationRepository,
  ExportRepository,
  FinishedThreadWrite,
  JsonValue,
  LocalRepositories,
  PendingTurnWrite,
  PreferencesRepository,
  SpecularTurnWrite,
  ThreadRepository,
  TurnRepository,
  UserPreference,
} from './repositories';

export const DATABASE_NAME = 'specular-local';
export const SPECULAR_DB_VERSION = 1;

export type SpecularStoreName = 'threads' | 'turns' | 'capsules' | 'preferences';

export interface SpecularDbSchema extends DBSchema {
  threads: {
    key: [OwnerScope, ThreadId];
    value: Thread;
    indexes: { 'by-owner-updated': [OwnerScope, number] };
  };
  turns: {
    key: [OwnerScope, TurnId];
    value: Turn;
    indexes: { 'by-thread-position': [OwnerScope, ThreadId, number] };
  };
  capsules: {
    key: [OwnerScope, CapsuleId];
    value: Capsule;
    indexes: { 'by-owner-updated': [OwnerScope, number] };
  };
  preferences: {
    key: [OwnerScope, string];
    value: UserPreference;
  };
}

interface OpenSpecularDatabaseOptions {
  databaseName?: string;
  version?: number;
  indexedDBFactory?: IDBFactory;
  migrations?: readonly Migration[];
}

export class StorageMigrationError extends Error {
  readonly databaseName: string;
  readonly fromVersion: number;
  readonly toVersion: number;

  constructor(databaseName: string, fromVersion: number, toVersion: number) {
    super(
      `Storage migration failed for ${databaseName} from version ${String(fromVersion)} to ${String(toVersion)}.`,
    );
    this.name = 'StorageMigrationError';
    this.databaseName = databaseName;
    this.fromVersion = fromVersion;
    this.toVersion = toVersion;
  }
}

export class StorageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageValidationError';
  }
}

const STORE_NAMES: SpecularStoreName[] = [
  'threads',
  'turns',
  'capsules',
  'preferences',
];
const migrationFailures = new WeakMap<IDBFactory, Map<string, StorageMigrationError>>();

function indexedDBFactoryOrDefault(factory?: IDBFactory): IDBFactory {
  const runtimeGlobal: { indexedDB?: IDBFactory } = globalThis;
  const selected = factory ?? runtimeGlobal.indexedDB;
  if (selected === undefined) {
    throw new Error('IndexedDB is unavailable.');
  }
  return selected;
}

function migrationFailureFor(
  factory: IDBFactory,
  databaseName: string,
): StorageMigrationError | undefined {
  return migrationFailures.get(factory)?.get(databaseName);
}

function rememberMigrationFailure(
  factory: IDBFactory,
  databaseName: string,
  error: StorageMigrationError,
): void {
  const failures = migrationFailures.get(factory) ?? new Map<string, StorageMigrationError>();
  failures.set(databaseName, error);
  migrationFailures.set(factory, failures);
}

function clearMigrationFailure(factory: IDBFactory, databaseName: string): void {
  const failures = migrationFailures.get(factory);
  if (failures === undefined) {
    return;
  }
  failures.delete(databaseName);
  if (failures.size === 0) {
    migrationFailures.delete(factory);
  }
}

function assertWritesAllowed(factory: IDBFactory, databaseName: string): void {
  const failure = migrationFailureFor(factory, databaseName);
  if (failure !== undefined) {
    throw failure;
  }
}

function applyMigrations(
  plan: readonly Migration[],
  database: IDBPDatabase<SpecularDbSchema>,
  transaction: IDBPTransaction<SpecularDbSchema, SpecularStoreName[], 'versionchange'>,
  fromVersion: number,
  toVersion: number,
): void {
  for (let version = fromVersion + 1; version <= toVersion; version += 1) {
    const matching = plan.filter((migration) => migration.version === version);
    if (matching.length !== 1) {
      throw new Error('The storage migration plan is incomplete or ambiguous.');
    }
    matching[0]?.migrate(database, transaction);
  }
}

function openSpecularDatabase(
  options: OpenSpecularDatabaseOptions = {},
): Promise<IDBPDatabase<SpecularDbSchema>> {
  const databaseName = options.databaseName ?? DATABASE_NAME;
  const version = options.version ?? SPECULAR_DB_VERSION;
  const factory = indexedDBFactoryOrDefault(options.indexedDBFactory);
  const plan = options.migrations ?? schemaMigrations;
  const previousFailure = migrationFailureFor(factory, databaseName);
  if (previousFailure !== undefined) {
    return Promise.reject(previousFailure);
  }

  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, version);
    let migrationError: StorageMigrationError | undefined;
    let migrationAttempt: { fromVersion: number; toVersion: number } | undefined;

    request.addEventListener('upgradeneeded', (event) => {
      const transaction = request.transaction;
      const toVersion = event.newVersion ?? version;
      migrationAttempt = { fromVersion: event.oldVersion, toVersion };
      const captureMigrationFailure = () => {
        migrationError ??= new StorageMigrationError(
          databaseName,
          event.oldVersion,
          toVersion,
        );
      };
      if (transaction === null || event.newVersion === null) {
        captureMigrationFailure();
        transaction?.abort();
        return;
      }
      transaction.addEventListener('error', captureMigrationFailure);
      transaction.addEventListener('abort', captureMigrationFailure);

      try {
        const wrappedTransaction = wrap(transaction) as unknown as IDBPTransaction<
          SpecularDbSchema,
          SpecularStoreName[],
          'versionchange'
        >;
        void wrappedTransaction.done.catch(() => undefined);
        applyMigrations(
          plan,
          wrap(request.result) as IDBPDatabase<SpecularDbSchema>,
          wrappedTransaction,
          event.oldVersion,
          event.newVersion,
        );
      } catch {
        captureMigrationFailure();
        transaction.abort();
      }
    });

    request.addEventListener('success', () => {
      const rawDatabase = request.result;
      rawDatabase.addEventListener('versionchange', () => {
        rawDatabase.close();
      });
      resolve(wrap(rawDatabase) as IDBPDatabase<SpecularDbSchema>);
    });

    request.addEventListener('error', () => {
      if (migrationError === undefined && migrationAttempt !== undefined) {
        migrationError = new StorageMigrationError(
          databaseName,
          migrationAttempt.fromVersion,
          migrationAttempt.toVersion,
        );
      }
      if (migrationError !== undefined) {
        rememberMigrationFailure(factory, databaseName, migrationError);
        reject(migrationError);
        return;
      }
      reject(request.error ?? new Error('Unable to open IndexedDB.'));
    });
  });
}

function ownerIdRange(ownerScope: OwnerScope): IDBKeyRange {
  return IDBKeyRange.bound([ownerScope, ''], [ownerScope, '\uffff']);
}

function ownerUpdatedRange(ownerScope: OwnerScope): IDBKeyRange {
  return IDBKeyRange.bound([ownerScope, 0], [ownerScope, Number.MAX_VALUE]);
}

function threadPositionRange(ownerScope: OwnerScope, threadId: ThreadId): IDBKeyRange {
  return IDBKeyRange.bound(
    [ownerScope, threadId, 0],
    [ownerScope, threadId, Number.MAX_VALUE],
  );
}

function hasOwnerScope(value: unknown, ownerScope: OwnerScope): boolean {
  return typeof value === 'object'
    && value !== null
    && 'ownerScope' in value
    && value.ownerScope === ownerScope;
}

function parseThreadForOwner(value: unknown, ownerScope: OwnerScope): Thread {
  if (!hasOwnerScope(value, ownerScope)) {
    throw new StorageValidationError('Thread owner scope does not match the repository.');
  }
  const result = threadSchema.safeParse(value);
  if (!result.success) {
    throw new StorageValidationError('Invalid thread storage record.');
  }
  return result.data;
}

function parseTurnForOwner(value: unknown, ownerScope: OwnerScope): Turn {
  if (!hasOwnerScope(value, ownerScope)) {
    throw new StorageValidationError('Turn owner scope does not match the repository.');
  }
  const result = turnSchema.safeParse(value);
  if (!result.success) {
    throw new StorageValidationError('Invalid turn storage record.');
  }
  return result.data;
}

function parseCapsuleForOwner(value: unknown, ownerScope: OwnerScope): Capsule {
  if (!hasOwnerScope(value, ownerScope)) {
    throw new StorageValidationError('Capsule owner scope does not match the repository.');
  }
  const result = capsuleSchema.safeParse(value);
  if (!result.success) {
    throw new StorageValidationError('Invalid capsule storage record.');
  }
  return result.data;
}

function parsePreferenceForOwner(value: unknown, ownerScope: OwnerScope): UserPreference {
  if (!hasOwnerScope(value, ownerScope)) {
    throw new StorageValidationError('Preference owner scope does not match the repository.');
  }
  const result = userPreferenceSchema.safeParse(value);
  if (!result.success) {
    throw new StorageValidationError('Invalid preference storage record.');
  }
  return result.data;
}

interface AtomicTransaction {
  readonly done: Promise<void>;
  abort(): void;
}

function abortTransactionIfActive(transaction: AtomicTransaction): void {
  try {
    transaction.abort();
  } catch {
    return;
  }
}

async function runAtomicTransaction(
  transaction: AtomicTransaction,
  operation: () => Promise<void>,
): Promise<void> {
  const completion = transaction.done.then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  try {
    await operation();
    const result = await completion;
    if (!result.ok) {
      throw result.error;
    }
  } catch (error) {
    abortTransactionIfActive(transaction);
    await completion;
    throw error;
  }
}

async function enqueueAtomicWrites(
  operations: readonly (() => Promise<unknown>)[],
): Promise<void> {
  const pending: Promise<unknown>[] = [];
  try {
    operations.forEach((operation) => {
      pending.push(operation());
    });
  } catch (error) {
    await Promise.allSettled(pending);
    throw error;
  }
  await Promise.all(pending);
}

function assertConversationWrite(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new StorageValidationError(message);
  }
}

class IndexedDbThreadRepository implements ThreadRepository {
  constructor(
    private readonly database: IDBPDatabase<SpecularDbSchema>,
    private readonly ownerScope: OwnerScope,
    private readonly assertWritable: () => void,
  ) {}

  async get(id: ThreadId): Promise<Thread | undefined> {
    const stored = await this.database.get('threads', [this.ownerScope, id]);
    return stored === undefined
      ? undefined
      : parseThreadForOwner(stored, this.ownerScope);
  }

  async list(): Promise<Thread[]> {
    const stored = await this.database.getAllFromIndex(
      'threads',
      'by-owner-updated',
      ownerUpdatedRange(this.ownerScope),
    );
    return stored.reverse().map((thread) => parseThreadForOwner(thread, this.ownerScope));
  }

  async put(thread: Thread): Promise<void> {
    this.assertWritable();
    const validated = parseThreadForOwner(thread, this.ownerScope);
    await this.database.put('threads', validated);
  }

  async delete(id: ThreadId): Promise<void> {
    this.assertWritable();
    const transaction = this.database.transaction(['threads', 'turns'], 'readwrite');
    const turnStore = transaction.objectStore('turns');
    const turnKeys = await turnStore
      .index('by-thread-position')
      .getAllKeys(threadPositionRange(this.ownerScope, id));
    await Promise.all([
      transaction.objectStore('threads').delete([this.ownerScope, id]),
      ...turnKeys.map((key) => turnStore.delete(key)),
    ]);
    await transaction.done;
  }
}

class IndexedDbTurnRepository implements TurnRepository {
  constructor(
    private readonly database: IDBPDatabase<SpecularDbSchema>,
    private readonly ownerScope: OwnerScope,
    private readonly assertWritable: () => void,
  ) {}

  async get(id: TurnId): Promise<Turn | undefined> {
    const stored = await this.database.get('turns', [this.ownerScope, id]);
    return stored === undefined
      ? undefined
      : parseTurnForOwner(stored, this.ownerScope);
  }

  async listByThread(threadId: ThreadId): Promise<Turn[]> {
    const stored = await this.database.getAllFromIndex(
      'turns',
      'by-thread-position',
      threadPositionRange(this.ownerScope, threadId),
    );
    return stored.map((turn) => parseTurnForOwner(turn, this.ownerScope));
  }

  async put(turn: Turn): Promise<void> {
    this.assertWritable();
    const validated = parseTurnForOwner(turn, this.ownerScope);
    await this.database.put('turns', validated);
  }
}

class IndexedDbConversationRepository implements ConversationRepository {
  constructor(
    private readonly database: IDBPDatabase<SpecularDbSchema>,
    private readonly ownerScope: OwnerScope,
    private readonly assertWritable: () => void,
  ) {}

  async persistPendingTurn(write: PendingTurnWrite): Promise<void> {
    this.assertWritable();
    const thread = parseThreadForOwner(write.thread, this.ownerScope);
    const userTurn = parseTurnForOwner(write.userTurn, this.ownerScope);
    assertConversationWrite(
      thread.lifecycleState === 'active'
        && userTurn.role === 'user'
        && userTurn.deliveryState === 'pending'
        && userTurn.threadId === thread.id
        && thread.turnIds.includes(userTurn.id),
      'Invalid pending conversation write.',
    );

    const transaction = this.database.transaction(['threads', 'turns'], 'readwrite');
    await runAtomicTransaction(transaction, async () => {
      await enqueueAtomicWrites([
        () => transaction.objectStore('turns').put(userTurn),
        () => transaction.objectStore('threads').put(thread),
      ]);
    });
  }

  async acceptExchange(write: AcceptedExchangeWrite): Promise<void> {
    this.assertWritable();
    const thread = parseThreadForOwner(write.thread, this.ownerScope);
    const userTurn = parseTurnForOwner(write.userTurn, this.ownerScope);
    const responseTurn = parseTurnForOwner(write.responseTurn, this.ownerScope);
    assertConversationWrite(
      thread.lifecycleState === 'active'
        && userTurn.role === 'user'
        && userTurn.deliveryState === 'accepted'
        && responseTurn.role === 'specular'
        && responseTurn.deliveryState === 'accepted'
        && userTurn.threadId === thread.id
        && responseTurn.threadId === thread.id
        && userTurn.position < responseTurn.position
        && thread.turnIds.includes(userTurn.id)
        && thread.turnIds.includes(responseTurn.id),
      'Invalid accepted conversation exchange.',
    );

    const transaction = this.database.transaction(['threads', 'turns'], 'readwrite');
    await runAtomicTransaction(transaction, async () => {
      await enqueueAtomicWrites([
        () => transaction.objectStore('turns').put(userTurn),
        () => transaction.objectStore('turns').put(responseTurn),
        () => transaction.objectStore('threads').put(thread),
      ]);
    });
  }

  async persistSpecularTurn(write: SpecularTurnWrite): Promise<void> {
    this.assertWritable();
    const thread = parseThreadForOwner(write.thread, this.ownerScope);
    const responseTurn = parseTurnForOwner(write.responseTurn, this.ownerScope);
    assertConversationWrite(
      thread.lifecycleState === 'active'
        && responseTurn.role === 'specular'
        && responseTurn.deliveryState === 'accepted'
        && responseTurn.threadId === thread.id
        && thread.turnIds.includes(responseTurn.id),
      'Invalid Specular turn write.',
    );

    const transaction = this.database.transaction(['threads', 'turns'], 'readwrite');
    await runAtomicTransaction(transaction, async () => {
      await enqueueAtomicWrites([
        () => transaction.objectStore('turns').put(responseTurn),
        () => transaction.objectStore('threads').put(thread),
      ]);
    });
  }

  async finishAndStart(write: FinishedThreadWrite): Promise<void> {
    this.assertWritable();
    const completedThread = parseThreadForOwner(write.completedThread, this.ownerScope);
    const freshThread = parseThreadForOwner(write.freshThread, this.ownerScope);
    assertConversationWrite(
      completedThread.lifecycleState === 'completed'
        && completedThread.completedAt !== undefined
        && freshThread.lifecycleState === 'active'
        && freshThread.id !== completedThread.id
        && freshThread.turnIds.length === 0
        && freshThread.provisionalConclusion === undefined,
      'Invalid finished conversation write.',
    );

    const transaction = this.database.transaction('threads', 'readwrite');
    await runAtomicTransaction(transaction, async () => {
      await enqueueAtomicWrites([
        () => transaction.objectStore('threads').put(completedThread),
        () => transaction.objectStore('threads').put(freshThread),
      ]);
    });
  }
}

class IndexedDbCapsuleRepository implements CapsuleRepository {
  constructor(
    private readonly database: IDBPDatabase<SpecularDbSchema>,
    private readonly ownerScope: OwnerScope,
    private readonly assertWritable: () => void,
  ) {}

  async get(id: CapsuleId): Promise<Capsule | undefined> {
    const stored = await this.database.get('capsules', [this.ownerScope, id]);
    return stored === undefined
      ? undefined
      : parseCapsuleForOwner(stored, this.ownerScope);
  }

  async list(): Promise<Capsule[]> {
    const stored = await this.database.getAllFromIndex(
      'capsules',
      'by-owner-updated',
      ownerUpdatedRange(this.ownerScope),
    );
    return stored.reverse().map((capsule) => parseCapsuleForOwner(capsule, this.ownerScope));
  }

  async put(capsule: Capsule): Promise<void> {
    this.assertWritable();
    const validated = parseCapsuleForOwner(capsule, this.ownerScope);
    await this.database.put('capsules', validated);
  }

  async delete(id: CapsuleId): Promise<void> {
    this.assertWritable();
    await this.database.delete('capsules', [this.ownerScope, id]);
  }
}

class IndexedDbPreferencesRepository implements PreferencesRepository {
  constructor(
    private readonly database: IDBPDatabase<SpecularDbSchema>,
    private readonly ownerScope: OwnerScope,
    private readonly assertWritable: () => void,
  ) {}

  async get(key: string): Promise<JsonValue | undefined> {
    const stored = await this.database.get('preferences', [this.ownerScope, key]);
    return stored === undefined
      ? undefined
      : parsePreferenceForOwner(stored, this.ownerScope).value;
  }

  async list(): Promise<UserPreference[]> {
    const stored = await this.database.getAll('preferences', ownerIdRange(this.ownerScope));
    return stored.map((preference) => parsePreferenceForOwner(preference, this.ownerScope));
  }

  async put(key: string, value: JsonValue): Promise<void> {
    this.assertWritable();
    const validated = parsePreferenceForOwner(
      { ownerScope: this.ownerScope, key, value },
      this.ownerScope,
    );
    await this.database.put('preferences', validated);
  }

  async delete(key: string): Promise<void> {
    this.assertWritable();
    await this.database.delete('preferences', [this.ownerScope, key]);
  }

  async mutatePair(
    firstKey: string,
    secondKey: string,
    mutation: (current: readonly [JsonValue | undefined, JsonValue | undefined]) =>
      readonly [JsonValue | undefined, JsonValue | undefined],
  ): Promise<void> {
    this.assertWritable();
    if (firstKey === secondKey) {
      throw new StorageValidationError('Preference mutation keys must be distinct.');
    }

    const transaction = this.database.transaction('preferences', 'readwrite');
    await runAtomicTransaction(transaction, async () => {
      const store = transaction.objectStore('preferences');
      const [firstStored, secondStored] = await Promise.all([
        store.get([this.ownerScope, firstKey]),
        store.get([this.ownerScope, secondKey]),
      ]);
      const current = [
        firstStored === undefined
          ? undefined
          : parsePreferenceForOwner(firstStored, this.ownerScope).value,
        secondStored === undefined
          ? undefined
          : parsePreferenceForOwner(secondStored, this.ownerScope).value,
      ] as const;
      const next: unknown = mutation(current);
      if (!Array.isArray(next) || next.length !== 2) {
        throw new StorageValidationError('Preference mutation returned an invalid pair.');
      }
      const pair = next as [JsonValue | undefined, JsonValue | undefined];
      const firstPreference = pair[0] === undefined
        ? undefined
        : parsePreferenceForOwner(
            { ownerScope: this.ownerScope, key: firstKey, value: pair[0] },
            this.ownerScope,
          );
      const secondPreference = pair[1] === undefined
        ? undefined
        : parsePreferenceForOwner(
            { ownerScope: this.ownerScope, key: secondKey, value: pair[1] },
            this.ownerScope,
          );
      await enqueueAtomicWrites([
        () => firstPreference === undefined
          ? store.delete([this.ownerScope, firstKey])
          : store.put(firstPreference),
        () => secondPreference === undefined
          ? store.delete([this.ownerScope, secondKey])
          : store.put(secondPreference),
      ]);
    });
  }
}

async function deleteOwnerRows(
  transaction: IDBPTransaction<SpecularDbSchema, SpecularStoreName[], 'readwrite'>,
  ownerScope: OwnerScope,
): Promise<void> {
  const range = ownerIdRange(ownerScope);
  const threads = transaction.objectStore('threads');
  const turns = transaction.objectStore('turns');
  const capsules = transaction.objectStore('capsules');
  const preferences = transaction.objectStore('preferences');
  const [threadKeys, turnKeys, capsuleKeys, preferenceKeys] = await Promise.all([
    threads.getAllKeys(range),
    turns.getAllKeys(range),
    capsules.getAllKeys(range),
    preferences.getAllKeys(range),
  ]);

  await Promise.all([
    ...threadKeys.map((key) => threads.delete(key)),
    ...turnKeys.map((key) => turns.delete(key)),
    ...capsuleKeys.map((key) => capsules.delete(key)),
    ...preferenceKeys.map((key) => preferences.delete(key)),
  ]);
}

async function exportAllFromDatabase(
  database: IDBPDatabase<SpecularDbSchema>,
  ownerScope: OwnerScope,
): Promise<SpecularExport> {
  const transaction = database.transaction(STORE_NAMES, 'readonly');
  const range = ownerIdRange(ownerScope);
  const [storedThreads, storedTurns, storedCapsules, storedPreferences] = await Promise.all([
    transaction.objectStore('threads').getAll(range),
    transaction.objectStore('turns').getAll(range),
    transaction.objectStore('capsules').getAll(range),
    transaction.objectStore('preferences').getAll(range),
  ]);
  await transaction.done;

  const archive: SpecularExport = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    ownerScope,
    threads: storedThreads.map((thread) => parseThreadForOwner(thread, ownerScope)),
    turns: storedTurns.map((turn) => parseTurnForOwner(turn, ownerScope)),
    capsules: storedCapsules.map((capsule) => parseCapsuleForOwner(capsule, ownerScope)),
    preferences: storedPreferences.map((preference) => (
      parsePreferenceForOwner(preference, ownerScope)
    )),
  };
  return parseSpecularExport(archive);
}

class IndexedDbExportRepository implements ExportRepository {
  constructor(
    private readonly database: IDBPDatabase<SpecularDbSchema>,
    private readonly ownerScope: OwnerScope,
    private readonly factory: IDBFactory,
    private readonly databaseName: string,
    private readonly assertWritable: () => void,
  ) {}

  exportAll(): Promise<SpecularExport> {
    return exportAllFromDatabase(this.database, this.ownerScope);
  }

  async importAll(input: unknown): Promise<void> {
    const archive = parseSpecularExport(input);
    this.assertWritable();

    const transaction = this.database.transaction(STORE_NAMES, 'readwrite');
    await deleteOwnerRows(transaction, this.ownerScope);
    await Promise.all([
      ...archive.threads.map((thread) => transaction.objectStore('threads').put(thread)),
      ...archive.turns.map((turn) => transaction.objectStore('turns').put(turn)),
      ...archive.capsules.map((capsule) => transaction.objectStore('capsules').put(capsule)),
      ...archive.preferences.map((preference) => (
        transaction.objectStore('preferences').put(preference)
      )),
    ]);
    await transaction.done;
  }

  async deleteAll(): Promise<void> {
    this.assertWritable();
    const transaction = this.database.transaction(STORE_NAMES, 'readwrite');
    await deleteOwnerRows(transaction, this.ownerScope);
    await transaction.done;
  }

  exportRecoverySnapshot(): Promise<RecoverySnapshot> {
    return exportRecoverySnapshot(this.ownerScope, this.factory, this.databaseName);
  }
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

function openExistingDatabase(
  factory: IDBFactory,
  databaseName: string,
): Promise<IDBDatabase | undefined> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName);
    let preventedCreation = false;

    request.addEventListener('upgradeneeded', () => {
      preventedCreation = true;
      request.transaction?.abort();
    });
    request.addEventListener('success', () => {
      resolve(request.result);
    });
    request.addEventListener('error', () => {
      if (preventedCreation) {
        resolve(undefined);
        return;
      }
      reject(request.error ?? new Error('Unable to open existing IndexedDB database.'));
    });
  });
}

function recoveryValuesForOwner(values: unknown[], ownerScope: OwnerScope): unknown[] {
  return values.filter((value) => hasOwnerScope(value, ownerScope));
}

export async function exportRecoverySnapshot(
  ownerScope: OwnerScope,
  indexedDBFactory?: IDBFactory,
  databaseName = DATABASE_NAME,
): Promise<RecoverySnapshot> {
  const parsedOwnerScope = ownerScopeSchema.safeParse(ownerScope);
  if (!parsedOwnerScope.success) {
    throw new StorageValidationError('Invalid recovery owner scope.');
  }
  const factory = indexedDBFactoryOrDefault(indexedDBFactory);
  const database = await openExistingDatabase(factory, databaseName);
  const stores: RecoveryStores = {
    threads: [],
    turns: [],
    capsules: [],
    preferences: [],
  };

  if (database === undefined) {
    return {
      format: RECOVERY_FORMAT,
      version: RECOVERY_VERSION,
      exportedAt: Date.now(),
      ownerScope: parsedOwnerScope.data,
      databaseName,
      databaseVersion: 0,
      stores,
    };
  }

  try {
    const availableStoreNames = STORE_NAMES.filter((name) => database.objectStoreNames.contains(name));
    if (availableStoreNames.length > 0) {
      const transaction = database.transaction(availableStoreNames, 'readonly');
      const range = ownerIdRange(parsedOwnerScope.data);
      const values = await Promise.all(availableStoreNames.map(async (name) => ({
        name,
        values: await requestResult(transaction.objectStore(name).getAll(range)),
      })));
      await transactionComplete(transaction);
      values.forEach(({ name, values: storeValues }) => {
        stores[name] = recoveryValuesForOwner(storeValues, parsedOwnerScope.data);
      });
    }

    return {
      format: RECOVERY_FORMAT,
      version: RECOVERY_VERSION,
      exportedAt: Date.now(),
      ownerScope: parsedOwnerScope.data,
      databaseName,
      databaseVersion: database.version,
      stores,
    };
  } finally {
    database.close();
  }
}

export async function resetLocalDatabase(
  ownerScope: OwnerScope,
  indexedDBFactory?: IDBFactory,
): Promise<void> {
  const parsedOwnerScope = ownerScopeSchema.safeParse(ownerScope);
  if (!parsedOwnerScope.success) {
    throw new StorageValidationError('Reset requires local ownership.');
  }
  const factory = indexedDBFactoryOrDefault(indexedDBFactory);

  await new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase(DATABASE_NAME);
    let settled = false;
    request.addEventListener('success', () => {
      clearMigrationFailure(factory, DATABASE_NAME);
      if (!settled) {
        settled = true;
        resolve();
      }
    });
    request.addEventListener('error', () => {
      if (!settled) {
        settled = true;
        reject(request.error ?? new Error('Local data reset failed.'));
      }
    });
  });
}

export async function createLocalRepositories(
  ownerScope: OwnerScope,
  indexedDBFactory?: IDBFactory,
): Promise<LocalRepositories> {
  const parsedOwnerScope = ownerScopeSchema.safeParse(ownerScope);
  if (!parsedOwnerScope.success) {
    throw new StorageValidationError('Only local ownership is supported.');
  }
  const factory = indexedDBFactoryOrDefault(indexedDBFactory);
  assertWritesAllowed(factory, DATABASE_NAME);
  const database = await openSpecularDatabase({
    databaseName: DATABASE_NAME,
    version: SPECULAR_DB_VERSION,
    indexedDBFactory: factory,
    migrations: schemaMigrations,
  });
  const assertWritable = () => {
    assertWritesAllowed(factory, DATABASE_NAME);
  };

  return {
    threads: new IndexedDbThreadRepository(database, parsedOwnerScope.data, assertWritable),
    turns: new IndexedDbTurnRepository(database, parsedOwnerScope.data, assertWritable),
    conversation: new IndexedDbConversationRepository(
      database,
      parsedOwnerScope.data,
      assertWritable,
    ),
    capsules: new IndexedDbCapsuleRepository(database, parsedOwnerScope.data, assertWritable),
    preferences: new IndexedDbPreferencesRepository(
      database,
      parsedOwnerScope.data,
      assertWritable,
    ),
    export: new IndexedDbExportRepository(
      database,
      parsedOwnerScope.data,
      factory,
      DATABASE_NAME,
      assertWritable,
    ),
    close() {
      database.close();
    },
  };
}
