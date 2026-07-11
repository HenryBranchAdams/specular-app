import { STARTER_PROMPTS } from './starter-prompts';

export interface StarterDeckProps {
  onActivate: () => void;
}

export function StarterDeck({ onActivate }: StarterDeckProps) {
  return (
    <div className="starter-deck" data-motion="static">
      <ul
        aria-label="Ways to begin"
        className="starter-deck__list"
        data-motion="static"
      >
        {STARTER_PROMPTS.map((prompt, index) => (
          <li className="starter-deck__item" key={prompt}>
            <button
              className="starter-deck__prompt"
              onClick={onActivate}
              type="button"
            >
              {index === 0 ? (
                <span className="starter-deck__heading">{prompt}</span>
              ) : (
                <>
                  <span aria-hidden="true" className="starter-deck__index">
                    {String(index).padStart(2, '0')}
                  </span>
                  <span aria-hidden="true" className="starter-deck__rule" />
                  <span className="starter-deck__copy">{prompt}</span>
                </>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
