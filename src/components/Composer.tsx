import {
  useRef,
} from 'react';
import type {
  KeyboardEvent,
  Ref,
  SyntheticEvent,
} from 'react';
import { Mic, Send } from 'lucide-react';
import { assertNever } from '../domain/contracts';
import type { VoiceStatus } from '../voice/use-voice';

export interface ComposerVoiceState {
  error: string | null;
  status: VoiceStatus;
}

export interface ComposerProps {
  busy: boolean;
  ref?: Ref<HTMLTextAreaElement>;
  value: string;
  onFocusChange: (focused: boolean) => void;
  onSubmit: () => void;
  onValueChange: (value: string) => void;
  onVoice: () => void;
  voice?: ComposerVoiceState;
}

function voiceButtonLabel(status: VoiceStatus): string {
  switch (status) {
    case 'idle':
    case 'failure':
      return 'Start voice';
    case 'connecting':
      return 'Connecting';
    case 'listening':
      return 'Stop voice';
    case 'unavailable':
      return 'Voice unavailable';
    default:
      return assertNever(status);
  }
}

function voiceStatusText(status: VoiceStatus): string {
  switch (status) {
    case 'idle':
      return 'Voice ready';
    case 'connecting':
      return 'Connecting';
    case 'listening':
      return 'Listening';
    case 'failure':
    case 'unavailable':
      return 'Voice unavailable';
    default:
      return assertNever(status);
  }
}

export function Composer({
  busy,
  onFocusChange,
  onSubmit,
  onValueChange,
  onVoice,
  ref,
  value,
  voice,
}: ComposerProps) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const setComposerRef = (element: HTMLTextAreaElement | null) => {
    localRef.current = element;
    if (typeof ref === 'function') {
      ref(element);
    } else if (ref !== undefined && ref !== null) {
      ref.current = element;
    }
  };

  const submit = () => {
    if (value.trim().length === 0 || busy) {
      return;
    }
    onSubmit();
    localRef.current?.focus({ preventScroll: true });
  };

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <textarea
        aria-label="Your thought"
        className="composer__input touch-target"
        onBlur={() => { onFocusChange(false); }}
        onChange={(event) => { onValueChange(event.target.value); }}
        onFocus={() => { onFocusChange(true); }}
        onKeyDown={handleKeyDown}
        placeholder="Share whatever’s on your mind…"
        ref={setComposerRef}
        rows={1}
        value={value}
      />
      <div className="composer__controls">
        {voice === undefined ? null : (
          <div className="composer__voice">
            <button
              className="voice-button touch-target"
              disabled={voice.status === 'connecting'
                || voice.status === 'unavailable'
                || (busy && voice.status !== 'listening')}
              onClick={onVoice}
              type="button"
            >
              <Mic aria-hidden="true" size={19} strokeWidth={1.8} />
              <span>{voiceButtonLabel(voice.status)}</span>
            </button>
            <span
              aria-label="Voice status"
              aria-live="polite"
              className="composer__voice-status"
              role="status"
            >
              {voiceStatusText(voice.status)}
            </span>
            {voice.error === null ? null : (
              <span
                aria-live="assertive"
                className="composer__voice-error"
                role="alert"
              >
                {voice.error}
              </span>
            )}
          </div>
        )}
        <button
          aria-label="Send thought"
          className="icon-button icon-button--send touch-target"
          disabled={busy || value.trim().length === 0}
          type="submit"
        >
          <Send aria-hidden="true" size={21} strokeWidth={1.9} />
        </button>
      </div>
    </form>
  );
}
