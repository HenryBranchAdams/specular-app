import { PencilLine, Zap } from 'lucide-react';

export interface ThreadActionsProps {
  activity: 'challenge' | 'conclusion' | 'retry' | 'submit' | null;
  onChallenge: () => void;
  onDraftConclusion: () => void;
}

export function ThreadActions({
  activity,
  onChallenge,
  onDraftConclusion,
}: ThreadActionsProps) {
  const busy = activity !== null;
  return (
    <nav aria-label="Thread actions" className="thread-actions">
      <button
        className="thread-action thread-action--challenge touch-target"
        disabled={busy}
        onClick={onChallenge}
        type="button"
      >
        <Zap aria-hidden="true" size={18} strokeWidth={2} />
        <span>{activity === 'challenge' ? 'Challenging…' : 'Challenge me'}</span>
      </button>
      <button
        className="thread-action thread-action--conclusion touch-target"
        disabled={busy}
        onClick={onDraftConclusion}
        type="button"
      >
        <PencilLine aria-hidden="true" size={18} strokeWidth={1.9} />
        <span>{activity === 'conclusion' ? 'Drafting…' : 'Draft a conclusion'}</span>
      </button>
    </nav>
  );
}
