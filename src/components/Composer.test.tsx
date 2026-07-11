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
import { Composer } from './Composer';

afterEach(cleanup);

const BASE_PROPS = {
  busy: false,
  onFocusChange: vi.fn(),
  onSubmit: vi.fn(),
  onValueChange: vi.fn(),
  onVoice: vi.fn(),
  value: 'Keep this typed draft.',
} as const;

describe('Composer voice affordance', () => {
  it('keeps voice absent when the feature is disabled without affecting text controls', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Composer {...BASE_PROPS} onValueChange={onValueChange} />);

    expect(screen.queryByRole('button', { name: /voice/iu })).not.toBeInTheDocument();
    const composer = screen.getByRole('textbox', { name: 'Idea, context, or response' });
    const send = screen.getByRole('button', { name: 'Send input' });
    expect(composer).toHaveValue('Keep this typed draft.');
    expect(send).toBeEnabled();

    await user.type(composer, ' More');
    expect(onValueChange).toHaveBeenCalled();
  });

  it.each([
    ['idle', 'Start voice', false],
    ['connecting', 'Connecting', true],
    ['listening', 'Stop voice', false],
    ['unavailable', 'Voice unavailable', true],
  ] as const)('renders the %s voice state with an accessible control', (status, label, disabled) => {
    render(
      <Composer
        {...BASE_PROPS}
        voice={{ error: null, status }}
      />,
    );

    const voiceButton = screen.getByRole('button', { name: label });
    if (status === 'unavailable') {
      expect(voiceButton).toHaveClass('voice-button--icon');
      expect(voiceButton).not.toHaveTextContent(label);
      expect(screen.queryByRole('status', { name: 'Voice status' })).not.toBeInTheDocument();
    } else {
      expect(voiceButton).toHaveTextContent(label);
    }
    expect(voiceButton).toHaveClass('touch-target');
    expect(voiceButton).toHaveAttribute('type', 'button');
    if (disabled) {
      expect(voiceButton).toBeDisabled();
    } else {
      expect(voiceButton).toBeEnabled();
    }
  });

  it('announces a safe failure while preserving the controlled draft and usable send action', async () => {
    const user = userEvent.setup();
    const onVoice = vi.fn();
    render(
      <Composer
        {...BASE_PROPS}
        onVoice={onVoice}
        voice={{
          error: 'Microphone access was not granted.',
          status: 'failure',
        }}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Microphone access was not granted.');
    expect(screen.getByRole('textbox', { name: 'Idea, context, or response' }))
      .toHaveValue('Keep this typed draft.');
    expect(screen.getByRole('button', { name: 'Send input' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Start voice' }));
    expect(onVoice).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox', { name: 'Idea, context, or response' }))
      .toHaveValue('Keep this typed draft.');
  });
});
