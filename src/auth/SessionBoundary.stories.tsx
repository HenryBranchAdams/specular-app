import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { PlatformSignInLink } from './PlatformSignInLink';
import { SessionBoundary, SessionGate } from './SessionBoundary';

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

export const SigningIn = {
  render: () => (
    <SessionGate
      action={(
        <PlatformSignInLink
          className="primary-action"
          href="/signin-with-chatgpt?return_to=%2F"
          navigate={() => undefined}
          prepareForNavigation={() => new Promise<void>(() => undefined)}
        >
          Sign in with ChatGPT
        </PlatformSignInLink>
      )}
      description="Sign in before Specular opens or reads a workspace on this device."
      title="Your private thinking workspace"
    />
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    canvas.getByRole('link', { name: 'Sign in with ChatGPT' }).click();
    await expect(await canvas.findByRole('link', { name: 'Opening ChatGPT…' })).toHaveAttribute('aria-busy', 'true');
  },
};
