import {
  act,
  cleanup,
  render,
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
import { QuestioningClientError } from '../application/http-questioning-client';
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
import { createLocalRepositories } from '../storage/indexed-db';
import type { LocalRepositories } from '../storage/repositories';
import { App } from './App';
import type { SpecularDependencies } from './use-specular';

const STARTERS = [
  'What are you thinking about?',
  'Give me a hot take.',
  'Had any new ideas lately?',
  'What can’t you quite articulate?',
  'What’s been on your mind?',
  'Bring me something unfinished.',
  'What are you reconsidering?',
  'What feels true but still blurry?',
] as const;

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

const VALID_QUESTION: NextQuestionResult = {
  kind: 'question',
  question: 'Which concrete detail would sharpen the distinction?',
  understanding: EMPTY_UNDERSTANDING,
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      if (resolvePromise === undefined) {
        throw new Error('Deferred promise was not initialized.');
      }
      resolvePromise(value);
    },
  };
}

class DeterministicQuestioningProvider implements QuestioningProvider {
  nextQuestionCalls = 0;
  challengeCalls = 0;
  conclusionCalls = 0;

  nextQuestionHandler: (context: ThreadContext) => Promise<NextQuestionResult> =
    () => Promise.resolve(VALID_QUESTION);

  challengeHandler: (context: ThreadContext) => Promise<ChallengeResult> =
    () => Promise.resolve({
      kind: 'blind_spot',
      question: 'Which stakeholder bears the cost if this assumption fails?',
    });

  conclusionHandler: (context: ThreadContext) => Promise<WorkingConclusionResult> =
    (context) => {
      const sourceTurn = context.turns.find((turn) => turn.role === 'user');
      if (sourceTurn === undefined) {
        return Promise.reject(new Error('A conclusion needs user provenance.'));
      }
      return Promise.resolve({
        kind: 'working_conclusion',
        thesis: 'My current read is that a concrete boundary would make the decision easier.',
        insights: [
          'The uncertainty is attached to the boundary.',
          'The decision can remain reversible.',
          'A concrete example would expose the tradeoff.',
        ],
        observations: ['The user is looking for a sharper distinction.'],
        tensions: ['More certainty may delay a reversible choice.'],
        caveats: ['The thread contains only the user’s current account.'],
        provenance: [{ turnId: sourceTurn.id, excerpt: sourceTurn.content }],
      });
    };

  nextQuestion(context: ThreadContext): Promise<NextQuestionResult> {
    this.nextQuestionCalls += 1;
    return this.nextQuestionHandler(context);
  }

  challenge(context: ThreadContext): Promise<ChallengeResult> {
    this.challengeCalls += 1;
    return this.challengeHandler(context);
  }

  draftConclusion(context: ThreadContext): Promise<WorkingConclusionResult> {
    this.conclusionCalls += 1;
    return this.conclusionHandler(context);
  }
}

interface Fixture {
  dependencies: SpecularDependencies;
  provider: DeterministicQuestioningProvider;
  repositories: LocalRepositories;
  service: ConversationService;
}

const openRepositories: LocalRepositories[] = [];

function createIds(): ConversationIdGenerator {
  let threadCount = 0;
  let turnCount = 0;
  let capsuleCount = 0;
  return {
    threadId: () => threadIdSchema.parse(`thread-ui-${String(threadCount += 1)}`),
    turnId: () => turnIdSchema.parse(`turn-ui-${String(turnCount += 1)}`),
    capsuleId: () => capsuleIdSchema.parse(`capsule-ui-${String(capsuleCount += 1)}`),
  };
}

async function createFixture(
  provider = new DeterministicQuestioningProvider(),
): Promise<Fixture> {
  const repositories = await createLocalRepositories('local', new IDBFactory());
  const service = new ConversationService({
    repositories,
    client: provider,
    ids: createIds(),
    now: (() => {
      let timestamp = 1_800_000_000_000;
      return () => timestamp += 1;
    })(),
  });
  openRepositories.push(repositories);
  return {
    dependencies: { repositories, service },
    provider,
    repositories,
    service,
  };
}

function unwrap<T>(result: ServiceResult<T>): T {
  if (!result.ok) {
    throw new Error(`Expected service success, received ${result.error.code}.`);
  }
  return result.value;
}

async function seedActiveThread(
  fixture: Fixture,
  userMessages: readonly string[] = ['I need to decide what counts as enough evidence.'],
  title = 'Decision clarity',
): Promise<Thread> {
  let thread = unwrap(await fixture.service.startThread(title));
  for (const message of userMessages) {
    thread = unwrap(await fixture.service.submitUserTurn(thread.id, message)).thread;
  }
  return thread;
}

function setReducedMotion(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string): MediaQueryList => ({
      matches: query === '(prefers-reduced-motion: reduce)' && matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })),
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  while (openRepositories.length > 0) {
    openRepositories.pop()?.close();
  }
  setReducedMotion(false);
});

describe('Specular mobile thinking loop', () => {
  it('renders all eight exact interchangeable starters', async () => {
    const { dependencies } = await createFixture();
    render(<App dependencies={dependencies} />);

    for (const starter of STARTERS) {
      expect(await screen.findByRole('button', { name: starter })).toBeVisible();
    }
  });

  it('focuses the composer from a starter without starting a thread or selecting a strategy', async () => {
    const { dependencies, provider, service } = await createFixture();
    const user = userEvent.setup();
    const startThread = vi.spyOn(service, 'startThread');
    const submitUserTurn = vi.spyOn(service, 'submitUserTurn');
    const challenge = vi.spyOn(service, 'challenge');
    const draftConclusion = vi.spyOn(service, 'draftConclusion');
    render(<App dependencies={dependencies} />);

    await user.click(await screen.findByRole('button', { name: STARTERS[3] }));

    expect(screen.getByRole('textbox', { name: 'Your thought' })).toHaveFocus();
    expect(startThread).not.toHaveBeenCalled();
    expect(submitUserTurn).not.toHaveBeenCalled();
    expect(challenge).not.toHaveBeenCalled();
    expect(draftConclusion).not.toHaveBeenCalled();
    expect(provider.nextQuestionCalls).toBe(0);
    expect(document.querySelector('[name="strategy"], [name="mode"], [name="lens"]')).toBeNull();
  });

  it('uses a static starter list when reduced motion is requested', async () => {
    setReducedMotion(true);
    const { dependencies } = await createFixture();
    render(<App dependencies={dependencies} />);

    expect(await screen.findByRole('list', { name: 'Ways to begin' }))
      .toHaveAttribute('data-motion', 'static');
  });

  it('makes text, microphone, and send controls immediately accessible with touch geometry', async () => {
    const { dependencies } = await createFixture();
    render(<App dependencies={dependencies} />);

    const composer = screen.getByRole('textbox', { name: 'Your thought' });
    const microphone = screen.getByRole('button', { name: 'Start voice input' });
    const send = screen.getByRole('button', { name: 'Send thought' });

    expect(composer).toHaveClass('touch-target');
    expect(microphone).toHaveClass('touch-target');
    expect(send).toHaveClass('touch-target');
    await screen.findByRole('button', { name: STARTERS[0] });
  });

  it('persists a pending first turn before a delayed response and then renders the question', async () => {
    const response = deferred<NextQuestionResult>();
    const provider = new DeterministicQuestioningProvider();
    provider.nextQuestionHandler = () => response.promise;
    const { dependencies, repositories } = await createFixture(provider);
    const user = userEvent.setup();
    render(<App dependencies={dependencies} />);

    const composer = screen.getByRole('textbox', { name: 'Your thought' });
    await user.type(composer, 'I can’t tell what evidence would be enough.');
    await user.click(screen.getByRole('button', { name: 'Send thought' }));

    expect(await screen.findByText('I can’t tell what evidence would be enough.')).toBeVisible();
    expect(screen.getByText('Sending…')).toBeVisible();
    await waitFor(() => {
      expect(provider.nextQuestionCalls).toBe(1);
    });
    const [thread] = await repositories.threads.list();
    expect(thread).toBeDefined();
    const storedTurns = thread === undefined
      ? []
      : await repositories.turns.listByThread(thread.id);
    expect(storedTurns).toEqual([
      expect.objectContaining({
        content: 'I can’t tell what evidence would be enough.',
        deliveryState: 'pending',
        role: 'user',
      }),
    ]);

    await act(async () => {
      response.resolve(VALID_QUESTION);
      await response.promise;
    });

    expect(await screen.findByText(VALID_QUESTION.question)).toBeVisible();
    expect(screen.queryByText('Sending…')).not.toBeInTheDocument();
  });

  it('keeps history scrollable and marks only the latest Specular question current', async () => {
    const fixture = await createFixture();
    let questionCount = 0;
    fixture.provider.nextQuestionHandler = () => Promise.resolve({
      ...VALID_QUESTION,
      question: `Which concrete boundary should example ${String(questionCount += 1)} test?`,
    });
    await seedActiveThread(fixture, ['First thought', 'Second thought']);
    render(<App dependencies={fixture.dependencies} />);

    const transcript = await screen.findByRole('log', { name: 'Conversation history' });
    expect(transcript).toHaveClass('transcript--scrollable');
    const questions = within(transcript).getAllByTestId('specular-turn');
    expect(questions).toHaveLength(2);
    expect(questions[0]).not.toHaveAttribute('aria-current');
    expect(questions[1]).toHaveAttribute('aria-current', 'true');
    expect(questions[1]).toHaveAccessibleName('Current Specular question');
  });

  it('keeps Challenge and conclusion actions available through the application boundary', async () => {
    const fixture = await createFixture();
    await seedActiveThread(fixture);
    const challenge = vi.spyOn(fixture.service, 'challenge');
    const draftConclusion = vi.spyOn(fixture.service, 'draftConclusion');
    const user = userEvent.setup();
    render(<App dependencies={fixture.dependencies} />);

    await user.click(await screen.findByRole('button', { name: 'Challenge me' }));
    expect(challenge).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Which stakeholder bears the cost if this assumption fails?'))
      .toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Draft a conclusion' }));
    expect(draftConclusion).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Conclusion draft ready.')).toBeVisible();
  });

  it('announces turns and typed errors while preserving composer focus', async () => {
    const provider = new DeterministicQuestioningProvider();
    provider.nextQuestionHandler = () => Promise.reject(new QuestioningClientError('offline'));
    const { dependencies } = await createFixture(provider);
    const user = userEvent.setup();
    render(<App dependencies={dependencies} />);

    const composer = screen.getByRole('textbox', { name: 'Your thought' });
    await user.type(composer, '<img src=x onerror=alert(1)> unfinished');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(composer).toHaveFocus();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveTextContent("You're offline. Your writing is saved and ready to retry.");
    const transcript = screen.getByRole('log', { name: 'Conversation history' });
    expect(transcript).toHaveAttribute('aria-live', 'polite');
    expect(within(transcript).getByText('<img src=x onerror=alert(1)> unfinished'))
      .toBeVisible();
    expect(transcript.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry saved thought' })).toBeVisible();
    expect(composer).toHaveFocus();
  });

  it('keeps unsaved draft text when local thread creation fails', async () => {
    const fixture = await createFixture();
    const user = userEvent.setup();
    render(<App dependencies={fixture.dependencies} />);
    await screen.findByRole('button', { name: STARTERS[0] });
    fixture.repositories.close();

    const composer = screen.getByRole('textbox', { name: 'Your thought' });
    await user.type(composer, 'Keep this unfinished thought safe.');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Specular could not update local storage.',
    );
    expect(composer).toHaveValue('Keep this unfinished thought safe.');
  });

  it('keeps unsaved draft text when the first turn cannot be persisted', async () => {
    const fixture = await createFixture();
    unwrap(await fixture.service.startThread());
    const user = userEvent.setup();
    render(<App dependencies={fixture.dependencies} />);
    await screen.findByRole('button', { name: STARTERS[0] });
    fixture.repositories.close();

    const composer = screen.getByRole('textbox', { name: 'Your thought' });
    await user.type(composer, 'Do not discard this draft either.');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Specular could not update local storage.',
    );
    expect(composer).toHaveValue('Do not discard this draft either.');
  });

  it('does not offer a saved-turn retry for a Challenge operation error', async () => {
    const fixture = await createFixture();
    await seedActiveThread(fixture);
    fixture.provider.challengeHandler = () =>
      Promise.reject(new QuestioningClientError('offline'));
    const user = userEvent.setup();
    render(<App dependencies={fixture.dependencies} />);

    await user.click(await screen.findByRole('button', { name: 'Challenge me' }));

    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry saved thought' }))
      .not.toBeInTheDocument();
  });

  it('gives every icon-only control an accessible name', async () => {
    const { dependencies } = await createFixture();
    render(<App dependencies={dependencies} />);
    await screen.findByRole('button', { name: STARTERS[0] });

    const iconOnlyButtons = [...document.querySelectorAll('button')]
      .filter((button) => button.querySelector('svg') !== null && button.textContent.trim() === '');
    expect(iconOnlyButtons.length).toBeGreaterThan(0);
    for (const button of iconOnlyButtons) {
      expect(button).toHaveAccessibleName();
    }
  });

  it('loads existing active thread history through injected repositories and composition', async () => {
    const fixture = await createFixture();
    await seedActiveThread(
      fixture,
      ['Certainty keeps becoming a prerequisite for this decision.'],
      'Decision clarity',
    );
    render(<App dependencies={fixture.dependencies} />);

    expect(await screen.findByRole('heading', { name: 'Decision clarity' })).toBeVisible();
    expect(screen.getByText('Certainty keeps becoming a prerequisite for this decision.'))
      .toBeVisible();
    expect(screen.getByText(VALID_QUESTION.question)).toBeVisible();
  });
});
