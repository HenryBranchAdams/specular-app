import {
  useRef,
} from 'react';
import type {
  KeyboardEvent,
  Ref,
  SyntheticEvent,
} from 'react';
import { Mic, Send } from 'lucide-react';

export interface ComposerProps {
  busy: boolean;
  ref?: Ref<HTMLTextAreaElement>;
  value: string;
  onFocusChange: (focused: boolean) => void;
  onSubmit: () => void;
  onValueChange: (value: string) => void;
  onVoice: () => void;
}

export function Composer({
  busy,
  onFocusChange,
  onSubmit,
  onValueChange,
  onVoice,
  ref,
  value,
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
        <button
          aria-label="Start voice input"
          className="icon-button touch-target"
          onClick={onVoice}
          type="button"
        >
          <Mic aria-hidden="true" size={22} strokeWidth={1.8} />
        </button>
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
