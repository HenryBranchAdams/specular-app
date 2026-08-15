import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createInitialWorkspace, type WorkspaceState } from '../thinking/model';
import {
  WorkspaceSynchronization,
  type CachedWorkspace,
  type WorkspaceCache,
  type WorkspaceRemote,
} from './workspace-sync';

class PropertyCache implements WorkspaceCache {
  readonly values = new Map<string, CachedWorkspace>();
  get = (namespace: string) => Promise.resolve(this.values.get(namespace) ?? null);
  put = (namespace: string, value: CachedWorkspace) => {
    this.values.set(namespace, structuredClone(value));
    return Promise.resolve();
  };
  delete = (namespace: string) => { this.values.delete(namespace); return Promise.resolve(); };
  close = () => undefined;
}

function titled(title: string): WorkspaceState {
  const workspace = createInitialWorkspace(1_800_000_000_000);
  const document = workspace.documents[0];
  const block = workspace.blocks[0];
  if (document === undefined || block === undefined) throw new Error('fixture');
  workspace.documents[0] = { ...document, title, titleSource: 'author' };
  workspace.blocks[0] = { ...block, content: `${title} canonical writing` };
  return workspace;
}

describe('workspace synchronization properties', () => {
  it('serializes arbitrary rapid authored edits without losing the final state', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.string({ minLength: 1, maxLength: 24 }), { minLength: 1, maxLength: 12 }),
      async (titles) => {
        const cache = new PropertyCache();
        let revision = 0;
        let server = titled('Base');
        const remote: WorkspaceRemote = {
          load: () => Promise.resolve({ revision, workspace: structuredClone(server) }),
          save: (request) => {
            if (request.baseRevision !== revision) {
              return Promise.resolve({ kind: 'conflict' as const, revision, workspace: structuredClone(server) });
            }
            revision += 1;
            server = structuredClone(request.workspace);
            return Promise.resolve({ kind: 'saved' as const, revision });
          },
        };
        const sync = new WorkspaceSynchronization('account:property', cache, remote);
        await sync.load();

        await Promise.all(titles.map((title) => sync.save(titled(title))));

        const expected = titles.at(-1);
        expect(server.documents[0]?.title).toBe(expected);
        expect(cache.values.get('account:property')).toMatchObject({
          pending: false,
          revision: titles.length,
          workspace: { documents: [expect.objectContaining({ title: expected })] },
        });
        expect(sync.currentStatus()).toBe('synchronized');
      },
    ), { numRuns: 30, seed: 20_260_815 });
  });
});
