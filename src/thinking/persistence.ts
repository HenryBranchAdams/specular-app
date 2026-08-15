import { OWNER_SCOPE } from '../domain/contracts';
import { createLocalRepositories } from '../storage/indexed-db';
import type { LocalRepositories } from '../storage/repositories';
import {
  createInitialWorkspace,
  workspaceStateSchema,
  type WorkspaceState,
} from './model';

const WORKSPACE_KEY = 'thinking-workspace-v1';

export interface WorkspaceStore {
  load(): Promise<WorkspaceState>;
  save(state: WorkspaceState): Promise<WorkspaceState | undefined>;
  subscribeStatus?(listener: (status: 'synchronized' | 'synchronizing' | 'unsynced' | 'locked') => void): () => void;
  currentStatus?(): 'synchronized' | 'synchronizing' | 'unsynced' | 'locked';
  clear?(): Promise<void>;
  close(): void;
}

export function recoverWorkspaceState(state: WorkspaceState): WorkspaceState {
  const draft = state.dictationDraft;
  if (draft === null || !['requesting', 'recording', 'processing'].includes(draft.status)) {
    return state;
  }

  return workspaceStateSchema.parse({
    ...state,
    dictationDraft: {
      ...draft,
      status: 'interrupted',
      interruptionReason: 'storage_failure',
      updatedAt: Date.now(),
    },
  });
}

class IndexedDbWorkspaceStore implements WorkspaceStore {
  constructor(private readonly repositories: LocalRepositories) {}

  async load(): Promise<WorkspaceState> {
    const value = await this.repositories.preferences.get(WORKSPACE_KEY);
    const parsed = workspaceStateSchema.safeParse(value);
    return parsed.success ? recoverWorkspaceState(parsed.data) : createInitialWorkspace();
  }

  async save(state: WorkspaceState): Promise<WorkspaceState> {
    const parsed = workspaceStateSchema.parse(state);
    await this.repositories.preferences.put(WORKSPACE_KEY, parsed);
    return parsed;
  }

  close(): void {
    this.repositories.close();
  }
}

export async function createWorkspaceStore(): Promise<WorkspaceStore> {
  return new IndexedDbWorkspaceStore(await createLocalRepositories(OWNER_SCOPE));
}
