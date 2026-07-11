import {
  createRef,
  useState,
} from 'react';
import {
  cleanup,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Capsule, WorkingConclusion } from '../domain/contracts';
import {
  capsuleIdSchema,
  threadIdSchema,
  turnIdSchema,
} from '../domain/schemas';
import { CapsuleLibrary } from './CapsuleLibrary';

const sourceTurnId = turnIdSchema.parse('turn-capsule-source');
const currentThread = {
  id: threadIdSchema.parse('thread-current'),
  title: 'Decision clarity',
};

function makeConclusion(thesis: string): WorkingConclusion {
  return {
    kind: 'working_conclusion',
    thesis,
    insights: ['First insight.', 'Second insight.', 'Third insight.'],
    observations: ['A supporting observation.'],
    tensions: ['An unresolved tension.'],
    caveats: ['A caveat.'],
    provenance: [{ turnId: sourceTurnId, excerpt: 'Source excerpt.' }],
    editState: 'edited',
    editedAt: 100,
  };
}

function makeCapsule(id: string, title: string, createdAt: number): Capsule {
  return {
    id: capsuleIdSchema.parse(id),
    ownerScope: 'local',
    title,
    createdAt,
    updatedAt: createdAt,
    conclusion: makeConclusion(`${title} thesis.`),
    sourceThreadId: threadIdSchema.parse('thread-capsule-source'),
    sourceTurnRange: { startTurnId: sourceTurnId, endTurnId: sourceTurnId },
  };
}

afterEach(cleanup);

describe('CapsuleLibrary', () => {
  it('opens as a focus-managed chronological sheet and restores the trigger on Escape', async () => {
    const capsules = [
      makeCapsule('capsule-older', 'Older conclusion', Date.UTC(2026, 6, 8)),
      makeCapsule('capsule-newer', 'Newer conclusion', Date.UTC(2026, 6, 9)),
    ];
    const triggerRef = createRef<HTMLButtonElement>();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button
            aria-hidden="false"
            onClick={() => { setOpen(true); }}
            ref={triggerRef}
            type="button"
          >
            Capsules
          </button>
          <CapsuleLibrary
            busy={false}
            capsules={capsules}
            currentThread={currentThread}
            onClose={() => { setOpen(false); }}
            onBranchCapsule={vi.fn()}
            onChallengeCapsule={vi.fn()}
            onContinueCapsule={vi.fn()}
            onDeleteAll={vi.fn()}
            onDeleteCapsule={vi.fn()}
            onDeleteThread={vi.fn()}
            onExport={vi.fn()}
            onUpdateCapsule={vi.fn()}
            open={open}
            triggerRef={triggerRef}
          />
        </>
      );
    }

    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Capsules' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Capsules' });
    expect(within(dialog).getByRole('button', { name: 'Close capsule library' })).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-hidden', 'true');
    expect(trigger).toHaveAttribute('inert');
    const capsuleButtons = within(dialog).getAllByRole('button', { name: /conclusion/u });
    expect(capsuleButtons.map((button) => button.textContent)).toEqual([
      expect.stringContaining('Newer conclusion'),
      expect.stringContaining('Older conclusion'),
    ]);
    await user.click(within(dialog).getByRole('button', { name: 'More capsule actions' }));
    const lastAction = within(dialog).getByRole('menuitem', { name: 'Delete all local content' });
    lastAction.focus();
    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Close capsule library' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(lastAction).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Capsules' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-hidden', 'false');
    expect(trigger).not.toHaveAttribute('inert');
  });

  it('contains focus in only the topmost nested delete confirmation', async () => {
    const triggerRef = createRef<HTMLButtonElement>();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button
            aria-hidden="false"
            onClick={() => { setOpen(true); }}
            ref={triggerRef}
            type="button"
          >
            Capsules
          </button>
          <CapsuleLibrary
            busy={false}
            capsules={[]}
            currentThread={currentThread}
            onClose={() => { setOpen(false); }}
            onBranchCapsule={vi.fn()}
            onChallengeCapsule={vi.fn()}
            onContinueCapsule={vi.fn()}
            onDeleteAll={vi.fn()}
            onDeleteCapsule={vi.fn()}
            onDeleteThread={vi.fn()}
            onExport={vi.fn()}
            onUpdateCapsule={vi.fn()}
            open={open}
            triggerRef={triggerRef}
          />
        </>
      );
    }

    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Capsules' });
    await user.click(trigger);
    const library = screen.getByRole('dialog', { name: 'Capsules' });
    await user.click(within(library).getByRole('button', { name: 'More capsule actions' }));
    const deleteThread = within(library).getByRole('menuitem', {
      name: 'Delete current thread',
    });
    const header = library.querySelector('.capsule-library__header');
    const footer = library.querySelector('.capsule-library__footer');
    if (header === null || footer === null) {
      throw new Error('Expected the capsule library shell regions.');
    }

    await user.click(deleteThread);
    const confirmation = screen.getByRole('alertdialog', { name: /Decision clarity/u });
    const cancel = within(confirmation).getByRole('button', { name: 'Cancel' });
    const confirm = within(confirmation).getByRole('button', {
      name: 'Permanently delete thread',
    });
    expect(header).toHaveAttribute('aria-hidden', 'true');
    expect(header).toHaveAttribute('inert');
    expect(footer).toHaveAttribute('aria-hidden', 'true');
    expect(footer).toHaveAttribute('inert');
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(library).toBeInTheDocument();
    expect(deleteThread).toHaveFocus();
    expect(header).not.toHaveAttribute('aria-hidden');
    expect(header).not.toHaveAttribute('inert');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Capsules' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-hidden', 'false');
    expect(trigger).not.toHaveAttribute('inert');
  });

  it('keeps selected capsule edits local across refresh and submits the validated edit', async () => {
    const capsule = makeCapsule('capsule-edit', 'Decision clarity', Date.UTC(2026, 6, 9));
    const triggerRef = createRef<HTMLButtonElement>();
    const onUpdateCapsule = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { rerender } = render(
      <CapsuleLibrary
        busy={false}
        capsules={[capsule]}
        currentThread={currentThread}
        onClose={vi.fn()}
        onBranchCapsule={vi.fn()}
        onChallengeCapsule={vi.fn()}
        onContinueCapsule={vi.fn()}
        onDeleteAll={vi.fn()}
        onDeleteCapsule={vi.fn()}
        onDeleteThread={vi.fn()}
        onExport={vi.fn()}
        onUpdateCapsule={onUpdateCapsule}
        open
        triggerRef={triggerRef}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Decision clarity/u }));
    const thesis = screen.getByRole('textbox', { name: 'Working conclusion' });
    await user.clear(thesis);
    await user.type(thesis, 'My capsule edit survives refresh.');

    rerender(
      <CapsuleLibrary
        busy={false}
        capsules={[{ ...capsule, conclusion: makeConclusion('An async replacement.') }]}
        currentThread={currentThread}
        onClose={vi.fn()}
        onBranchCapsule={vi.fn()}
        onChallengeCapsule={vi.fn()}
        onContinueCapsule={vi.fn()}
        onDeleteAll={vi.fn()}
        onDeleteCapsule={vi.fn()}
        onDeleteThread={vi.fn()}
        onExport={vi.fn()}
        onUpdateCapsule={onUpdateCapsule}
        open
        triggerRef={triggerRef}
      />,
    );

    expect(thesis).toHaveValue('My capsule edit survives refresh.');
    await user.click(screen.getByRole('button', { name: 'Save capsule edits' }));
    expect(onUpdateCapsule).toHaveBeenCalledWith(
      capsule.id,
      expect.objectContaining({
        thesis: 'My capsule edit survives refresh.',
        provenance: capsule.conclusion.provenance,
      }),
    );
  });

  it('presents an explanatory empty state and keeps destructive actions in overflow', async () => {
    const triggerRef = createRef<HTMLButtonElement>();
    const user = userEvent.setup();
    render(
      <CapsuleLibrary
        busy={false}
        capsules={[]}
        currentThread={currentThread}
        onClose={vi.fn()}
        onBranchCapsule={vi.fn()}
        onChallengeCapsule={vi.fn()}
        onContinueCapsule={vi.fn()}
        onDeleteAll={vi.fn()}
        onDeleteCapsule={vi.fn()}
        onDeleteThread={vi.fn()}
        onExport={vi.fn()}
        onUpdateCapsule={vi.fn()}
        open
        triggerRef={triggerRef}
      />,
    );

    expect(screen.getByText('No capsules yet.')).toBeVisible();
    expect(screen.getByText('Saved working conclusions collect here.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Delete all local content' }))
      .not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'More capsule actions' }));
    expect(screen.getByRole('menuitem', { name: 'Delete current thread' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Delete all local content' })).toBeVisible();
  });

  it('announces export failure without changing content and renders capsule text literally', async () => {
    const capsule = makeCapsule(
      'capsule-literal',
      '<img src=x onerror=alert(1)> conclusion',
      Date.UTC(2026, 6, 9),
    );
    const triggerRef = createRef<HTMLButtonElement>();
    const onExport = vi.fn().mockRejectedValue(new Error('private export failure'));
    const user = userEvent.setup();
    render(
      <CapsuleLibrary
        busy={false}
        capsules={[{
          ...capsule,
          conclusion: makeConclusion('<script>alert(1)</script>'),
        }]}
        currentThread={currentThread}
        onClose={vi.fn()}
        onBranchCapsule={vi.fn()}
        onChallengeCapsule={vi.fn()}
        onContinueCapsule={vi.fn()}
        onDeleteAll={vi.fn()}
        onDeleteCapsule={vi.fn()}
        onDeleteThread={vi.fn()}
        onExport={onExport}
        onUpdateCapsule={vi.fn()}
        open
        triggerRef={triggerRef}
      />,
    );

    expect(screen.getByText('<img src=x onerror=alert(1)> conclusion')).toBeVisible();
    expect(document.querySelector('.capsule-library img, .capsule-library script')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Export' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The export could not be downloaded. No local content was changed.',
    );
    expect(document.body).not.toHaveTextContent('private export failure');
    expect(onExport).toHaveBeenCalledOnce();
    for (const button of document.querySelectorAll<HTMLButtonElement>('.capsule-library button')) {
      if (button.querySelector('svg') !== null && button.textContent.trim() === '') {
        expect(button).toHaveAccessibleName();
      }
    }
  });

  it('binds deletion to the confirmed thread id even if the current thread changes', async () => {
    const triggerRef = createRef<HTMLButtonElement>();
    const onDeleteThread = vi.fn().mockResolvedValue(undefined);
    const oldThread = {
      id: threadIdSchema.parse('thread-confirmed-old'),
      title: 'Confirmed old thread',
    };
    const freshThread = {
      id: threadIdSchema.parse('thread-current-fresh'),
      title: 'Fresh current thread',
    };
    const user = userEvent.setup();
    const { rerender } = render(
      <CapsuleLibrary
        busy={false}
        capsules={[]}
        currentThread={oldThread}
        onClose={vi.fn()}
        onBranchCapsule={vi.fn()}
        onChallengeCapsule={vi.fn()}
        onContinueCapsule={vi.fn()}
        onDeleteAll={vi.fn()}
        onDeleteCapsule={vi.fn()}
        onDeleteThread={onDeleteThread}
        onExport={vi.fn()}
        onUpdateCapsule={vi.fn()}
        open
        triggerRef={triggerRef}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'More capsule actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete current thread' }));
    expect(screen.getByRole('alertdialog', { name: /Confirmed old thread/u })).toBeVisible();

    rerender(
      <CapsuleLibrary
        busy
        capsules={[]}
        currentThread={freshThread}
        onClose={vi.fn()}
        onBranchCapsule={vi.fn()}
        onChallengeCapsule={vi.fn()}
        onContinueCapsule={vi.fn()}
        onDeleteAll={vi.fn()}
        onDeleteCapsule={vi.fn()}
        onDeleteThread={onDeleteThread}
        onExport={vi.fn()}
        onUpdateCapsule={vi.fn()}
        open
        triggerRef={triggerRef}
      />,
    );
    expect(screen.getByRole('button', { name: 'Permanently delete thread' })).toBeDisabled();

    rerender(
      <CapsuleLibrary
        busy={false}
        capsules={[]}
        currentThread={freshThread}
        onClose={vi.fn()}
        onBranchCapsule={vi.fn()}
        onChallengeCapsule={vi.fn()}
        onContinueCapsule={vi.fn()}
        onDeleteAll={vi.fn()}
        onDeleteCapsule={vi.fn()}
        onDeleteThread={onDeleteThread}
        onExport={vi.fn()}
        onUpdateCapsule={vi.fn()}
        open
        triggerRef={triggerRef}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Permanently delete thread' }));

    expect(onDeleteThread).toHaveBeenCalledOnce();
    expect(onDeleteThread).toHaveBeenCalledWith(oldThread.id);
  });

  it('disables archive mutations while another application activity is pending', async () => {
    const capsule = makeCapsule('capsule-busy', 'Busy capsule', Date.UTC(2026, 6, 9));
    const triggerRef = createRef<HTMLButtonElement>();
    const user = userEvent.setup();
    render(
      <CapsuleLibrary
        busy
        capsules={[capsule]}
        currentThread={{
          id: threadIdSchema.parse('thread-busy'),
          title: 'Busy thread',
        }}
        onClose={vi.fn()}
        onBranchCapsule={vi.fn()}
        onChallengeCapsule={vi.fn()}
        onContinueCapsule={vi.fn()}
        onDeleteAll={vi.fn()}
        onDeleteCapsule={vi.fn()}
        onDeleteThread={vi.fn()}
        onExport={vi.fn()}
        onUpdateCapsule={vi.fn()}
        open
        triggerRef={triggerRef}
      />,
    );

    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'More capsule actions' })).toBeDisabled();
    const capsuleButton = screen.getByRole('button', { name: /Busy capsule/u });
    expect(capsuleButton).toBeDisabled();
    await user.click(capsuleButton);
    expect(screen.queryByRole('textbox', { name: 'Working conclusion' })).not.toBeInTheDocument();
  });

  it('opens a capsule as a continuation, branch, or immediate challenge', async () => {
    const capsule = makeCapsule('capsule-revisit', 'Market thesis', Date.UTC(2026, 6, 9));
    const triggerRef = createRef<HTMLButtonElement>();
    const onClose = vi.fn();
    const onContinueCapsule = vi.fn().mockResolvedValue(true);
    const onBranchCapsule = vi.fn().mockResolvedValue(true);
    const onChallengeCapsule = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    const { rerender } = render(
      <CapsuleLibrary
        busy={false}
        capsules={[capsule]}
        currentThread={currentThread}
        onBranchCapsule={onBranchCapsule}
        onChallengeCapsule={onChallengeCapsule}
        onClose={onClose}
        onContinueCapsule={onContinueCapsule}
        onDeleteAll={vi.fn()}
        onDeleteCapsule={vi.fn()}
        onDeleteThread={vi.fn()}
        onExport={vi.fn()}
        onUpdateCapsule={vi.fn()}
        open
        triggerRef={triggerRef}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Market thesis/u }));
    await user.click(screen.getByRole('button', { name: 'Continue developing' }));
    expect(onContinueCapsule).toHaveBeenCalledWith(capsule.id);
    expect(onClose).toHaveBeenCalledOnce();

    onClose.mockClear();
    rerender(
      <CapsuleLibrary
        busy={false}
        capsules={[capsule]}
        currentThread={currentThread}
        onBranchCapsule={onBranchCapsule}
        onChallengeCapsule={onChallengeCapsule}
        onClose={onClose}
        onContinueCapsule={onContinueCapsule}
        onDeleteAll={vi.fn()}
        onDeleteCapsule={vi.fn()}
        onDeleteThread={vi.fn()}
        onExport={vi.fn()}
        onUpdateCapsule={vi.fn()}
        open
        triggerRef={triggerRef}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Branch into new thread' }));
    expect(onBranchCapsule).toHaveBeenCalledWith(capsule.id);
    expect(onClose).toHaveBeenCalledOnce();

    onClose.mockClear();
    rerender(
      <CapsuleLibrary
        busy={false}
        capsules={[capsule]}
        currentThread={currentThread}
        onBranchCapsule={onBranchCapsule}
        onChallengeCapsule={onChallengeCapsule}
        onClose={onClose}
        onContinueCapsule={onContinueCapsule}
        onDeleteAll={vi.fn()}
        onDeleteCapsule={vi.fn()}
        onDeleteThread={vi.fn()}
        onExport={vi.fn()}
        onUpdateCapsule={vi.fn()}
        open
        triggerRef={triggerRef}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Challenge this' }));
    expect(onChallengeCapsule).toHaveBeenCalledWith(capsule.id);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
