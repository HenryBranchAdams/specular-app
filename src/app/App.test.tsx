import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialWorkspace } from '../thinking/model';
import type { DictationCaptureHandlers, DictationController } from '../dictation/capture';
import type { DictationService } from '../dictation/client';
import type { Reflector } from '../thinking/reflect-client';
import type { Organizer } from '../thinking/organize-client';
import type { SharePublisher } from '../thinking/share-client';
import { prepareForApplicationReload } from '../pwa/reload-safety';
import { App } from './App';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

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

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((reason?: unknown) => void) | undefined;
  return {
    promise: new Promise<T>((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    }),
    resolve(value: T) { resolve?.(value); },
    reject(reason?: unknown) { reject?.(reason); },
  };
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
    await user.click(screen.getByText('Voice privacy'));
    expect(screen.getByText(/Dictation currently expects English/u)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Pause dictation' }));
    expect(screen.getByRole('textbox', { name: 'Dictation draft' })).not.toHaveAttribute('readonly');
    await user.click(screen.getByRole('button', { name: 'Finish dictation' }));
    expect(await screen.findByRole('textbox', { name: 'Dictation draft' })).toHaveValue('A spoken thought without filler.');
    expect(clean).toHaveBeenCalledWith('Um, a spoken thought without filler.');

    await user.click(screen.getByRole('button', { name: 'Keep dictation' }));
    expect(canonical).toHaveValue('A spoken thought without filler.');
    expect(canonical).toHaveFocus();
    expect(screen.getByRole('status', { name: 'Workspace status' })).toHaveTextContent('Dictation added to writing.');
    expect(screen.queryByRole('textbox', { name: 'Dictation draft' })).not.toBeInTheDocument();
  });

  it('blocks application activation while active dictation still has uncheckpointed speech', async () => {
    const user = userEvent.setup();
    const controller = new FakeDictationController();
    setup({ dictationController: controller, dictationService: { transcribe: vi.fn(), clean: vi.fn() } });
    await user.click(screen.getByRole('button', { name: 'Start dictation' }));

    await expect(prepareForApplicationReload()).rejects.toThrow('Pause or finish dictation before updating');

    expect(controller.cancel).not.toHaveBeenCalled();
    expect(screen.getByText('Recording · keep Specular open')).toBeVisible();
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

  it('lets the author delete a blank block after an empty dictation result', async () => {
    const user = userEvent.setup();
    const controller = new FakeDictationController();
    const alert = vi.spyOn(globalThis, 'alert').mockImplementation(() => undefined);
    setup({
      dictationController: controller,
      dictationService: { transcribe: vi.fn(), clean: vi.fn() },
    });

    await user.click(screen.getByRole('button', { name: 'Start dictation' }));
    await user.click(screen.getByRole('button', { name: 'Finish dictation' }));
    await screen.findByText('No speech was transcribed. Continue dictating and try again.');
    await user.click(screen.getByRole('button', { name: 'Delete block' }));

    expect(alert).not.toHaveBeenCalled();
    expect(controller.cancel).toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Dictation draft' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('textbox', { name: 'Thought writing block' })).toHaveLength(1);
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
        ? Promise.resolve(next)
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
    setup({ dictationController: controller, dictationService: { transcribe: vi.fn(), clean: vi.fn() } });
    await user.click(screen.getByRole('button', { name: 'Start dictation' }));
    controller.handlers?.onTranscript('Still provisional.');

    await user.click(screen.getByRole('button', { name: 'Delete block' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Keep or cancel the dictation draft before deleting this block.');
    expect(screen.getByRole('textbox', { name: 'Dictation draft' })).toHaveValue('Still provisional.');
    await user.click(screen.getByRole('button', { name: 'New block' }));
    expect(screen.queryByRole('button', { name: 'Start dictation' })).not.toBeInTheDocument();
  });

  it('confirms before discarding a nonempty dictation draft and restores focus', async () => {
    const user = userEvent.setup();
    const controller = new FakeDictationController();
    setup({ dictationController: controller, dictationService: { transcribe: vi.fn(), clean: vi.fn() } });
    await user.click(screen.getByRole('button', { name: 'Start dictation' }));
    controller.handlers?.onTranscript('Still provisional.');

    const cancelDraft = screen.getByRole('button', { name: 'Cancel' });
    await user.click(cancelDraft);

    const dialog = screen.getByRole('alertdialog', { name: /Discard dictation draft/u });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(controller.cancel).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(cancelDraft).toHaveFocus();

    await user.click(cancelDraft);
    await user.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(controller.cancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole('textbox', { name: 'Dictation draft' })).not.toBeInTheDocument();
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

  it('announces block creation and deletion while moving focus to the canonical writing target', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'New block' }));
    const blocks = screen.getAllByRole('textbox', { name: 'Thought writing block' });
    expect(blocks[1]).toHaveFocus();
    expect(screen.getByRole('status', { name: 'Workspace status' })).toHaveTextContent('New writing block added.');

    const secondCard = blocks[1]?.closest('article');
    if (secondCard === null || secondCard === undefined) throw new Error('Expected a second block card.');
    await user.click(within(secondCard).getByRole('button', { name: 'Delete block' }));
    expect(screen.getByRole('status', { name: 'Workspace status' })).toHaveTextContent('Writing block deleted.');
    expect(screen.getByRole('textbox', { name: 'Thought writing block' })).toHaveFocus();
  });

  it('inserts a new writing block at the chosen boundary without reordering existing writing', async () => {
    const user = userEvent.setup();
    setup();
    const first = screen.getByRole('textbox', { name: 'Thought writing block' });
    await user.type(first, 'First completed thought.');
    await user.click(screen.getByRole('button', { name: 'New block' }));
    const second = screen.getAllByRole('textbox', { name: 'Thought writing block' })[1];
    if (second === undefined) throw new Error('Expected a second writing block.');
    await user.type(second, 'Second completed thought.');

    await user.click(screen.getByRole('button', { name: 'Insert block between writing blocks' }));

    const blocks = screen.getAllByRole('textbox', { name: 'Thought writing block' });
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toHaveValue('First completed thought.');
    expect(blocks[1]).toHaveValue('');
    expect(blocks[1]).toHaveFocus();
    expect(blocks[2]).toHaveValue('Second completed thought.');
  });

  it('announces version restoration and returns focus to the restored writing', async () => {
    const user = userEvent.setup();
    const initial = createInitialWorkspace(1_800_000_000_000);
    const block = initial.blocks[0];
    if (block === undefined) throw new Error('Expected an initial block.');
    initial.blocks[0] = {
      ...block,
      content: 'Current wording.',
      versions: [{ content: 'Earlier wording.', createdAt: 1_799_999_000_000 }],
    };
    setup({ initialState: initial });

    await user.click(screen.getByText('History · 1 version'));
    await user.click(screen.getByRole('button', { name: /Earlier wording/u }));

    const canonical = screen.getByRole('textbox', { name: 'Thought writing block' });
    expect(canonical).toHaveValue('Earlier wording.');
    expect(canonical).toHaveFocus();
    expect(screen.getByRole('status', { name: 'Workspace status' })).toHaveTextContent('Earlier version restored.');
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
    expect(screen.getByRole('status', { name: 'Workspace status' })).toHaveTextContent('Reflection ready.');
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

    await user.selectOptions(within(graph).getByRole('combobox', { name: 'Filter connections by status' }), 'dormant');
    expect(screen.getByRole('status', { name: 'Workspace status' })).toHaveTextContent('No connections match these filters.');
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

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Attention without certainty',
        blocks: [expect.objectContaining({ content: 'Attention can justify another look without becoming proof.' })],
      }),
      'signed_in',
    );
    expect(await within(editor).findByRole('button', { name: 'Copy link' })).toBeVisible();
  });

  it('makes public access an explicit snapshot choice and locks it after publication', async () => {
    const user = userEvent.setup();
    const publish = vi.fn(() => Promise.resolve({ url: 'https://specular.example/s/abcdefghijklmnop' }));
    setup({ sharePublisher: { publish } });
    await user.type(screen.getByRole('textbox', { name: 'Thought writing block' }), 'A thought chosen for public reading.');
    await user.click(screen.getByRole('button', { name: 'Create snapshot' }));
    const editor = screen.getByRole('dialog', { name: 'Snapshot editor' });
    const visibility = within(editor).getByRole('combobox', { name: 'Who can read the published page?' });

    expect(visibility).toHaveValue('signed_in');
    await user.selectOptions(visibility, 'public');
    expect(within(editor).getByText('Unlisted and readable without a Specular account.')).toBeVisible();
    await user.click(within(editor).getByRole('button', { name: 'Publish page' }));

    expect(publish).toHaveBeenCalledWith(expect.any(Object), 'public');
    expect(await within(editor).findByRole('combobox', { name: 'Who can read the published page?' })).toBeDisabled();
    expect(within(editor).getByRole('button', { name: 'Publish page' })).toBeDisabled();
  });

  it('keeps authored paragraph boundaries in a snapshot preview', async () => {
    const user = userEvent.setup();
    const initial = createInitialWorkspace(1_800_000_000_000);
    const block = initial.blocks[0];
    if (block === undefined) throw new Error('Expected an initial writing block.');
    initial.blocks[0] = { ...block, content: 'First paragraph.\n\nSecond paragraph.' };
    setup({ initialState: initial });

    await user.click(screen.getByRole('button', { name: 'Create snapshot' }));

    const preview = screen.getByRole('article', { name: 'Snapshot preview' });
    expect(within(preview).getByText('First paragraph.').tagName).toBe('P');
    expect(within(preview).getByText('Second paragraph.').tagName).toBe('P');
  });

  it('uses action-specific pending and success states while publishing and revoking a snapshot', async () => {
    const user = userEvent.setup();
    const publication = deferred<{ url: string }>();
    const revocation = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/shares/abcdefghijklmnop' && init?.method === 'DELETE') return revocation.promise;
      return Promise.reject(new Error('Unexpected request'));
    }));
    setup({ sharePublisher: { publish: vi.fn(() => publication.promise) } });
    await user.type(screen.getByRole('textbox', { name: 'Document title' }), 'A deliberate snapshot');
    await user.type(screen.getByRole('textbox', { name: 'Thought writing block' }), 'Canonical writing for a synthetic publication state.');
    await user.click(screen.getByRole('button', { name: 'Create snapshot' }));
    const editor = screen.getByRole('dialog', { name: 'Snapshot editor' });

    await user.click(within(editor).getByRole('button', { name: 'Publish page' }));
    expect(within(editor).getByRole('button', { name: 'Publishing page…' })).toBeDisabled();
    await act(async () => { publication.resolve({ url: 'https://specular.example/s/abcdefghijklmnop' }); await publication.promise; });
    expect(await within(editor).findByRole('status', { name: 'Snapshot status' })).toHaveTextContent('Page published. Link ready to copy.');

    await user.click(within(editor).getByRole('button', { name: 'Revoke link' }));
    expect(within(editor).getByRole('button', { name: 'Revoking link…' })).toBeDisabled();
    await act(async () => { revocation.resolve(new Response(null, { status: 204 })); await revocation.promise; });
    expect(await within(editor).findByRole('status', { name: 'Snapshot status' })).toHaveTextContent('Published link revoked.');
    expect(within(editor).queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
  });

  it('keeps snapshot publication failure action-specific and recoverable', async () => {
    const user = userEvent.setup();
    setup({ sharePublisher: { publish: vi.fn(() => Promise.reject(new Error('This page could not be published. Try again.'))) } });
    await user.type(screen.getByRole('textbox', { name: 'Thought writing block' }), 'Canonical writing remains untouched after publication failure.');
    await user.click(screen.getByRole('button', { name: 'Create snapshot' }));
    const editor = screen.getByRole('dialog', { name: 'Snapshot editor' });
    await user.click(within(editor).getByRole('button', { name: 'Publish page' }));

    expect(await within(editor).findByRole('alert')).toHaveTextContent('could not be published');
    expect(within(editor).getByRole('button', { name: 'Publish page' })).toBeEnabled();
  });

  it('contains snapshot focus, dismisses with Escape, and restores its trigger', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole('textbox', { name: 'Thought writing block' }), 'A canonical thought.');
    const trigger = screen.getByRole('button', { name: 'Create snapshot' });
    await user.click(trigger);

    const editor = screen.getByRole('dialog', { name: 'Snapshot editor' });
    expect(within(editor).getByRole('button', { name: 'Close snapshot' })).toHaveFocus();
    expect(trigger.closest('header')).toHaveAttribute('inert');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Snapshot editor' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger.closest('header')).not.toHaveAttribute('inert');
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

  it('treats the library as a focus-contained drawer and restores its trigger', async () => {
    const user = userEvent.setup();
    setup();
    const trigger = screen.getByRole('button', { name: 'Library' });
    await user.click(trigger);

    const drawer = screen.getByRole('dialog', { name: 'Document library' });
    expect(within(drawer).getByRole('button', { name: 'Close library' })).toHaveFocus();
    expect(trigger.closest('header')).toHaveAttribute('inert');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Document library' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger.closest('header')).not.toHaveAttribute('inert');
  });

  it('distinguishes published-link loading, empty, and failure states with retry', async () => {
    const user = userEvent.setup();
    const firstLoad = deferred<Response>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => firstLoad.promise)
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ snapshots: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const initial = createInitialWorkspace(1_800_000_000_000);
    render(<App initialState={initial} session={{ authenticated: true, email: 'writer@example.com', cacheNamespace: 'account:writer', signOutUrl: '/signout' }} />);

    await user.click(screen.getByRole('button', { name: 'Library' }));
    const drawer = screen.getByRole('dialog', { name: 'Document library' });
    expect(within(drawer).getByRole('status', { name: 'Published links status' })).toHaveTextContent('Loading published links…');
    expect(within(drawer).queryByText('No published links yet.')).not.toBeInTheDocument();
    await act(async () => { firstLoad.resolve(new Response(JSON.stringify({ snapshots: [] }), { status: 200 })); await firstLoad.promise; });
    expect(await within(drawer).findByText('No published links yet.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Close library' }));
    await user.click(screen.getByRole('button', { name: 'Library' }));
    const reopenedDrawer = screen.getByRole('dialog', { name: 'Document library' });
    expect(await within(reopenedDrawer).findByRole('alert')).toHaveTextContent('could not load your published links');
    await user.click(within(reopenedDrawer).getByRole('button', { name: 'Retry published links' }));
    expect(await within(reopenedDrawer).findByText('No published links yet.')).toBeVisible();
  });

  it('reports archive preparation as a specific pending, success, and failure operation', async () => {
    const user = userEvent.setup();
    const archive = deferred<Response>();
    vi.spyOn(globalThis.URL, 'createObjectURL').mockReturnValue('blob:archive');
    vi.spyOn(globalThis.URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(globalThis.HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (input === '/api/shares') return Promise.resolve(new Response(JSON.stringify({ snapshots: [] }), { status: 200 }));
      if (input === '/api/archive') return archive.promise;
      return Promise.reject(new Error('Unexpected request'));
    });
    vi.stubGlobal('fetch', fetchMock);
    const initial = createInitialWorkspace(1_800_000_000_000);
    render(<App initialState={initial} session={{ authenticated: true, email: 'writer@example.com', cacheNamespace: 'account:writer', signOutUrl: '/signout' }} />);
    await user.click(screen.getByRole('button', { name: 'Library' }));
    const drawer = screen.getByRole('dialog', { name: 'Document library' });

    await user.click(within(drawer).getByRole('button', { name: 'Download archive' }));
    expect(within(drawer).getByRole('button', { name: 'Preparing archive…' })).toBeDisabled();
    await act(async () => { archive.resolve(new Response('{}', { status: 200 })); await archive.promise; });
    expect(await within(drawer).findByRole('status', { name: 'Library status' })).toHaveTextContent('Archive download started.');
  });

  it('does not clear an unsynchronized device cache during sign out', async () => {
    const user = userEvent.setup();
    const workspace = createInitialWorkspace(1_800_000_000_000);
    const store = {
      load: vi.fn(() => Promise.resolve(workspace)),
      save: vi.fn(() => Promise.resolve(workspace)),
      currentStatus: vi.fn(() => 'unsynced' as const),
      subscribeStatus: vi.fn((listener: (status: 'unsynced') => void) => { listener('unsynced'); return () => undefined; }),
      clear: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => undefined),
    };
    render(<App
      session={{ authenticated: true, email: 'writer@example.com', cacheNamespace: 'account:writer', signOutUrl: '/signout' }}
      storeFactory={() => Promise.resolve(store)}
    />);

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sign out is paused');
    expect(store.clear).not.toHaveBeenCalled();
  });

  it('lets the author sign out after downloading a current device recovery', async () => {
    const user = userEvent.setup();
    const workspace = createInitialWorkspace(1_800_000_000_000);
    const navigateToSignOut = vi.fn();
    vi.spyOn(globalThis.URL, 'createObjectURL').mockReturnValue('blob:recovery');
    vi.spyOn(globalThis.URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(globalThis.HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const store = {
      load: vi.fn(() => Promise.resolve(workspace)),
      save: vi.fn(() => Promise.resolve(workspace)),
      currentStatus: vi.fn(() => 'unsynced' as const),
      subscribeStatus: vi.fn((listener: (status: 'unsynced') => void) => { listener('unsynced'); return () => undefined; }),
      clear: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => undefined),
    };
    render(<App
      navigateToSignOut={navigateToSignOut}
      session={{ authenticated: true, email: 'writer@example.com', cacheNamespace: 'account:writer', signOutUrl: '/signout' }}
      storeFactory={() => Promise.resolve(store)}
    />);

    await user.click(await screen.findByRole('button', { name: 'Library' }));
    await user.click(screen.getByRole('button', { name: 'Download this device recovery' }));
    await user.click(screen.getByRole('button', { name: 'Close library' }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(store.clear).toHaveBeenCalledOnce();
    expect(navigateToSignOut).toHaveBeenCalledWith('/signout');
    expect(screen.queryByText(/Sign out is paused/u)).not.toBeInTheDocument();
  });

  it('pauses sign out when writing changes after the device recovery download', async () => {
    const user = userEvent.setup();
    const workspace = createInitialWorkspace(1_800_000_000_000);
    const navigateToSignOut = vi.fn();
    vi.spyOn(globalThis.URL, 'createObjectURL').mockReturnValue('blob:recovery');
    vi.spyOn(globalThis.URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(globalThis.HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const store = {
      load: vi.fn(() => Promise.resolve(workspace)),
      save: vi.fn((next: typeof workspace) => Promise.resolve(next)),
      currentStatus: vi.fn(() => 'unsynced' as const),
      subscribeStatus: vi.fn((listener: (status: 'unsynced') => void) => { listener('unsynced'); return () => undefined; }),
      clear: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => undefined),
    };
    render(<App
      navigateToSignOut={navigateToSignOut}
      session={{ authenticated: true, email: 'writer@example.com', cacheNamespace: 'account:writer', signOutUrl: '/signout' }}
      storeFactory={() => Promise.resolve(store)}
    />);

    await user.click(await screen.findByRole('button', { name: 'Library' }));
    await user.click(screen.getByRole('button', { name: 'Download this device recovery' }));
    await user.click(screen.getByRole('button', { name: 'Close library' }));
    await user.type(screen.getByRole('textbox', { name: 'Thought writing block' }), 'New writing after recovery.');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sign out is paused');
    expect(store.clear).not.toHaveBeenCalled();
    expect(navigateToSignOut).not.toHaveBeenCalled();
  });

  it('does not leave the workspace when its device cache cannot be cleared', async () => {
    const user = userEvent.setup();
    const workspace = createInitialWorkspace(1_800_000_000_000);
    const navigateToSignOut = vi.fn();
    const store = {
      load: vi.fn(() => Promise.resolve(workspace)),
      save: vi.fn((next: typeof workspace) => Promise.resolve(next)),
      currentStatus: vi.fn(() => 'synchronized' as const),
      subscribeStatus: vi.fn((listener: (status: 'synchronized') => void) => { listener('synchronized'); return () => undefined; }),
      clear: vi.fn(() => Promise.reject(new Error('clear failed'))),
      close: vi.fn(() => undefined),
    };
    render(<App
      navigateToSignOut={navigateToSignOut}
      session={{ authenticated: true, email: 'writer@example.com', cacheNamespace: 'account:writer', signOutUrl: '/signout' }}
      storeFactory={() => Promise.resolve(store)}
    />);

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('could not clear this device cache');
    expect(store.clear).toHaveBeenCalledOnce();
    expect(navigateToSignOut).not.toHaveBeenCalled();
  });

  it('does not download a stale hosted archive while writing is unsynchronized', async () => {
    const user = userEvent.setup();
    const workspace = createInitialWorkspace(1_800_000_000_000);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const store = {
      load: vi.fn(() => Promise.resolve(workspace)),
      save: vi.fn(() => Promise.resolve(workspace)),
      currentStatus: vi.fn(() => 'unsynced' as const),
      subscribeStatus: vi.fn((listener: (status: 'unsynced') => void) => { listener('unsynced'); return () => undefined; }),
      clear: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => undefined),
    };
    render(<App
      session={{ authenticated: true, email: 'writer@example.com', cacheNamespace: 'account:writer', signOutUrl: '/signout' }}
      storeFactory={() => Promise.resolve(store)}
    />);
    await user.click(await screen.findByRole('button', { name: 'Library' }));
    await user.click(screen.getByRole('button', { name: 'Download archive' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('hosted archive is paused');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/archive');
  });

  it('keeps a synchronized conflict copy visibly identified until the author resolves it', async () => {
    const user = userEvent.setup();
    const initial = createInitialWorkspace(1_800_000_000_000);
    const document = initial.documents[0];
    if (document === undefined) throw new Error('Expected an initial document.');
    initial.documents[0] = { ...document, conflictOfDocumentId: 'document:origin', conflictStatus: 'open' };
    setup({ initialState: initial });

    expect(screen.getByText(/preserved conflict copy/iu)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Mark resolved' }));
    expect(screen.queryByText(/preserved conflict copy/iu)).not.toBeInTheDocument();
  });

  it('adopts a conflict copy returned by synchronization instead of autosaving stale prose over it', async () => {
    const user = userEvent.setup();
    const base = createInitialWorkspace(1_800_000_000_000);
    const document = base.documents[0];
    const block = base.blocks[0];
    if (document === undefined || block === undefined) throw new Error('Expected an initial workspace.');
    const reconciled = structuredClone(base);
    reconciled.blocks[0] = { ...block, content: 'South branch' };
    reconciled.documents.push({
      ...document,
      id: 'document:conflict',
      title: 'Untitled thought (Conflict copy)',
      titleSource: 'author',
      conflictOfDocumentId: document.id,
      conflictStatus: 'open',
      blockIds: ['block:conflict'],
    });
    reconciled.blocks.push({ ...block, id: 'block:conflict', documentId: 'document:conflict', content: 'North branch' });
    const store = {
      load: vi.fn(() => Promise.resolve(base)),
      save: vi.fn((workspace: typeof base) => Promise.resolve(
        workspace.blocks[0]?.content === 'North branch' ? reconciled : workspace,
      )),
      currentStatus: vi.fn(() => 'synchronized' as const),
      subscribeStatus: vi.fn((listener: (status: 'synchronized') => void) => { listener('synchronized'); return () => undefined; }),
      close: vi.fn(() => undefined),
    };
    render(<App
      session={{ authenticated: true, email: 'writer@example.com', cacheNamespace: 'account:writer', signOutUrl: '/signout' }}
      storeFactory={() => Promise.resolve(store)}
    />);
    const writing = await screen.findByRole('textbox', { name: 'Thought writing block' });

    await user.type(writing, 'North branch');
    await vi.waitFor(() => {
      expect(store.save.mock.calls.some(([workspace]) => (
        workspace.blocks.some((savedBlock) => savedBlock.content === 'North branch')
      ))).toBe(true);
    });
    await user.click(screen.getByRole('button', { name: 'Library' }));

    expect(await screen.findByRole('button', { name: /Untitled thought \(Conflict copy\)/u })).toBeVisible();
  });

  it('lists and revokes the current author account hosted snapshots', async () => {
    const user = userEvent.setup();
    const workspace = createInitialWorkspace(1_800_000_000_000);
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/shares' && init === undefined) {
        return Promise.resolve(new Response(JSON.stringify({ snapshots: [{
          slug: 'abcdefghijklmnop',
          title: 'A hosted thought',
          createdAt: 1_800_000_000_000,
          revokedAt: null,
          visibility: 'public',
        }] }), { status: 200 }));
      }
      if (input === '/api/shares/abcdefghijklmnop' && init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      const requestLabel = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return Promise.reject(new Error(`Unexpected request: ${requestLabel}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const store = {
      load: vi.fn(() => Promise.resolve(workspace)),
      save: vi.fn(() => Promise.resolve(workspace)),
      currentStatus: vi.fn(() => 'synchronized' as const),
      subscribeStatus: vi.fn((listener: (status: 'synchronized') => void) => { listener('synchronized'); return () => undefined; }),
      clear: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => undefined),
    };
    render(<App
      session={{ authenticated: true, email: 'writer@example.com', cacheNamespace: 'account:writer', signOutUrl: '/signout' }}
      storeFactory={() => Promise.resolve(store)}
    />);

    await user.click(await screen.findByRole('button', { name: 'Library' }));
    expect(await screen.findByText('A hosted thought')).toBeVisible();
    expect(screen.getByText(/Anyone with the link/u)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Revoke' }));

    expect(await screen.findByText(/Revoked · Anyone with the link/u)).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith('/api/shares/abcdefghijklmnop', expect.objectContaining({ method: 'DELETE' }));
  });

  it('uses a recoverable alert dialog before deleting hosted account data', async () => {
    const user = userEvent.setup();
    const workspace = createInitialWorkspace(1_800_000_000_000);
    const navigateToSignOut = vi.fn();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/shares' && init === undefined) {
        return Promise.resolve(new Response(JSON.stringify({ snapshots: [] }), { status: 200 }));
      }
      if (input === '/api/account' && init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.reject(new Error('Unexpected request'));
    });
    vi.stubGlobal('fetch', fetchMock);
    const store = {
      load: vi.fn(() => Promise.resolve(workspace)),
      save: vi.fn(() => Promise.resolve(workspace)),
      currentStatus: vi.fn(() => 'synchronized' as const),
      subscribeStatus: vi.fn((listener: (status: 'synchronized') => void) => { listener('synchronized'); return () => undefined; }),
      clear: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => undefined),
    };
    render(<App
      navigateToSignOut={navigateToSignOut}
      session={{ authenticated: true, email: 'writer@example.com', cacheNamespace: 'account:writer', signOutUrl: '/signout' }}
      storeFactory={() => Promise.resolve(store)}
    />);

    await user.click(await screen.findByRole('button', { name: 'Library' }));
    const trigger = screen.getByRole('button', { name: 'Delete account data' });
    await user.click(trigger);
    const dialog = screen.getByRole('alertdialog', { name: 'Delete account data?' });
    expect(dialog).toHaveTextContent(/revokes every published link/u);
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/account', expect.anything());
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Delete account data' }));
    await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalledWith('/api/account', expect.objectContaining({ method: 'DELETE' })); });
    expect(store.clear).toHaveBeenCalledOnce();
    expect(navigateToSignOut).toHaveBeenCalledWith('/signout');
  });
});
