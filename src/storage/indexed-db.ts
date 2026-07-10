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
  CapsuleRepository,
  ExportRepository,
  JsonValue,
  LocalRepositories,
  PreferencesRepository,
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

export interface OpenSpecularDatabaseOptions {
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

export function openSpecularDatabase(
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
  const database = await requestResult(factory.open(databaseName));
  const stores: RecoveryStores = {
    threads: [],
    turns: [],
    capsules: [],
    preferences: [],
  };

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
