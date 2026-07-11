import { STARTER_PROMPTS } from './starter-prompts';

export function StarterLead() {
  return (
    <div className="starter-lead" data-motion="static">
      <h2>{STARTER_PROMPTS[0]}</h2>
    </div>
  );
}

export function StarterCues() {
  return (
    <ul aria-label="Ways to begin" className="starter-cues" data-motion="static">
      {STARTER_PROMPTS.slice(1).map((prompt) => (
        <li className="starter-cues__item" key={prompt}>
          <span>{prompt}</span>
        </li>
      ))}
    </ul>
  );
}
