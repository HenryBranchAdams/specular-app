import { assertNever } from '../domain/contracts';
import type {
  DeliveryState,
  Turn,
  TurnRole,
} from '../domain/contracts';
import type { PendingUserTurn } from '../app/use-specular';

export interface TranscriptProps {
  onRetry?: () => void;
  pendingUserTurn: PendingUserTurn | null;
  retrying?: boolean;
  turns: readonly Turn[];
}

function roleClass(role: TurnRole): string {
  switch (role) {
    case 'specular':
      return 'turn--specular';
    case 'system':
      return 'turn--system';
    case 'user':
      return 'turn--user';
    default:
      return assertNever(role);
  }
}

function deliveryLabel(state: DeliveryState): string | null {
  switch (state) {
    case 'accepted':
      return null;
    case 'failed':
      return 'Not sent';
    case 'pending':
      return 'Interrupted';
    default:
      return assertNever(state);
  }
}

function isTranscriptTurn(turn: Turn): boolean {
  return turn.operation !== 'conclusion';
}

export function Transcript({ onRetry, pendingUserTurn, retrying = false, turns }: TranscriptProps) {
  const visibleTurns = turns.filter(isTranscriptTurn);
  let currentQuestionId: string | null = null;
  let latestUserTurnId: string | null = null;
  let retryableTurnId: string | null = null;
  for (const turn of visibleTurns) {
    if (turn.role === 'specular') {
      currentQuestionId = turn.id;
    }
    if (turn.role === 'user') {
      latestUserTurnId = turn.id;
    }
    if (
      turn.role === 'user'
      && turn.operation === 'next_question'
      && (turn.deliveryState === 'failed' || turn.deliveryState === 'pending')
    ) {
      retryableTurnId = turn.id;
    }
  }

  return (
    <section
      aria-label="Conversation history"
      aria-live="polite"
      aria-relevant="additions text"
      className="transcript transcript--scrollable"
      role="log"
      tabIndex={0}
    >
      {visibleTurns.map((turn) => {
        const current = turn.id === currentQuestionId;
        const latestUser = pendingUserTurn === null && turn.id === latestUserTurnId;
        const status = deliveryLabel(turn.deliveryState);
        const recoverable = turn.id === retryableTurnId && onRetry !== undefined;
        return (
          <article
            aria-current={current ? 'true' : undefined}
            aria-label={current ? 'Current Specular question' : undefined}
            className={`turn ${roleClass(turn.role)}${current ? ' turn--current' : ''}${latestUser ? ' turn--latest-user' : ''}`}
            data-testid={turn.role === 'specular' ? 'specular-turn' : undefined}
            key={turn.id}
          >
            <p className="turn__content">{turn.content}</p>
            {recoverable ? (
              <div
                aria-label="Saved thought recovery"
                className="turn__recovery"
                role="group"
              >
                <span className={`turn__delivery turn__delivery--${turn.deliveryState}`}>
                  {status}
                </span>
                <button
                  className="turn__retry touch-target"
                  disabled={retrying}
                  onClick={onRetry}
                  type="button"
                >
                  {retrying ? 'Retrying…' : 'Retry'}
                </button>
              </div>
            ) : status === null ? null : (
              <span className={`turn__delivery turn__delivery--${turn.deliveryState}`}>
                {status}
              </span>
            )}
          </article>
        );
      })}
      {pendingUserTurn === null ? null : (
        <article
          className="turn turn--user turn--latest-user turn--pending"
          data-testid="pending-user-turn"
        >
          <p className="turn__content">{pendingUserTurn.content}</p>
          <span className="turn__delivery turn__delivery--pending">Sending…</span>
        </article>
      )}
    </section>
  );
}
