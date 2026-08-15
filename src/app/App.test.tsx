import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialWorkspace } from '../thinking/model';
import type { DictationCaptureHandlers, DictationController } from '../dictation/capture';
import type { DictationService } from '../dictation/client';
import type { Reflector } from '../thinking/reflect-client';
import type { Organizer } from '../thinking/organize-client';
import type { SharePublisher } from '../thinking/share-client';
import { App } from './App';

afterEach(() => { cleanup(); vi.useRealTimers(); });

function reflection(mirror = 'You are separating attention from certainty.') {
  return {
    mirror,
    directions: [
      { label: 'Name the distinction', prompt: 'Name the distinction this depends on.', move: 'distinguish' as const },
      { label: 'Follow the implication', prompt: 'Follow what changes if this is true.', move: 'implications' as const },
    ],
    referencedBlockIds: ['block:source'],
    sources: [],
  };
}

class FakeDictationController implements DictationController {
  handlers: DictationCaptureHandlers | null = null;
  start = vi.fn((handlers: DictationCaptureHandlers) => { this.handlers = handlers; handlers.onStarted(); return Promise.resolve(); });
  pause = vi.fn(() => Promise.resolve());
  resume = vi.fn(() => Promise.resolve());
  finish = vi.fn(() => Promise.resolve());
  cancel = vi.fn(() => undefined);
}

function setup(options: {
  reflector?: Reflector;
  sharePublisher?: SharePublisher;
  dictationController?: DictationController;
  dictationService?: DictationService;
  organizer?: Organizer;
  initialState?: ReturnType<typeof createInitialWorkspace>;
} = {}) {
  const reflector = options.reflector ?? { reflect: vi.fn(() => Promise.resolve(reflection())) };
  const sharePublisher = options.sharePublisher ?? {
    publish: vi.fn(() => Promise.resolve({ url: 'https://specular.example/s/abcdefghijklmnop' })),
  };
  render(
    <App
      initialState={options.initialState ?? createInitialWorkspace(1_800_000_000_000)}
      reflector={reflector}
      {...(options.organizer === undefined ? {} : { organizer: options.organizer })}
      sharePublisher={sharePublisher}
      {...(options.dictationController === undefined ? {} : { dictationController: options.dictationController })}
      {...(options.dictationService === undefined ? {} : { dictationService: options.dictationService })}
    />,
  );
  return { reflector, sharePublisher };
}

describe('Specular thinking workspace', () => {
  it('quietly generates organizational metadata after consent and enough writing', async () => {
    vi.useFakeTimers();
    const initial = createInitialWorkspace(1_800_000_000_000);
    const content = Array.from({ length: 50 }, (_, index) => `word${String(index)}`).join(' ');
    const firstDocument = initial.documents[0];
    const firstBlock = initial.blocks[0];
    if (firstDocument === undefined || firstBlock === undefined) throw new Error('Expected an initial workspace.');
    initial.settings.automaticOrganization = 'enabled';
    initial.documents[0] = { ...firstDocument, updatedAt: 1_800_000_000_100 };
    initial.blocks[0] = { ...firstBlock, content, updatedAt: 1_800_000_000_100 };
    const organize = vi.fn(() => Promise.resolve({
      title: 'Attention without certainty',
      kinds: [{ id: firstBlock.id, kind: 'hypothesis' as const }],
    }));
    setup({ initialState: initial, organizer: { organize } });

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });

    expect(organize).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox', { name: 'Document title' })).toHaveValue('Attention without certainty');
    expect(screen.getByText(/Suggested title/u)).toBeVisible();
  });

  it('reviews dictated text in the focused block before one canonical Keep', async () => {
    const user = userEvent.setup();
    const controller = new FakeDictationController();
    const clean = vi.fn(() => Promise.resolve('A spoken thought without filler.'));
    setup({
      dictationController: controller,
      dictationService: { transcribe: vi.fn(), clean },
    });

    const canonical = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Thought writing block' });
    canonical.focus();
    canonical.setSelectionRange(0, 0);
    await user.click(screen.getByRole('button', { name: 'Start dictation' }));
    controller.handlers?.onTranscript('Um, a spoken thought without filler.');

    expect(await screen.findByRole('textbox', { name: 'Dictation draft' })).toHaveValue('Um, a spoken thought without filler.');
    expect(canonical).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Create snapshot' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Pause dictation' }));
    expect(screen.getByRole('textbox', { name: 'Dictation draft' })).not.toHaveAttribute('readonly');
    await user.click(screen.getByRole('button', { name: 'Finish dictation' }));
    expect(await screen.findByRole('textbox', { name: 'Dictation draft' })).toHaveValue('A spoken thought without filler.');
    expect(clean).toHaveBeenCalledWith('Um, a spoken thought without filler.');

    await user.click(screen.getByRole('button', { name: 'Keep dictation' }));
    expect(canonical).toHaveValue('A spoken thought without filler.');
    expect(screen.queryByRole('textbox', { name: 'Dictation draft' })).not.toBeInTheDocument();
  });

  it('never presents an empty transcription as a reviewable dictation', async () => {
    const user = userEvent.setup();
    const controller = new FakeDictationController();
    setup({
      dictationController: controller,
      dictationService: { transcribe: vi.fn(), clean: vi.fn() },
    });

    await user.click(screen.getByRole('button', { name: 'Start dictation' }));
    await user.click(screen.getByRole('button', { name: 'Finish dictation' }));

    expect(await screen.findByText('No speech was transcribed. Continue dictating and try again.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue dictating' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Keep dictation' })).not.toBeInTheDocument();
  });

  it('uses a final checkpoint that arrives during Done instead of treating it as empty', async () => {
    const user = userEvent.setup();
    const controller = new FakeDictationController();
    const clean = vi.fn(() => Promise.resolve('Testing, testing, one, two, three.'));
    controller.finish.mockImplementationOnce(async () => {
      await Promise.resolve();
      controller.handlers?.onTranscript('Testing, testing, one, two, three.');
    });
    setup({
      dictationController: controller,
      dictationService: { transcribe: vi.fn(), clean },
    });

    await user.click(screen.getByRole('button', { name: 'Start dictation' }));
    await user.click(screen.getByRole('button', { name: 'Finish dictation' }));

    expect(await screen.findByRole('textbox', { name: 'Dictation draft' })).toHaveValue('Testing, testing, one, two, three.');
    expect(screen.getByRole('button', { name: 'Keep dictation' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Continue dictating' })).not.toBeInTheDocument();
  });

  it('makes an interrupted dictation unmistakable and keeps its text provisional', async () => {
    const user = userEvent.setup();
    const controller = new FakeDictationController();
    setup({ dictationController: controller, dictationService: { transcribe: vi.fn(), clean: vi.fn() } });
    await user.click(screen.getByRole('button', { name: 'Start dictation' }));
    controller.handlers?.onTranscript('Words before interruption.');
    controller.handlers?.onInterrupted('connection_lost');

    expect(await screen.findByRole('alert')).toHaveTextContent('Dictation was interrupted');
    expect(screen.getByRole('textbox', { name: 'Thought writing block' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Continue dictating' })).toBeVisible();
  });

  it('reviews and cleans completed checkpoints when the final checkpoint fails', async () => {
    const user = userEvent.setup();
    const controller = new FakeDictationController();
    const clean = vi.fn(() => Promise.resolve('Earlier checkpoint text.'));
    controller.finish.mockImplementationOnce(() => {
      controller.handlers?.onError('The final checkpoint could not be transcribed.');
      return Promise.resolve();
    });
    setup({ dictationController: controller, dictationService: { transcribe: vi.fn(), clean } });
    await user.click(screen.getByRole('button', { name: 'Start dictation' }));
    controller.handlers?.onTranscript('Earlier checkpoint text.');
    await user.click(screen.getByRole('button', { name: 'Finish dictation' }));

    expect(await screen.findByText('The last checkpoint could not be transcribed. Review the saved text before keeping it.')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Dictation draft' })).toHaveValue('Earlier checkpoint text.');
    expect(screen.getByRole('button', { name: 'Keep dictation' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Continue dictating' })).not.toBeInTheDocument();
    expect(clean).toHaveBeenCalledWith('Earlier checkpoint text.');
  });

  it('preserves the verbatim transcript while the cleaned review is edited', async () => {
    const user = userEvent.setup();
    const controller = new FakeDictationController();
    setup({
      dictationController: controller,
      dictationService: { transcribe: vi.fn(), clean: vi.fn(() => Promise.resolve('A cleaned thought.')) },
    });
    await user.click(screen.getByRole('button', { name: 'Start dictation' }));
    controller.handlers?.onTranscript('Um, a cleaned thought.');
    await user.click(screen.getByRole('button', { name: 'Finish dictation' }));
    const draft = await screen.findByRole('textbox', { name: 'Dictation draft' });
    await user.clear(draft);
    await user.type(draft, 'My own review edit.');
    await user.click(screen.getByRole('button', { name: 'Use verbatim' }));
    expect(draft).toHaveValue('Um, a cleaned thought.');
  });

  it('stops capture and warns when a provisional checkpoint cannot be saved locally', async () => {
    const user = userEvent.setup();
    const controller = new FakeDictationController();
    const workspace = createInitialWorkspace(1_800_000_000_000);
    const store = {
      load: vi.fn(() => Promise.resolve(workspace)),
      save: vi.fn((next: typeof workspace) => next.dictationDraft === null
        ? Promise.resolve()
        : Promise.reject(new Error('quota exceeded'))),
      close: vi.fn(() => undefined),
    };
    render(<App
      dictationController={controller}
      dictationService={{ transcribe: vi.fn(), clean: vi.fn() }}
      storeFactory={() => Promise.resolve(store)}
    />);
    await user.click(await screen.findByRole('button', { name: 'Start dictation' }));
    controller.handlers?.onTranscript('Text that only exists in memory.');

    expect(await screen.findByText(/could not save this draft locally/iu)).toBeVisible();
    expect(controller.cancel).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Continue dictating' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Dictation draft' })).toHaveValue('Text that only exists in memory.');
  });

  it('requires resolving a nonempty draft before deleting its block or dictating elsewhere', async () => {
    const user = userEvent.setup();
    const controller = new FakeDictationController();
    const alert = vi.spyOn(globalThis, 'alert').mockImplementation(() => undefined);
    setup({ dictationController: controller, dictationService: { transcribe: vi.fn(), clean: vi.fn() } });
    await user.click(screen.getByRole('button', { name: 'Start dictation' }));
    controller.handlers?.onTranscript('Still provisional.');

    await user.click(screen.getByRole('button', { name: 'Delete block' }));
    expect(alert).toHaveBeenCalledWith('Keep or cancel the dictation draft before deleting this block.');
    expect(screen.getByRole('textbox', { name: 'Dictation draft' })).toHaveValue('Still provisional.');
    await user.click(screen.getByRole('button', { name: 'New block' }));
    expect(screen.queryByRole('button', { name: 'Start dictation' })).not.toBeInTheDocument();
    alert.mockRestore();
  });
  it('keeps optional intentions behind a help control and never inserts them as prose', async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByRole('textbox', { name: 'Document title' })).toHaveValue('');
    const block = screen.getByRole('textbox', { name: 'Thought writing block' });
    expect(block).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Explore what I think' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Writing starters' }));
    await user.click(screen.getByRole('button', { name: 'Explore what I think' }));
    expect(block).toHaveValue('');
    expect(block).toHaveAttribute('placeholder', 'Begin with the part you can almost say, but not quite.');
    expect(screen.getByText('Nothing enters your document unless you write it.')).toBeVisible();
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Block kind' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Document status' })).not.toBeInTheDocument();
  });

  it('deletes an accidentally created blank block', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'New block' }));
    const blocks = screen.getAllByRole('textbox', { name: 'Thought writing block' });
    expect(blocks).toHaveLength(2);
    const secondCard = blocks[1]?.closest('article');
    if (secondCard === null || secondCard === undefined) throw new Error('Expected a second block card.');
    await user.click(within(secondCard).getByRole('button', { name: 'Delete block' }));
    expect(screen.getAllByRole('textbox', { name: 'Thought writing block' })).toHaveLength(1);
  });

  it('uses visible in-page confirmation before removing authored material', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole('textbox', { name: 'Thought writing block' }), 'A thought worth protecting.');
    await user.click(screen.getByRole('button', { name: 'Delete block' }));
    expect(screen.getByRole('textbox', { name: 'Thought writing block' })).toHaveValue('A thought worth protecting.');
    expect(screen.getByRole('button', { name: 'Confirm delete block' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel block deletion' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Confirm delete block' }));
    expect(screen.getByRole('textbox', { name: 'Thought writing block' })).toHaveValue('');
  });

  it('presents reflection as a text action without an AI sparkle mark', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Reflect' }).querySelector('svg')).toBeNull();
  });

  it('reflects on user writing and opens a linked continuation without inserting prose', async () => {
    const user = userEvent.setup();
    const reflect = vi.fn(() => Promise.resolve(reflection()));
    setup({ reflector: { reflect } });
    const block = screen.getByRole('textbox', { name: 'Thought writing block' });
    await user.type(block, 'Attention can be important without becoming certainty.');
    await user.click(screen.getByRole('button', { name: 'Reflect' }));

    expect(await screen.findByText('You are separating attention from certainty.')).toBeVisible();
    expect(reflect).toHaveBeenCalledWith(expect.objectContaining({
      focus: 'Attention can be important without becoming certainty.',
      move: 'reflect',
      scope: 'document',
    }));

    await user.click(screen.getByRole('button', { name: /Name the distinction this depends on/u }));
    const blocks = screen.getAllByRole('textbox', { name: 'Thought writing block' });
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toHaveValue('');
    expect(screen.getByText('linked')).toBeVisible();
  });

  it('uses open-ended calibration as ephemeral listening context', async () => {
    const user = userEvent.setup();
    const reflect = vi.fn()
      .mockResolvedValueOnce(reflection())
      .mockResolvedValueOnce(reflection('You mean attention is a reason to continue looking, not a verdict.'));
    setup({ reflector: { reflect } });
    await user.type(screen.getByRole('textbox', { name: 'Thought writing block' }), 'Attention is not the same as certainty.');
    await user.click(screen.getByRole('button', { name: 'Reflect' }));
    expect(await screen.findByText('Clarify this reading')).toBeVisible();
    await user.type(screen.getByRole('textbox', { name: "Correct Specular's understanding" }), 'I mean it is a reason to keep looking.');
    await user.click(screen.getByRole('button', { name: 'Respond' }));

    expect(await screen.findAllByText('You mean attention is a reason to continue looking, not a verdict.')).toHaveLength(2);
    expect(reflect).toHaveBeenLastCalledWith(expect.objectContaining({
      move: 'calibrate',
      calibration: 'I mean it is a reason to keep looking.',
    }));
  });

  it('dictates into the ephemeral calibration field before Respond', async () => {
    const user = userEvent.setup();
    const controller = new FakeDictationController();
    const clean = vi.fn(() => Promise.resolve('A clearer correction.'));
    setup({ dictationController: controller, dictationService: { transcribe: vi.fn(), clean } });
    await user.type(screen.getByRole('textbox', { name: 'Thought writing block' }), 'Attention is not the same as certainty.');
    await user.click(screen.getByRole('button', { name: 'Reflect' }));
    await user.click(await screen.findByRole('button', { name: 'Start calibration dictation' }));
    controller.handlers?.onTranscript('Um, a clearer correction.');
    await user.click(screen.getByRole('button', { name: 'Finish calibration dictation' }));

    expect(screen.getByRole('textbox', { name: "Correct Specular's understanding" })).toHaveValue('A clearer correction.');
    expect(screen.queryByRole('textbox', { name: 'Dictation draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Thought writing block' })).toHaveValue('Attention is not the same as certainty.');
  });

  it('shows authored blocks in the document-scoped connections view', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole('textbox', { name: 'Thought writing block' }), 'A recurring thought becomes visible through writing.');
    await user.click(screen.getByRole('button', { name: 'Connections' }));

    const graph = screen.getByRole('region', { name: 'Connections' });
    expect(within(graph).getByText('A recurring thought becomes visible through writing.')).toBeVisible();
    expect(within(graph).getByRole('combobox', { name: 'Filter connections by kind' })).toHaveValue('all');
    const correction = within(graph).getByRole('combobox', { name: /Correct kind for/u });
    await user.selectOptions(correction, 'question');
    expect(correction).toHaveValue('question');
  });

  it('creates a user-authored snapshot and publishes only selected canonical blocks', async () => {
    const user = userEvent.setup();
    const publish = vi.fn(() => Promise.resolve({ url: 'https://specular.example/s/abcdefghijklmnop' }));
    setup({ sharePublisher: { publish } });
    await user.type(screen.getByRole('textbox', { name: 'Document title' }), 'Attention without certainty');
    await user.type(screen.getByRole('textbox', { name: 'Thought writing block' }), 'Attention can justify another look without becoming proof.');
    await user.click(screen.getByRole('button', { name: 'Create snapshot' }));

    const editor = screen.getByRole('dialog', { name: 'Snapshot editor' });
    expect(within(editor).getAllByText('Attention can justify another look without becoming proof.')).toHaveLength(2);
    await user.click(within(editor).getByRole('button', { name: 'Publish page' }));

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Attention without certainty',
      blocks: [expect.objectContaining({ content: 'Attention can justify another look without becoming proof.' })],
    }));
    expect(await within(editor).findByRole('button', { name: 'Copy link' })).toBeVisible();
  });

  it('requires explicit confirmation before a generated title enters a snapshot artifact', async () => {
    const user = userEvent.setup();
    const initial = createInitialWorkspace(1_800_000_000_000);
    const document = initial.documents[0];
    const block = initial.blocks[0];
    if (document === undefined || block === undefined) throw new Error('Expected an initial workspace.');
    initial.documents[0] = { ...document, title: 'Suggested title', titleSource: 'generated' };
    initial.blocks[0] = { ...block, content: 'Authored material remains the substance of the snapshot.' };
    setup({ initialState: initial });

    await user.click(screen.getByRole('button', { name: 'Create snapshot' }));
    const editor = screen.getByRole('dialog', { name: 'Snapshot editor' });
    expect(within(editor).getByRole('button', { name: 'Publish page' })).toBeDisabled();
    expect(within(editor).getByText(/suggested by Specular/u)).toBeVisible();
    await user.click(within(editor).getByRole('button', { name: 'Use this title' }));
    expect(within(editor).getByRole('button', { name: 'Publish page' })).toBeEnabled();
    const title = within(editor).getByRole('textbox', { name: 'Snapshot title' });
    await user.clear(title);
    expect(within(editor).getByRole('button', { name: 'Publish page' })).toBeDisabled();
    await user.type(title, 'A title I chose');
    expect(within(editor).getByRole('button', { name: 'Publish page' })).toBeEnabled();
  });

  it('keeps context breadth and dormancy timing under user control', async () => {
    const user = userEvent.setup();
    setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Context scope' }), 'workspace');
    expect(screen.getByRole('combobox', { name: 'Context scope' })).toHaveValue('workspace');
    await user.click(screen.getByRole('button', { name: 'Library' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Dormancy period' }), '30');
    expect(screen.getByRole('combobox', { name: 'Dormancy period' })).toHaveValue('30');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Dictation cleanup' }), 'verbatim');
    expect(screen.getByRole('combobox', { name: 'Dictation cleanup' })).toHaveValue('verbatim');
  });
});
