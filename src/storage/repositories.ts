import type {
  Capsule,
  CapsuleId,
  OwnerScope,
  Thread,
  ThreadId,
  Turn,
  TurnId,
} from '../domain/contracts';
import type { RecoverySnapshot, SpecularExport } from './export';

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface UserPreference {
  ownerScope: OwnerScope;
  key: string;
  value: JsonValue;
}

export interface ThreadRepository {
  get(id: ThreadId): Promise<Thread | undefined>;
  list(): Promise<Thread[]>;
  put(thread: Thread): Promise<void>;
  delete(id: ThreadId): Promise<void>;
}

export interface TurnRepository {
  get(id: TurnId): Promise<Turn | undefined>;
  listByThread(threadId: ThreadId): Promise<Turn[]>;
  put(turn: Turn): Promise<void>;
}

export interface PendingTurnWrite {
  thread: Thread;
  userTurn: Turn;
}

export interface AcceptedExchangeWrite {
  thread: Thread;
  userTurn: Turn;
  responseTurn: Turn;
}

export interface SpecularTurnWrite {
  thread: Thread;
  responseTurn: Turn;
}

export interface FinishedThreadWrite {
  capsule?: Capsule;
  completedThread: Thread;
  freshThread: Thread;
}

export interface ConversationRepository {
  persistPendingTurn(write: PendingTurnWrite): Promise<void>;
  acceptExchange(write: AcceptedExchangeWrite): Promise<void>;
  persistSpecularTurn(write: SpecularTurnWrite): Promise<void>;
  finishAndStart(write: FinishedThreadWrite): Promise<void>;
}

export interface CapsuleRepository {
  get(id: CapsuleId): Promise<Capsule | undefined>;
  list(): Promise<Capsule[]>;
  put(capsule: Capsule): Promise<void>;
  delete(id: CapsuleId): Promise<void>;
}

export interface PreferencesRepository {
  get(key: string): Promise<JsonValue | undefined>;
  list(): Promise<UserPreference[]>;
  put(key: string, value: JsonValue): Promise<void>;
  delete(key: string): Promise<void>;
  mutatePair(
    firstKey: string,
    secondKey: string,
    mutation: (current: readonly [JsonValue | undefined, JsonValue | undefined]) =>
      readonly [JsonValue | undefined, JsonValue | undefined],
  ): Promise<void>;
}

export interface ExportRepository {
  exportAll(): Promise<SpecularExport>;
  importAll(archive: unknown): Promise<void>;
  deleteAll(): Promise<void>;
  exportRecoverySnapshot(): Promise<RecoverySnapshot>;
}

export interface LocalRepositories {
  threads: ThreadRepository;
  turns: TurnRepository;
  conversation: ConversationRepository;
  capsules: CapsuleRepository;
  preferences: PreferencesRepository;
  export: ExportRepository;
  close(): void;
}
