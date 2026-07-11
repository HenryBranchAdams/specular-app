import { Library } from 'lucide-react';
import type { Ref } from 'react';
import type { Thread } from '../domain/contracts';

export interface ThreadHeaderProps {
  capsuleButtonRef?: Ref<HTMLButtonElement>;
  onOpenCapsules: () => void;
  thread: Thread | null;
}

export function ThreadHeader({
  capsuleButtonRef,
  onOpenCapsules,
  thread,
}: ThreadHeaderProps) {
  return (
    <header className="thread-header">
      <h1 className="thread-header__title">{thread?.title ?? 'Specular'}</h1>
      <button
        aria-label="Open capsule library — Capsules"
        className="thread-header__capsules touch-target"
        onClick={onOpenCapsules}
        ref={capsuleButtonRef}
        type="button"
      >
        <Library aria-hidden="true" size={18} strokeWidth={1.8} />
        <span>Capsules</span>
      </button>
    </header>
  );
}
