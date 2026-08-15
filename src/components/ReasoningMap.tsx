import { ChevronDown } from 'lucide-react';
import type { ThreadUnderstanding } from '../domain/contracts';

export interface ReasoningMapProps {
  understanding: ThreadUnderstanding;
}

interface ReasoningSection {
  items: readonly string[];
  label: string;
}

export function ReasoningMap({ understanding }: ReasoningMapProps) {
  const sections: ReasoningSection[] = [
    { label: 'Claims & assumptions', items: understanding.claims },
    { label: 'Evidence & observations', items: understanding.observations },
    { label: 'Stakeholders', items: understanding.stakeholders },
    { label: 'Distinctions', items: understanding.distinctions },
    { label: 'Tensions', items: understanding.tensions },
    { label: 'Open blind spots', items: understanding.unexploredBlindSpots },
  ].filter((section) => section.items.length > 0);

  if (sections.length === 0) {
    return null;
  }

  return (
    <aside aria-label="Structured understanding" className="reasoning-map" data-ui-part="reasoning-map">
      <details>
        <summary>
          <span>Reasoning map</span>
          <ChevronDown aria-hidden="true" size={17} />
        </summary>
        <div className="reasoning-map__content">
          {sections.map((section) => (
            <section key={section.label}>
              <h2>{section.label}</h2>
              <ul>
                {section.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          ))}
        </div>
      </details>
    </aside>
  );
}
