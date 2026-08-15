import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { PwaPromptSurface } from './PwaUpdatePrompt';

const meta = {
  title: 'Patterns/Status',
  component: PwaPromptSurface,
  args: { onDismiss: fn(), onUpdate: fn() },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PwaPromptSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UpdateReady: Story = { args: { kind: 'update' } };
export const Preparing: Story = { args: { kind: 'update', updating: true } };
export const UpdateFailure: Story = { args: { kind: 'update', updateError: 'Pause dictation before updating.' } };
export const OfflineReady: Story = { args: { kind: 'offline' } };
