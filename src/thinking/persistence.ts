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
  save(state: WorkspaceState): Promise<void>;
  close(): void;
}

class IndexedDbWorkspaceStore implements WorkspaceStore {
  constructor(private readonly repositories: LocalRepositories) {}

  async load(): Promise<WorkspaceState> {
    const value = await this.repositories.preferences.get(WORKSPACE_KEY);
    const parsed = workspaceStateSchema.safeParse(value);
    return parsed.success ? parsed.data : createInitialWorkspace();
  }

  async save(state: WorkspaceState): Promise<void> {
    const parsed = workspaceStateSchema.parse(state);
    await this.repositories.preferences.put(WORKSPACE_KEY, parsed);
  }

  close(): void {
    this.repositories.close();
  }
}

export async function createWorkspaceStore(): Promise<WorkspaceStore> {
  return new IndexedDbWorkspaceStore(await createLocalRepositories(OWNER_SCOPE));
}
