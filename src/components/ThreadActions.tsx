export interface ThreadActionsProps {
  activity:
    | 'activate'
    | 'challenge'
    | 'conclusion'
    | 'delete'
    | 'export'
    | 'finish'
    | 'keep'
    | 'retry'
    | 'save'
    | 'submit'
    | 'update'
    | null;
  disabled?: boolean;
  gatherAvailable: boolean;
  gathered: boolean;
  onChallenge: () => void;
  onDraftConclusion: () => void;
}

export function ThreadActions({
  activity,
  disabled = false,
  gatherAvailable,
  gathered,
  onChallenge,
  onDraftConclusion,
}: ThreadActionsProps) {
  const busy = disabled || activity !== null;
  let gatherLabel = gathered ? 'Open gathered notes' : 'Gather this thread';
  if (activity === 'conclusion') {
    gatherLabel = 'Gathering…';
  }
  return (
    <nav aria-label="Thread actions" className="thread-actions">
      <button
        className="thread-action thread-action--challenge touch-target"
        disabled={busy}
        onClick={onChallenge}
        type="button"
      >
        <span>{activity === 'challenge' ? 'Testing…' : 'Test this'}</span>
      </button>
      {gatherAvailable ? (
        <button
          className="thread-action thread-action--conclusion touch-target"
          disabled={busy}
          onClick={onDraftConclusion}
          type="button"
        >
          <span>{gatherLabel}</span>
        </button>
      ) : null}
    </nav>
  );
}
