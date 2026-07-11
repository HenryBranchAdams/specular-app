import {
  cleanup,
  render,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { WorkingConclusion } from '../domain/contracts';
import { turnIdSchema } from '../domain/schemas';
import { ConclusionEditor } from './ConclusionEditor';

function makeConclusion(overrides: Partial<WorkingConclusion> = {}): WorkingConclusion {
  return {
    kind: 'working_conclusion',
    thesis: 'A reversible decision preserves room to learn.',
    insights: [
      'The decision can stay reversible.',
      'The evidence boundary is still visible.',
      'A smaller step protects learning.',
    ],
    observations: ['The current option can be tested in a week.'],
    tensions: ['Waiting may reduce momentum.'],
    caveats: ['The thread contains one point of view.'],
    provenance: [{
      turnId: turnIdSchema.parse('turn-conclusion-source'),
      excerpt: 'I need to make a decision without pretending certainty.',
    }],
    editState: 'generated',
    ...overrides,
  };
}

afterEach(cleanup);

describe('ConclusionEditor', () => {
  it('keeps every phone-sized field locally editable across async prop refreshes', async () => {
    const conclusion = makeConclusion();
    const onKeepDigging = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <ConclusionEditor
        conclusion={conclusion}
        onFinish={vi.fn()}
        onKeepDigging={onKeepDigging}
        onSaveCapsule={vi.fn()}
        pendingAction={null}
      />,
    );

    const thesis = screen.getByRole('textbox', { name: 'Working conclusion' });
    await user.clear(thesis);
    await user.type(thesis, 'My edited read keeps the uncertainty explicit.');
    await user.clear(screen.getByRole('textbox', { name: 'Original insight 1' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Original insight 1' }),
      'My edited first insight.',
    );
    await user.clear(screen.getByRole('textbox', { name: 'Supporting observations' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Supporting observations' }),
      'A concrete observation.\nA second observation.',
    );
    await user.clear(screen.getByRole('textbox', { name: 'Unresolved tension 1' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Unresolved tension 1' }),
      'My edited tension.',
    );
    await user.clear(screen.getByRole('textbox', { name: 'Caveats' }));
    await user.type(screen.getByRole('textbox', { name: 'Caveats' }), 'My edited caveat.');

    rerender(
      <ConclusionEditor
        conclusion={makeConclusion({ thesis: 'An async refresh must not replace local edits.' })}
        onFinish={vi.fn()}
        onKeepDigging={onKeepDigging}
        onSaveCapsule={vi.fn()}
        pendingAction={null}
      />,
    );

    expect(thesis).toHaveValue('My edited read keeps the uncertainty explicit.');
    expect(screen.getAllByRole('textbox', { name: /Original insight/u })).toHaveLength(3);
    expect(screen.getAllByRole('textbox', { name: /Unresolved tension/u })).toHaveLength(1);
    expect(screen.getByText('7 / 150 words')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Continue developing' }));

    expect(onKeepDigging).toHaveBeenCalledWith(expect.objectContaining({
      thesis: 'My edited read keeps the uncertainty explicit.',
      insights: [
        'My edited first insight.',
        'The evidence boundary is still visible.',
        'A smaller step protects learning.',
      ],
      observations: ['A concrete observation.', 'A second observation.'],
      tensions: ['My edited tension.'],
      caveats: ['My edited caveat.'],
      provenance: conclusion.provenance,
    }));
  });

  it('keeps exact actions accessible, pending, and safe for literal content', () => {
    render(
      <ConclusionEditor
        conclusion={makeConclusion({ thesis: '<img src=x onerror=alert(1)>' })}
        onFinish={vi.fn()}
        onKeepDigging={vi.fn()}
        onSaveCapsule={vi.fn()}
        pendingAction="save"
      />,
    );

    expect(screen.getByDisplayValue('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(document.querySelector('.conclusion-editor img')).toBeNull();
    for (const action of ['Continue developing', 'Save as capsule', 'Save & finish']) {
      const button = screen.getByRole('button', { name: action });
      expect(button).toHaveClass('touch-target');
      expect(button).toBeDisabled();
    }
  });
});
