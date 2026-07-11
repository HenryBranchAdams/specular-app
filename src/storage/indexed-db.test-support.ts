export class AbortNextUpgradeFactory implements IDBFactory {
  private intercepted = false;

  constructor(
    private readonly factory: IDBFactory,
    private readonly forcedFirstVersion?: number,
  ) {}

  cmp(first: IDBValidKey, second: IDBValidKey): number {
    return this.factory.cmp(first, second);
  }

  databases(): Promise<IDBDatabaseInfo[]> {
    return this.factory.databases();
  }

  deleteDatabase(name: string): IDBOpenDBRequest {
    return this.factory.deleteDatabase(name);
  }

  open(name: string, version?: number): IDBOpenDBRequest {
    const shouldIntercept = !this.intercepted;
    const requestedVersion = shouldIntercept
      ? (this.forcedFirstVersion ?? version)
      : version;
    this.intercepted = true;
    const request = requestedVersion === undefined
      ? this.factory.open(name)
      : this.factory.open(name, requestedVersion);

    if (shouldIntercept) {
      request.addEventListener('upgradeneeded', () => {
        request.transaction?.abort();
      });
    }
    return request;
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

export async function openRawDatabase(
  factory: IDBFactory,
  databaseName: string,
): Promise<IDBDatabase> {
  return requestResult(factory.open(databaseName));
}

export async function seedRawAggregate(
  factory: IDBFactory,
  databaseName: string,
  storeName: string,
  aggregate: unknown,
): Promise<void> {
  const database = await openRawDatabase(factory, databaseName);
  const transaction = database.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).put(aggregate);
  await transactionComplete(transaction);
  database.close();
}

export async function getRawAggregates(
  factory: IDBFactory,
  databaseName: string,
  storeName: string,
): Promise<unknown[]> {
  const database = await openRawDatabase(factory, databaseName);
  const transaction = database.transaction(storeName, 'readonly');
  const result: unknown = await requestResult(transaction.objectStore(storeName).getAll());
  await transactionComplete(transaction);
  database.close();
  if (!Array.isArray(result)) {
    throw new Error('Expected IndexedDB getAll to return an array.');
  }
  return result.map((value: unknown) => value);
}
