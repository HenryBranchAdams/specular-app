import { Library } from 'lucide-react';
import type { Ref } from 'react';
import { Button } from '@/components/ui/button';
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
    <header className="thread-header" data-thread-active={thread === null ? 'false' : 'true'}>
      <h1 className="thread-header__title">Specular</h1>
      <Button
        aria-label="Open capsule library — Capsules"
        className="thread-header__capsules touch-target"
        onClick={onOpenCapsules}
        ref={capsuleButtonRef}
        size="lg"
        type="button"
        variant="ghost"
      >
        <Library aria-hidden="true" data-icon="inline-start" strokeWidth={1.8} />
        <span>Capsules</span>
      </Button>
    </header>
  );
}
