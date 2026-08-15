import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { SessionBoundary } from './SessionBoundary';

const meta = {
  title: 'Entry/Session boundary',
  component: SessionBoundary,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SessionBoundary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignedOut: Story = {
  args: {
    children: () => <p>Private workspace</p>,
    loadSession: () => Promise.resolve({ authenticated: false, signInUrl: '/signin-with-chatgpt?return_to=%2F' }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('link', { name: 'Sign in with ChatGPT' })).toBeVisible();
    await expect(canvas.queryByText('Private workspace')).not.toBeInTheDocument();
  },
};

export const VerificationFailed: Story = {
  args: {
    children: () => <p>Private workspace</p>,
    loadSession: () => Promise.reject(new Error('Synthetic verification failure')),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent('could not verify your ChatGPT session');
  },
};
