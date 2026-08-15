import type { Meta, StoryObj } from '@storybook/react-vite';
import { Library } from 'lucide-react';
import { expect, userEvent, within } from 'storybook/test';
import { Button } from './button';

const meta = {
  title: 'Primitives/Button',
  component: Button,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
  render: () => (
    <div className="ui-story-row">
      <Button>Primary action</Button>
      <Button variant="outline">Secondary action</Button>
      <Button disabled>Working…</Button>
      <Button variant="destructive">Delete</Button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Primary action' })).toHaveFocus();
  },
};

export const IconButtonStates: Story = {
  render: () => (
    <div className="ui-story-row">
      <Button aria-label="Open library" size="icon" variant="outline"><Library /></Button>
      <Button aria-label="Library unavailable" disabled size="icon" variant="outline"><Library /></Button>
    </div>
  ),
};
