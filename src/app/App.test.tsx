import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialWorkspace } from '../thinking/model';
import type { Reflector } from '../thinking/reflect-client';
import type { SharePublisher } from '../thinking/share-client';
import { App } from './App';

afterEach(cleanup);

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

function setup(options: { reflector?: Reflector; sharePublisher?: SharePublisher } = {}) {
  const reflector = options.reflector ?? { reflect: vi.fn(() => Promise.resolve(reflection())) };
  const sharePublisher = options.sharePublisher ?? {
    publish: vi.fn(() => Promise.resolve({ url: 'https://specular.example/s/abcdefghijklmnop' })),
  };
  render(
    <App
      initialState={createInitialWorkspace(1_800_000_000_000)}
      reflector={reflector}
      sharePublisher={sharePublisher}
    />,
  );
  return { reflector, sharePublisher };
}

describe('Specular thinking workspace', () => {
  it('starts with a human-owned blank document and optional intentions', () => {
    setup();
    expect(screen.getByRole('textbox', { name: 'Document title' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Thought writing block' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Explore what I think' })).toBeVisible();
    expect(screen.getByText('Nothing enters your document unless you write it.')).toBeVisible();
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
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
    await user.click(await screen.findByText('Not quite?'));
    await user.type(screen.getByRole('textbox', { name: "Correct Specular's understanding" }), 'I mean it is a reason to keep looking.');
    await user.click(screen.getByRole('button', { name: 'Respond' }));

    expect(await screen.findAllByText('You mean attention is a reason to continue looking, not a verdict.')).toHaveLength(2);
    expect(reflect).toHaveBeenLastCalledWith(expect.objectContaining({
      move: 'calibrate',
      calibration: 'I mean it is a reason to keep looking.',
    }));
  });

  it('shows authored blocks in the document-scoped connections view', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole('textbox', { name: 'Thought writing block' }), 'A recurring thought becomes visible through writing.');
    await user.click(screen.getByRole('button', { name: 'Connections' }));

    const graph = screen.getByRole('region', { name: 'Connections' });
    expect(within(graph).getByText('A recurring thought becomes visible through writing.')).toBeVisible();
    expect(within(graph).getByRole('combobox', { name: 'Filter connections by kind' })).toHaveValue('all');
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

  it('keeps context breadth and dormancy timing under user control', async () => {
    const user = userEvent.setup();
    setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Context scope' }), 'workspace');
    expect(screen.getByRole('combobox', { name: 'Context scope' })).toHaveValue('workspace');
    await user.click(screen.getByRole('button', { name: 'Library' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Dormancy period' }), '30');
    expect(screen.getByRole('combobox', { name: 'Dormancy period' })).toHaveValue('30');
  });
});
