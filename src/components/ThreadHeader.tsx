import { Library } from 'lucide-react';
import type { Thread } from '../domain/contracts';

export interface ThreadHeaderProps {
  onOpenCapsules: () => void;
  thread: Thread | null;
}

export function ThreadHeader({ onOpenCapsules, thread }: ThreadHeaderProps) {
  return (
    <header className="thread-header">
      <h1 className="thread-header__title">{thread?.title ?? 'Specular'}</h1>
      <button
        aria-label="Open capsule library"
        className="thread-header__capsules touch-target"
        onClick={onOpenCapsules}
        type="button"
      >
        <Library aria-hidden="true" size={18} strokeWidth={1.8} />
        <span>Capsules</span>
      </button>
    </header>
  );
}
