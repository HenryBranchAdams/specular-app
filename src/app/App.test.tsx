/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  ImmediateSafetyResult,
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
import type {
  RealtimeStartContext,
  RealtimeVoiceController,
} from '../voice/realtime-client';
import type {
  VoiceControllerCallbacks,
  VoiceControllerFactory,
} from '../voice/use-voice';
import { App } from './App';
import type { SpecularDependencies } from './use-specular';

const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');

const STARTERS = [
  'Something unfinished.',
  'A decision still open',
  'An untested assumption',
  'Notes that don’t yet agree',
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

const IMMEDIATE_SAFETY: ImmediateSafetyResult = {
  kind: 'immediate_safety',
  guidance: 'Contact immediate support now.',
  question: 'Can you contact one trusted person now?',
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

  nextQuestionHandler: (
    context: ThreadContext,
  ) => Promise<NextQuestionResult | ImmediateSafetyResult> =
    () => Promise.resolve(VALID_QUESTION);

  challengeHandler: (
    context: ThreadContext,
  ) => Promise<ChallengeResult | ImmediateSafetyResult> =
    () => Promise.resolve({
      kind: 'blind_spot',
      question: 'Which stakeholder bears the cost if this assumption fails?',
    });

  conclusionHandler: (
    context: ThreadContext,
  ) => Promise<WorkingConclusionResult | ImmediateSafetyResult> =
    (context) => {
      const sourceTurns = context.turns.filter((turn) => (
        turn.role === 'user' && turn.deliveryState === 'accepted'
      ));
      const position = sourceTurns[0];
      const gathered = sourceTurns.slice(1, 6);
      if (position === undefined || gathered.length === 0) {
        return Promise.reject(new Error('Gathering needs two accepted user turns.'));
      }
      return Promise.resolve({
        kind: 'working_conclusion',
        thesis: position.content,
        insights: gathered.map((turn) => turn.content),
        observations: [],
        tensions: [],
        caveats: [],
        provenance: [position, ...gathered].map((turn) => ({
          turnId: turn.id,
          excerpt: turn.content,
        })),
      });
    };

  nextQuestion(context: ThreadContext): Promise<NextQuestionResult | ImmediateSafetyResult> {
    this.nextQuestionCalls += 1;
    return this.nextQuestionHandler(context);
  }

  challenge(context: ThreadContext): Promise<ChallengeResult | ImmediateSafetyResult> {
    this.challengeCalls += 1;
    return this.challengeHandler(context);
  }

  draftConclusion(
    context: ThreadContext,
  ): Promise<WorkingConclusionResult | ImmediateSafetyResult> {
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

interface VoiceHarness {
  readonly callbacks: VoiceControllerCallbacks | null;
  readonly factory: VoiceControllerFactory;
  readonly start: ReturnType<typeof vi.fn>;
  readonly stop: ReturnType<typeof vi.fn>;
}

function createVoiceHarness(): VoiceHarness {
  let callbacks: VoiceControllerCallbacks | null = null;
  const start = vi.fn((context: RealtimeStartContext) => {
    void context;
    return Promise.resolve();
  });
  const stop = vi.fn();
  const controller: RealtimeVoiceController = {
    getStatus: () => 'idle',
    start,
    stop,
  };
  const factory = vi.fn((nextCallbacks: VoiceControllerCallbacks) => {
    callbacks = nextCallbacks;
    return controller;
  });
  return {
    get callbacks() {
      return callbacks;
    },
    factory,
    start,
    stop,
  };
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
  it('renders one invitation and three non-interactive unfinished-thought cues', async () => {
    const { dependencies } = await createFixture();
    render(<App dependencies={dependencies} />);

    for (const starter of STARTERS) {
      expect(await screen.findByText(starter, { exact: true })).toBeVisible();
      expect(screen.queryByRole('button', { name: starter })).not.toBeInTheDocument();
    }
  });

  it('makes writing the first interaction without starting a thread or selecting a strategy', async () => {
    const { dependencies, provider, service } = await createFixture();
    const user = userEvent.setup();
    const startThread = vi.spyOn(service, 'startThread');
    const submitUserTurn = vi.spyOn(service, 'submitUserTurn');
    const challenge = vi.spyOn(service, 'challenge');
    const draftConclusion = vi.spyOn(service, 'draftConclusion');
    render(<App dependencies={dependencies} />);

    const lead = await screen.findByRole('heading', { name: STARTERS[0] });
    const composer = screen.getByRole('textbox', { name: 'Idea, context, or response' });
    const cues = screen.getByRole('list', { name: 'Ways to begin' });
    expect(lead.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(composer.compareDocumentPosition(cues) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    await user.click(composer);

    expect(composer).toHaveFocus();
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

  it('keeps starter hierarchy editorial instead of presenting a numbered taxonomy', () => {
    expect(styles).not.toContain('starter-deck__index');
    expect(styles).not.toContain('starter-deck__rule');
    expect(styles).toContain('.starter-cues__item:nth-child(2)');
  });

  it('keeps the starter surface still instead of simulating thought with ambient motion', () => {
    expect(styles).not.toContain('@keyframes starter-drift');
    expect(styles).not.toContain('animation: starter-drift');
  });

  it('keeps voice off by default while text and send controls remain accessible', async () => {
    const { dependencies } = await createFixture();
    render(<App dependencies={dependencies} />);

    const composer = screen.getByRole('textbox', { name: 'Idea, context, or response' });
    const send = screen.getByRole('button', { name: 'Send input' });

    expect(composer).toHaveClass('touch-target');
    expect(send).toHaveClass('touch-target');
    expect(screen.queryByRole('button', { name: /voice/iu })).not.toBeInTheDocument();
    await screen.findByRole('heading', { name: STARTERS[0] });
  });

  it('accepts one voice exchange into the active transcript without touching the text draft', async () => {
    const fixture = await createFixture();
    const thread = await seedActiveThread(fixture);
    const harness = createVoiceHarness();
    const acceptVoiceExchange = vi.spyOn(fixture.service, 'acceptVoiceExchange');
    const user = userEvent.setup();
    render(
      <App
        dependencies={fixture.dependencies}
        voiceControllerFactory={harness.factory}
        voiceEnabled
      />,
    );
    await screen.findByRole('heading', { name: 'Specular' });

    const composer = screen.getByRole('textbox', { name: 'Idea, context, or response' });
    await user.type(composer, 'A typed thought stays here.');
    await user.click(screen.getByRole('button', { name: 'Start voice' }));

    expect(harness.factory).toHaveBeenCalledOnce();
    expect(harness.start).toHaveBeenCalledOnce();
    const startContext = harness.start.mock.calls[0]?.[0] as RealtimeStartContext | undefined;
    expect(startContext?.threadId).toBe(thread.id);
    expect(startContext?.turns).toHaveLength(2);
    expect(startContext?.turns.every((turn) => turn.deliveryState === 'accepted')).toBe(true);
    expect(composer).toHaveValue('A typed thought stays here.');

    act(() => {
      harness.callbacks?.onStatus('connecting');
    });
    expect(screen.getByRole('button', { name: 'Connecting' })).toBeDisabled();
    act(() => {
      harness.callbacks?.onStatus('listening');
    });
    expect(screen.getByRole('button', { name: 'Stop voice' })).toBeEnabled();
    expect(screen.getByRole('status', { name: 'Voice status' })).toHaveTextContent('Listening');

    const exchange = {
      threadId: thread.id,
      userTranscript: 'The handoff keeps getting lost.',
      assistantTranscript: 'Which handoff owner needs the clearest signal first?',
    };
    const callbacks = harness.callbacks;
    if (callbacks === null) {
      throw new Error('Voice controller callbacks were not registered.');
    }
    await act(async () => {
      await callbacks.onCompletedExchange(exchange);
    });

    expect(acceptVoiceExchange).toHaveBeenCalledOnce();
    expect(acceptVoiceExchange).toHaveBeenCalledWith(
      thread.id,
      exchange.userTranscript,
      exchange.assistantTranscript,
    );
    const transcript = screen.getByRole('log', { name: 'Conversation history' });
    expect(within(transcript).getByText(exchange.userTranscript)).toBeVisible();
    expect(within(transcript).getByText(exchange.assistantTranscript)).toBeVisible();
    expect(screen.getAllByRole('log', { name: 'Conversation history' })).toHaveLength(1);
    expect(composer).toHaveValue('A typed thought stays here.');
    expect(screen.getByRole('button', { name: 'Test this' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Gather this thread' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Stop voice' }));
    expect(harness.stop).toHaveBeenCalledOnce();
    expect(composer).toHaveFocus();
    expect(composer).toHaveValue('A typed thought stays here.');
  });

  it('announces voice failure, restores composer focus, and leaves text usable', async () => {
    const fixture = await createFixture();
    await seedActiveThread(fixture);
    const harness = createVoiceHarness();
    const user = userEvent.setup();
    render(
      <App
        dependencies={fixture.dependencies}
        voiceControllerFactory={harness.factory}
        voiceEnabled
      />,
    );

    const composer = await screen.findByRole('textbox', { name: 'Idea, context, or response' });
    await user.type(composer, 'Do not erase this draft.');
    await user.click(screen.getByRole('button', { name: 'Start voice' }));
    act(() => {
      harness.callbacks?.onStatus('idle');
      harness.callbacks?.onFailure({
        code: 'microphone_unavailable',
        message: 'Microphone access was not granted.',
      });
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Microphone access was not granted.');
    expect(screen.getByRole('button', { name: 'Start voice' })).toBeEnabled();
    expect(composer).toHaveValue('Do not erase this draft.');
    expect(composer).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Send input' })).toBeEnabled();
  });

  it('stops voice before a test or gather operation proceeds', async () => {
    const fixture = await createFixture();
    await seedActiveThread(fixture, ['First thought', 'Second thought']);
    const harness = createVoiceHarness();
    const user = userEvent.setup();
    render(
      <App
        dependencies={fixture.dependencies}
        voiceControllerFactory={harness.factory}
        voiceEnabled
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Start voice' }));
    act(() => { harness.callbacks?.onStatus('listening'); });
    const challenge = screen.getByRole('button', { name: 'Test this' });
    const conclusion = screen.getByRole('button', { name: 'Gather this thread' });
    expect(challenge).toBeDisabled();
    expect(conclusion).toBeDisabled();
    expect(fixture.provider.challengeCalls).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Stop voice' }));
    await waitFor(() => { expect(harness.stop).toHaveBeenCalledOnce(); });
    expect(challenge).toBeEnabled();
    await user.click(challenge);
    expect(await screen.findByRole('button', { name: 'Start voice' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Gather this thread' })).toBeVisible();
  });

  it('keeps a pre-initialization draft but waits to send until repositories load', async () => {
    const fixture = await createFixture();
    const initialThreads = deferred<Thread[]>();
    const listThreads = vi.spyOn(fixture.repositories.threads, 'list')
      .mockImplementationOnce(() => initialThreads.promise);
    const startThread = vi.spyOn(fixture.service, 'startThread');
    const submitUserTurn = vi.spyOn(fixture.service, 'submitUserTurn');
    const user = userEvent.setup();
    render(<App dependencies={fixture.dependencies} />);

    await waitFor(() => {
      expect(listThreads).toHaveBeenCalledOnce();
    });
    expect(screen.getByText('Loading your private local workspace.')).toBeInTheDocument();

    const composer = screen.getByRole('textbox', { name: 'Idea, context, or response' });
    const send = screen.getByRole('button', { name: 'Send input' });
    await user.type(composer, 'Keep this draft while local history loads.');

    expect(composer).toHaveValue('Keep this draft while local history loads.');
    expect(send).toBeDisabled();
    await user.click(send);
    expect(startThread).not.toHaveBeenCalled();
    expect(submitUserTurn).not.toHaveBeenCalled();
    expect(fixture.provider.nextQuestionCalls).toBe(0);

    await act(async () => {
      initialThreads.resolve([]);
      await initialThreads.promise;
    });

    await waitFor(() => {
      expect(send).toBeEnabled();
    });
    expect(composer).toHaveValue('Keep this draft while local history loads.');
    expect(screen.queryByText('Loading your private local workspace.')).not.toBeInTheDocument();

    await user.click(send);

    expect(await screen.findByText(VALID_QUESTION.question)).toBeVisible();
    expect(startThread).toHaveBeenCalledOnce();
    expect(submitUserTurn).toHaveBeenCalledOnce();
    expect(fixture.provider.nextQuestionCalls).toBe(1);
  });

  it('persists a pending first turn before a delayed response and then renders the question', async () => {
    const response = deferred<NextQuestionResult>();
    const provider = new DeterministicQuestioningProvider();
    provider.nextQuestionHandler = () => response.promise;
    const { dependencies, repositories } = await createFixture(provider);
    const user = userEvent.setup();
    render(<App dependencies={dependencies} />);

    const composer = screen.getByRole('textbox', { name: 'Idea, context, or response' });
    await user.type(composer, 'I can’t tell what evidence would be enough.');
    await user.click(screen.getByRole('button', { name: 'Send input' }));

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

  it('derives a meaningful local title from the first submitted input', async () => {
    const fixture = await createFixture();
    const user = userEvent.setup();
    render(<App dependencies={fixture.dependencies} />);

    const composer = screen.getByRole('textbox', { name: 'Idea, context, or response' });
    await user.type(
      composer,
      'I’m exploring a business that turns complex compliance updates into brief operating checklists for small manufacturers.',
    );
    await user.click(screen.getByRole('button', { name: 'Send input' }));

    expect(await screen.findByRole('heading', { name: 'Specular' })).toBeVisible();
    const [thread] = await fixture.repositories.threads.list();
    expect(thread?.title).toBe(
      'A business that turns complex compliance updates into brief operating…',
    );
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

  it('paces gather until two user turns and keeps both actions on the application boundary', async () => {
    const fixture = await createFixture();
    await seedActiveThread(fixture);
    const challenge = vi.spyOn(fixture.service, 'challenge');
    const draftConclusion = vi.spyOn(fixture.service, 'draftConclusion');
    const user = userEvent.setup();
    render(<App dependencies={fixture.dependencies} />);

    expect(await screen.findByRole('button', { name: 'Test this' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Gather this thread' })).not.toBeInTheDocument();
    await user.type(
      screen.getByRole('textbox', { name: 'Idea, context, or response' }),
      'A second user-authored detail makes gathering meaningful.',
    );
    await user.click(screen.getByRole('button', { name: 'Send input' }));
    expect(await screen.findByRole('button', { name: 'Gather this thread' })).toBeVisible();

    await user.click(await screen.findByRole('button', { name: 'Test this' }));
    expect(challenge).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Which stakeholder bears the cost if this assumption fails?'))
      .toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Gather this thread' }));
    expect(draftConclusion).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Notes gathered.')).toBeVisible();
  });

  it('opens a stored gathered conclusion locally without another provider call', async () => {
    const fixture = await createFixture();
    const thread = await seedActiveThread(fixture, ['First thought', 'Second thought']);
    unwrap(await fixture.service.draftConclusion(thread.id));
    expect(fixture.provider.conclusionCalls).toBe(1);
    const draftConclusion = vi.spyOn(fixture.service, 'draftConclusion');
    const user = userEvent.setup();
    render(<App dependencies={fixture.dependencies} />);

    await user.click(await screen.findByRole('button', { name: 'Open gathered notes' }));

    expect(await screen.findByRole('textbox', { name: 'Working position' })).toBeVisible();
    expect(draftConclusion).not.toHaveBeenCalled();
    expect(fixture.provider.conclusionCalls).toBe(1);
  });

  it('renders immediate gathering support without opening the conclusion editor', async () => {
    const fixture = await createFixture();
    fixture.provider.conclusionHandler = () => Promise.resolve(IMMEDIATE_SAFETY);
    await seedActiveThread(fixture);
    const user = userEvent.setup();
    render(<App dependencies={fixture.dependencies} />);

    await user.type(
      await screen.findByRole('textbox', { name: 'Idea, context, or response' }),
      'A second user-authored detail makes gathering available.',
    );
    await user.click(screen.getByRole('button', { name: 'Send input' }));
    await screen.findByRole('button', { name: 'Gather this thread' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Gather this thread' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Gather this thread' }));

    await waitFor(() => {
      expect(screen.getAllByTestId('specular-turn').at(-1))
        .toHaveTextContent(IMMEDIATE_SAFETY.guidance);
    });
    const safetyTurn = screen.getAllByTestId('specular-turn').at(-1);
    expect(safetyTurn).toHaveTextContent(IMMEDIATE_SAFETY.question);
    expect(screen.queryByRole('textbox', { name: 'Working position' }))
      .not.toBeInTheDocument();
    expect(screen.queryByText('Notes gathered.')).not.toBeInTheDocument();
    const [thread] = await fixture.repositories.threads.list();
    expect(thread?.provisionalConclusion).toBeUndefined();
  });

  it('announces turns and typed errors while preserving composer focus', async () => {
    const provider = new DeterministicQuestioningProvider();
    provider.nextQuestionHandler = () => Promise.reject(new QuestioningClientError('offline'));
    const { dependencies } = await createFixture(provider);
    const user = userEvent.setup();
    render(<App dependencies={dependencies} />);

    const composer = screen.getByRole('textbox', { name: 'Idea, context, or response' });
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
    const recovery = within(transcript).getByRole('group', { name: 'Saved thought recovery' });
    expect(recovery).toHaveTextContent('Not sent');
    expect(within(recovery).getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(composer).toHaveFocus();
  });

  it('keeps unsaved draft text when local thread creation fails', async () => {
    const fixture = await createFixture();
    const user = userEvent.setup();
    render(<App dependencies={fixture.dependencies} />);
    await screen.findByRole('heading', { name: STARTERS[0] });
    fixture.repositories.close();

    const composer = screen.getByRole('textbox', { name: 'Idea, context, or response' });
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
    await screen.findByRole('heading', { name: STARTERS[0] });
    fixture.repositories.close();

    const composer = screen.getByRole('textbox', { name: 'Idea, context, or response' });
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

    await user.click(await screen.findByRole('button', { name: 'Test this' }));

    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry' }))
      .not.toBeInTheDocument();
  });

  it('does not offer a saved-turn retry for a conclusion operation error', async () => {
    const fixture = await createFixture();
    await seedActiveThread(fixture, ['First thought', 'Second thought']);
    fixture.provider.conclusionHandler = () =>
      Promise.reject(new QuestioningClientError('offline'));
    const user = userEvent.setup();
    render(<App dependencies={fixture.dependencies} />);

    await user.click(await screen.findByRole('button', { name: 'Gather this thread' }));

    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry' }))
      .not.toBeInTheDocument();
  });

  it('restores and retries a persisted failed user turn after reload', async () => {
    const fixture = await createFixture();
    fixture.provider.nextQuestionHandler = () =>
      Promise.reject(new QuestioningClientError('offline'));
    const thread = unwrap(await fixture.service.startThread('Interrupted thought'));
    const failed = await fixture.service.submitUserTurn(
      thread.id,
      'This thought should remain recoverable.',
    );
    expect(failed.ok).toBe(false);
    const [savedTurn] = await fixture.repositories.turns.listByThread(thread.id);
    expect(savedTurn?.deliveryState).toBe('failed');
    fixture.provider.nextQuestionHandler = () => Promise.resolve(VALID_QUESTION);
    const retryTurn = vi.spyOn(fixture.service, 'retryTurn');
    const user = userEvent.setup();

    render(<App dependencies={fixture.dependencies} />);

    const recovery = await screen.findByRole('group', { name: 'Saved thought recovery' });
    expect(recovery).toHaveTextContent('Not sent');
    await user.click(within(recovery).getByRole('button', { name: 'Retry' }));

    expect(retryTurn).toHaveBeenCalledWith(savedTurn?.id);
    expect(await screen.findByText(VALID_QUESTION.question)).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Saved thought recovery' }))
      .not.toBeInTheDocument();
  });

  it('restores an orphaned pending turn as interrupted and retries it', async () => {
    const firstResponse = deferred<NextQuestionResult>();
    const fixture = await createFixture();
    fixture.provider.nextQuestionHandler = () => firstResponse.promise;
    const thread = unwrap(await fixture.service.startThread('Interrupted thought'));
    void fixture.service.submitUserTurn(
      thread.id,
      'This pending thought was interrupted by reload.',
    );
    await waitFor(() => {
      expect(fixture.provider.nextQuestionCalls).toBe(1);
    });
    const [savedTurn] = await fixture.repositories.turns.listByThread(thread.id);
    expect(savedTurn?.deliveryState).toBe('pending');
    fixture.provider.nextQuestionHandler = () => Promise.resolve(VALID_QUESTION);
    const retryTurn = vi.spyOn(fixture.service, 'retryTurn');
    const user = userEvent.setup();

    render(<App dependencies={fixture.dependencies} />);

    expect(await screen.findByText('Interrupted')).toBeVisible();
    expect(screen.queryByText('Sending…')).not.toBeInTheDocument();
    const recovery = screen.getByRole('group', { name: 'Saved thought recovery' });
    await user.click(within(recovery).getByRole('button', { name: 'Retry' }));

    expect(retryTurn).toHaveBeenCalledWith(savedTurn?.id);
    expect(await screen.findByText(VALID_QUESTION.question)).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Saved thought recovery' }))
      .not.toBeInTheDocument();
  });

  it('gives every icon-only control an accessible name', async () => {
    const { dependencies } = await createFixture();
    render(<App dependencies={dependencies} />);
    await screen.findByRole('heading', { name: STARTERS[0] });

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

    expect(await screen.findByRole('heading', { name: 'Specular' })).toBeVisible();
    expect(screen.getByText('Certainty keeps becoming a prerequisite for this decision.'))
      .toBeVisible();
    expect(screen.getByText(VALID_QUESTION.question)).toBeVisible();
  });
});
