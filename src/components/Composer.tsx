import {
  useRef,
} from 'react';
import type {
  KeyboardEvent,
  Ref,
  SyntheticEvent,
} from 'react';
import { Mic, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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
      <Textarea
        aria-label="Idea, context, or response"
        className="composer__input touch-target"
        onBlur={() => { onFocusChange(false); }}
        onChange={(event) => { onValueChange(event.target.value); }}
        onFocus={() => { onFocusChange(true); }}
        onKeyDown={handleKeyDown}
        placeholder="Write it as it stands…"
        ref={setComposerRef}
        rows={1}
        value={value}
      />
      <div className="composer__controls">
        {voice === undefined ? null : (
          <div className="composer__voice">
            <Button
              aria-label={voiceButtonLabel(voice.status)}
              className={`voice-button touch-target${voice.status === 'unavailable'
                ? ' voice-button--icon'
                : ''}`}
              disabled={voice.status === 'connecting'
                || voice.status === 'unavailable'
                || (busy && voice.status !== 'listening')}
              onClick={onVoice}
              size="lg"
              type="button"
              variant="ghost"
            >
              <Mic aria-hidden="true" data-icon="inline-start" strokeWidth={1.8} />
              {voice.status === 'unavailable' ? null : (
                <span>{voiceButtonLabel(voice.status)}</span>
              )}
            </Button>
            {voice.status === 'unavailable' ? null : (
              <span
                aria-label="Voice status"
                aria-live="polite"
                className="composer__voice-status"
                role="status"
              >
                {voiceStatusText(voice.status)}
              </span>
            )}
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
        <Button
          aria-label="Send input"
          className="icon-button icon-button--send touch-target"
          disabled={busy || value.trim().length === 0}
          size="icon-lg"
          type="submit"
          variant="ghost"
        >
          <Send aria-hidden="true" data-icon="inline-start" strokeWidth={1.9} />
        </Button>
      </div>
    </form>
  );
}
