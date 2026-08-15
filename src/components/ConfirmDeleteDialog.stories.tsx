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
