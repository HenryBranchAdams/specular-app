import type { IDBPDatabase, IDBPTransaction } from 'idb';
import type { SpecularDbSchema, SpecularStoreName } from './indexed-db';

export interface Migration {
  version: number;
  migrate(
    database: IDBPDatabase<SpecularDbSchema>,
    transaction: IDBPTransaction<SpecularDbSchema, SpecularStoreName[], 'versionchange'>,
  ): void;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    migrate(database) {
      const threads = database.createObjectStore('threads', {
        keyPath: ['ownerScope', 'id'],
      });
      threads.createIndex('by-owner-updated', ['ownerScope', 'updatedAt']);

      const turns = database.createObjectStore('turns', {
        keyPath: ['ownerScope', 'id'],
      });
      turns.createIndex('by-thread-position', ['ownerScope', 'threadId', 'position']);

      const capsules = database.createObjectStore('capsules', {
        keyPath: ['ownerScope', 'id'],
      });
      capsules.createIndex('by-owner-updated', ['ownerScope', 'updatedAt']);

      database.createObjectStore('preferences', {
        keyPath: ['ownerScope', 'key'],
      });
    },
  },
];
