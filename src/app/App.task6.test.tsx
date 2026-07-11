import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  ConversationService,
  type ConversationIdGenerator,
  type ServiceResult,
} from '../application/conversation-service';
import type {
  ChallengeResult,
  NextQuestionResult,
  QuestioningProvider,
  Thread,
  ThreadContext,
  ThreadUnderstanding,
  WorkingConclusionResult,
} from '../domain/contracts';
import {
  capsuleIdSchema,
  threadIdSchema,
  turnIdSchema,
} from '../domain/schemas';
import {
  createLocalRepositories,
  exportRecoverySnapshot,
  resetLocalDatabase,
} from '../storage/indexed-db';
import { AbortNextUpgradeFactory } from '../storage/indexed-db.test-support';
import type { LocalRepositories } from '../storage/repositories';
import { App } from './App';
import type { DownloadFile } from './download';
import type {
  SpecularDependencies,
  SpecularRuntime,
} from './use-specular';
import { useSpecular } from './use-specular';

const EMPTY_UNDERSTANDING: ThreadUnderstanding = {
  claims: [],
  observations: [],
  stakeholders: [],
  contexts: [],
  distinctions: [],
  tensions: [],
  exploredBlindSpots: [],
  unexploredBlindSpots: [],
};

const QUESTION: NextQuestionResult = {
  kind: 'question',
  question: 'Which boundary would make this choice easier to test?',
  understanding: EMPTY_UNDERSTANDING,
};

class TaskSixProvider implements QuestioningProvider {
  nextQuestion(): Promise<NextQuestionResult> {
    return Promise.resolve(QUESTION);
  }

  challenge(): Promise<ChallengeResult> {
    return Promise.resolve({
      kind: 'blind_spot',
      question: 'Whose perspective is still missing?',
    });
  }

  draftConclusion(context: ThreadContext): Promise<WorkingConclusionResult> {
    const source = context.turns.find((turn) => turn.role === 'user');
    if (source === undefined) {
      return Promise.reject(new Error('Expected user provenance.'));
    }
    return Promise.resolve({
      kind: 'working_conclusion',
      thesis: 'A reversible step best preserves room to learn.',
      insights: [
        'The decision can remain reversible.',
        'The evidence boundary remains explicit.',
        'A smaller move preserves momentum.',
      ],
      observations: ['The current option can be tested quickly.'],
      tensions: ['Waiting may reduce momentum.'],
      caveats: ['The thread contains one point of view.'],
      provenance: [{ turnId: source.id, excerpt: source.content }],
    });
  }
}

function createIds(prefix: string): ConversationIdGenerator {
  let thread = 0;
  let turn = 0;
  let capsule = 0;
  return {
    threadId: () => threadIdSchema.parse(`${prefix}-thread-${String(thread += 1)}`),
    turnId: () => turnIdSchema.parse(`${prefix}-turn-${String(turn += 1)}`),
    capsuleId: () => capsuleIdSchema.parse(`${prefix}-capsule-${String(capsule += 1)}`),
  };
}

interface Fixture {
  dependencies: SpecularDependencies;
  repositories: LocalRepositories;
  service: ConversationService;
}

const openRepositories: LocalRepositories[] = [];

async function createFixture(
  factory = new IDBFactory(),
  prefix = 'task6',
): Promise<Fixture> {
  const repositories = await createLocalRepositories('local', factory);
  const service = new ConversationService({
    repositories,
    client: new TaskSixProvider(),
    ids: createIds(prefix),
    now: (() => {
      let timestamp = 1_900_000_000_000;
      return () => timestamp += 1;
    })(),
  });
  openRepositories.push(repositories);
  return { dependencies: { repositories, service }, repositories, service };
}

function unwrap<T>(result: ServiceResult<T>): T {
  if (!result.ok) {
    throw new Error(`Expected success, received ${result.error.code}.`);
  }
  return result.value;
}

async function seedThread(fixture: Fixture, title = 'Decision clarity'): Promise<Thread> {
  const thread = unwrap(await fixture.service.startThread(title));
  return unwrap(await fixture.service.submitUserTurn(
    thread.id,
    'I need to decide without pretending I have complete certainty.',
  )).thread;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  while (openRepositories.length > 0) {
    openRepositories.pop()?.close();
  }
});

describe('Task 6 application flow', () => {
  it('opens synthesis only from Draft a working conclusion and keeps edited context on the same thread', async () => {
    const fixture = await createFixture();
    const seeded = await seedThread(fixture);
    await fixture.service.draftConclusion(seeded.id);
    const keepDigging = vi.spyOn(fixture.service, 'keepDigging');
    const user = userEvent.setup();
    render(<App dependencies={fixture.dependencies} downloadFile={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Decision clarity' })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Working conclusion' }))
      .not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Draft a working conclusion' }));
    const thesis = await screen.findByRole('textbox', { name: 'Working conclusion' });
    await user.clear(thesis);
    await user.type(thesis, 'My edited conclusion remains provisional on this thread.');
    await user.click(screen.getByRole('button', { name: 'Continue developing' }));

    await waitFor(() => {
      expect(keepDigging).toHaveBeenCalledWith(
        seeded.id,
        expect.objectContaining({
          thesis: 'My edited conclusion remains provisional on this thread.',
        }),
      );
      expect(screen.queryByRole('textbox', { name: 'Working conclusion' }))
        .not.toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Decision clarity' })).toBeVisible();
    expect((await fixture.repositories.threads.get(seeded.id))?.provisionalConclusion)
      .toMatchObject({ thesis: 'My edited conclusion remains provisional on this thread.' });
  });

  it('saves exact edited provenance, updates it in Capsules, exports safely, and confirms deletion', async () => {
    const fixture = await createFixture();
    const thread = await seedThread(fixture, 'A capsule worth keeping');
    const downloadFile = vi.fn<DownloadFile>();
    const exportAll = vi.spyOn(fixture.service, 'exportAll');
    const user = userEvent.setup();
    render(<App dependencies={fixture.dependencies} downloadFile={downloadFile} />);

    await user.click(await screen.findByRole('button', { name: 'Draft a working conclusion' }));
    const thesis = await screen.findByRole('textbox', { name: 'Working conclusion' });
    await user.clear(thesis);
    await user.type(thesis, 'This edited capsule preserves its exact source.');
    await user.click(screen.getByRole('button', { name: 'Save as capsule' }));

    expect(await screen.findByText('Capsule saved.')).toBeVisible();
    const [saved] = await fixture.repositories.capsules.list();
    expect(saved).toMatchObject({
      title: 'A capsule worth keeping',
      sourceThreadId: thread.id,
      conclusion: {
        thesis: 'This edited capsule preserves its exact source.',
        provenance: [expect.objectContaining({
          excerpt: 'I need to decide without pretending I have complete certainty.',
        })],
      },
    });

    await user.click(screen.getByRole('button', { name: /Open capsule library/u }));
    const library = await screen.findByRole('dialog', { name: 'Capsules' });
    await user.click(within(library).getByRole('button', { name: /A capsule worth keeping/u }));
    const capsuleThesis = within(library).getByRole('textbox', { name: 'Working conclusion' });
    await user.clear(capsuleThesis);
    await user.type(capsuleThesis, 'The capsule edit remains local and source-bound.');
    await user.click(within(library).getByRole('button', { name: 'Save capsule edits' }));

    await waitFor(async () => {
      expect((await fixture.repositories.capsules.get(saved?.id ?? capsuleIdSchema.parse('missing')))
        ?.conclusion.thesis).toBe('The capsule edit remains local and source-bound.');
    });

    await user.click(within(library).getByRole('button', { name: 'Export' }));
    await waitFor(() => {
      expect(exportAll).toHaveBeenCalledOnce();
      expect(downloadFile).toHaveBeenCalledOnce();
    });
    const [serialized, filename] = downloadFile.mock.calls[0] ?? [];
    expect(filename).toMatch(/^specular-export-\d{4}-\d{2}-\d{2}\.json$/u);
    expect(JSON.parse(String(serialized))).toMatchObject({
      ownerScope: 'local',
      capsules: [expect.objectContaining({ id: saved?.id })],
    });

    await user.click(within(library).getByRole('button', {
      name: 'Permanently delete capsule',
    }));
    const confirmation = screen.getByRole('alertdialog', {
      name: /A capsule worth keeping/u,
    });
    expect(confirmation).toHaveTextContent(/cannot be undone/i);
    await user.click(within(confirmation).getByRole('button', {
      name: 'Permanently delete capsule',
    }));

    await waitFor(async () => {
      expect(await fixture.repositories.capsules.list()).toEqual([]);
    });
  });

  it('saves and finishes the edited old line before rendering a fresh starter', async () => {
    const fixture = await createFixture();
    const oldThread = await seedThread(fixture, 'Finish this line');
    const user = userEvent.setup();
    render(<App dependencies={fixture.dependencies} downloadFile={vi.fn()} />);

    await user.click(await screen.findByRole('button', {
      name: 'Draft a working conclusion',
    }));
    const thesis = await screen.findByRole('textbox', { name: 'Working conclusion' });
    await user.clear(thesis);
    await user.type(thesis, 'The finished line retains my final edit.');
    await user.click(screen.getByRole('button', { name: 'Save & finish' }));

    expect(await screen.findByText('Saved and finished.')).toBeVisible();
    expect(await screen.findByRole('button', { name: 'What idea do you want to develop?' }))
      .toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Working conclusion' }))
      .not.toBeInTheDocument();
    const storedOld = await fixture.repositories.threads.get(oldThread.id);
    expect(storedOld).toMatchObject({
      lifecycleState: 'completed',
      provisionalConclusion: { thesis: 'The finished line retains my final edit.' },
    });
    const active = (await fixture.repositories.threads.list()).find(
      (candidate) => candidate.lifecycleState === 'active',
    );
    expect(active?.id).not.toBe(oldThread.id);
    expect(active?.turnIds).toEqual([]);
    expect(active?.provisionalConclusion).toBeUndefined();
    const [savedCapsule] = await fixture.repositories.capsules.list();
    expect(savedCapsule).toMatchObject({
        sourceThreadId: oldThread.id,
        title: oldThread.title,
        conclusion: {
          thesis: 'The finished line retains my final edit.',
        },
      });
  });

  it('reopens a capsule as a continuation, branch, or immediate challenge', async () => {
    const fixture = await createFixture();
    const thread = await seedThread(fixture, 'Market thesis');
    const drafted = unwrap(await fixture.service.draftConclusion(thread.id));
    const turns = await fixture.repositories.turns.listByThread(thread.id);
    const first = turns[0];
    const last = turns.at(-1);
    if (first === undefined || last === undefined) {
      throw new Error('Expected capsule source turns.');
    }
    const capsule = unwrap(await fixture.service.saveCapsule({
      threadId: thread.id,
      title: thread.title,
      conclusion: drafted.output,
      sourceTurnRange: { startTurnId: first.id, endTurnId: last.id },
    }));
    const { result } = renderHook(() => useSpecular(fixture.dependencies));
    await waitFor(() => { expect(result.current.initialized).toBe(true); });

    await act(async () => {
      expect(await result.current.continueCapsule(capsule.id)).toBe(true);
    });
    expect(result.current.thread).toMatchObject({
      title: 'Market thesis',
      provisionalConclusion: capsule.conclusion,
    });
    expect(result.current.notice).toBe('Continued from capsule.');

    await act(async () => {
      expect(await result.current.branchCapsule(capsule.id)).toBe(true);
    });
    expect(result.current.thread?.title).toBe('Market thesis — branch');
    expect(result.current.notice).toBe('Branch created from capsule.');

    await act(async () => {
      expect(await result.current.challengeCapsule(capsule.id)).toBe(true);
    });
    expect(result.current.turns.at(-1)).toMatchObject({
      operation: 'challenge',
      content: 'Whose perspective is still missing?',
    });
    expect(result.current.notice).toBe('Challenge started from capsule.');
  });

  it('requires title-bearing confirmation before deleting the current thread and its turns', async () => {
    const fixture = await createFixture();
    const thread = await seedThread(fixture, 'Delete this thread');
    const turnIds = (await fixture.repositories.turns.listByThread(thread.id))
      .map((turn) => turn.id);
    const user = userEvent.setup();
    render(<App dependencies={fixture.dependencies} downloadFile={vi.fn()} />);

    const composer = await screen.findByRole('textbox', { name: 'Idea, context, or response' });
    await user.type(composer, 'An unsent draft tied to the thread being deleted.');
    await user.click(await screen.findByRole('button', { name: /Open capsule library/u }));
    const library = screen.getByRole('dialog', { name: 'Capsules' });
    await user.click(within(library).getByRole('button', { name: 'More capsule actions' }));
    const deleteThread = within(library).getByRole('menuitem', { name: 'Delete current thread' });
    await user.click(deleteThread);

    let confirmation = screen.getByRole('alertdialog', { name: /Delete this thread/u });
    expect(confirmation).toHaveTextContent(/cannot be undone/i);
    await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    expect(deleteThread).toHaveFocus();
    expect(await fixture.repositories.threads.get(thread.id)).toBeDefined();

    await user.click(deleteThread);
    confirmation = screen.getByRole('alertdialog', { name: /Delete this thread/u });
    await user.click(within(confirmation).getByRole('button', {
      name: 'Permanently delete thread',
    }));

    expect(await screen.findByRole('button', { name: 'What idea do you want to develop?' }))
      .toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Idea, context, or response' })).toHaveValue('');
    expect(await fixture.repositories.threads.get(thread.id)).toBeUndefined();
    for (const turnId of turnIds) {
      expect(await fixture.repositories.turns.get(turnId)).toBeUndefined();
    }
  });

  it('deletes the confirmed old thread id without clearing a newer current thread', async () => {
    const fixture = await createFixture();
    const oldThread = await seedThread(fixture, 'Confirmed old thread');
    const drafted = unwrap(await fixture.service.draftConclusion(oldThread.id));
    const { result } = renderHook(() => useSpecular(fixture.dependencies));
    await waitFor(() => { expect(result.current.initialized).toBe(true); });

    act(() => { result.current.finish(drafted.output); });
    await waitFor(() => {
      expect(result.current.thread?.id).not.toBe(oldThread.id);
      expect(result.current.activity).toBeNull();
    });
    const freshThread = result.current.thread;
    if (freshThread === null) {
      throw new Error('Expected Finish to create a fresh current thread.');
    }

    await act(async () => {
      await result.current.deleteThread(oldThread.id);
    });

    expect(await fixture.repositories.threads.get(oldThread.id)).toBeUndefined();
    expect(await fixture.repositories.threads.get(freshThread.id)).toBeDefined();
    expect(result.current.thread?.id).toBe(freshThread.id);
  });

  it('requires a second confirmation before deleting every owner-scoped local record', async () => {
    const fixture = await createFixture();
    const thread = await seedThread(fixture, 'Delete all source');
    const drafted = unwrap(await fixture.service.draftConclusion(thread.id));
    const turns = await fixture.repositories.turns.listByThread(thread.id);
    const first = turns[0];
    const last = turns.at(-1);
    if (first === undefined || last === undefined) {
      throw new Error('Expected a complete capsule source range.');
    }
    unwrap(await fixture.service.saveCapsule({
      threadId: thread.id,
      title: 'Delete all capsule',
      conclusion: drafted.output,
      sourceTurnRange: { startTurnId: first.id, endTurnId: last.id },
    }));
    await fixture.repositories.preferences.put('task6-preference', true);
    const user = userEvent.setup();
    render(<App dependencies={fixture.dependencies} downloadFile={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Open capsule library/u }));
    const library = screen.getByRole('dialog', { name: 'Capsules' });
    await user.click(within(library).getByRole('button', { name: 'More capsule actions' }));
    await user.click(within(library).getByRole('menuitem', { name: 'Delete all local content' }));

    const confirmation = screen.getByRole('alertdialog', { name: /All local content/u });
    expect(confirmation).toHaveTextContent(/cannot be undone/i);
    expect(await fixture.repositories.threads.get(thread.id)).toBeDefined();
    await user.click(within(confirmation).getByRole('button', {
      name: 'Permanently delete all local content',
    }));

    expect(await screen.findByRole('button', { name: 'What idea do you want to develop?' }))
      .toBeVisible();
    expect(await fixture.repositories.threads.list()).toEqual([]);
    expect(await fixture.repositories.turns.listByThread(thread.id)).toEqual([]);
    expect(await fixture.repositories.capsules.list()).toEqual([]);
    expect(await fixture.repositories.preferences.list()).toEqual([]);
  });

  it('blocks normal UI on migration failure, downloads recovery, confirms reset, and reinitializes clean', async () => {
    const baseFactory = new IDBFactory();
    const original = await createFixture(baseFactory, 'migration-original');
    await seedThread(original, 'Preserved migration data');
    original.repositories.close();
    const migrationFactory = new AbortNextUpgradeFactory(baseFactory, 2);
    let cleanRepositories: LocalRepositories | null = null;
    const runtime: SpecularRuntime = {
      async createDependencies() {
        const repositories = await createLocalRepositories('local', migrationFactory);
        cleanRepositories = repositories;
        openRepositories.push(repositories);
        return {
          repositories,
          service: new ConversationService({
            repositories,
            client: new TaskSixProvider(),
            ids: createIds('migration-clean'),
          }),
          close() {
            repositories.close();
          },
        };
      },
      exportRecoverySnapshot: () => exportRecoverySnapshot('local', migrationFactory),
      resetLocalData: () => resetLocalDatabase('local', migrationFactory),
    };
    const downloadFile = vi.fn<DownloadFile>();
    const user = userEvent.setup();

    render(<App downloadFile={downloadFile} runtime={runtime} />);

    expect(await screen.findByRole('heading', { name: 'Your local data needs attention' }))
      .toBeVisible();
    expect(screen.queryByRole('button', { name: 'Send input' })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('specular-local');
    expect(document.body).not.toHaveTextContent('StorageMigrationError');

    await user.click(screen.getByRole('button', { name: 'Download recovery copy' }));
    await waitFor(() => {
      expect(downloadFile).toHaveBeenCalledOnce();
    });
    const [recoveryJson, recoveryFilename] = downloadFile.mock.calls[0] ?? [];
    expect(recoveryFilename).toMatch(/^specular-recovery-\d{4}-\d{2}-\d{2}\.json$/u);
    expect(JSON.parse(String(recoveryJson))).toMatchObject({
      ownerScope: 'local',
      stores: {
        threads: [expect.objectContaining({ title: 'Preserved migration data' })],
      },
    });

    await user.click(screen.getByRole('button', { name: 'Reset local data' }));
    const confirmation = screen.getByRole('alertdialog', { name: /All local data/u });
    await user.click(within(confirmation).getByRole('button', {
      name: 'Permanently reset local data',
    }));

    expect(await screen.findByRole('button', { name: 'What idea do you want to develop?' }))
      .toBeVisible();
    await act(async () => {
      expect(await cleanRepositories?.threads.list()).toEqual([]);
      expect(await cleanRepositories?.capsules.list()).toEqual([]);
    });
  });
});
