import {
  useEffect,
  useState,
} from 'react';
import { STARTER_PROMPTS } from './starter-prompts';

export interface StarterDeckProps {
  onActivate: () => void;
}

function reducedMotionQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => reducedMotionQuery()?.matches ?? false);

  useEffect(() => {
    const query = reducedMotionQuery();
    if (query === null) {
      return undefined;
    }
    const update = (event: MediaQueryListEvent) => {
      setReduced(event.matches);
    };
    query.addEventListener('change', update);
    return () => {
      query.removeEventListener('change', update);
    };
  }, []);

  return reduced;
}

export function StarterDeck({ onActivate }: StarterDeckProps) {
  const reducedMotion = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const motion = reducedMotion ? 'static' : paused ? 'paused' : 'drifting';
  const pause = () => {
    setPaused(true);
  };

  return (
    <div className="starter-deck" data-motion={motion}>
      <ul
        aria-label="Ways to begin"
        className="starter-deck__list"
        data-motion={motion}
        onFocusCapture={pause}
        onKeyDown={pause}
        onPointerDown={pause}
        onPointerEnter={pause}
      >
        {STARTER_PROMPTS.map((prompt) => (
          <li className="starter-deck__item" key={prompt}>
            <button
              className="starter-deck__prompt"
              onClick={onActivate}
              type="button"
            >
              {prompt}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
