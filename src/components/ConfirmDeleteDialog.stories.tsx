import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';

const meta = {
  title: 'Patterns/Dialog',
  component: ConfirmDeleteDialog,
  args: {
    artifactTitle: 'Synthetic document',
    confirmLabel: 'Permanently delete document',
    onCancel: fn(),
    onConfirm: fn(() => Promise.resolve()),
    restoreFocusTo: null,
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ConfirmDeleteDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Destructive: Story = {};
export const PendingUnavailable: Story = { args: { confirmDisabled: true } };
export const AccountDeletion: Story = {
  args: {
    artifactTitle: 'hosted workspace',
    confirmLabel: 'Delete account data',
    description: 'This permanently deletes the hosted workspace and revokes every published link. This action cannot be undone.',
    title: 'Delete account data?',
  },
};
export const DiscardDictation: Story = {
  args: {
    artifactTitle: 'dictation draft',
    confirmLabel: 'Discard draft',
    description: 'This removes only the provisional dictation text. Your saved writing remains unchanged.',
    title: 'Discard dictation draft?',
  },
};
export const FailureRecovery: Story = {
  args: {
    onConfirm: fn(() => Promise.reject(new Error('Synthetic failure'))),
  },
};
