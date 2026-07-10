import { assertNever } from '../domain/contracts';
import type {
  DeliveryState,
  Turn,
  TurnRole,
} from '../domain/contracts';
import type { PendingUserTurn } from '../app/use-specular';

export interface TranscriptProps {
  pendingUserTurn: PendingUserTurn | null;
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
      return 'Interrupted — ready to retry';
    default:
      return assertNever(state);
  }
}

function isTranscriptTurn(turn: Turn): boolean {
  return turn.operation !== 'conclusion';
}

export function Transcript({ pendingUserTurn, turns }: TranscriptProps) {
  const visibleTurns = turns.filter(isTranscriptTurn);
  let currentQuestionId: string | null = null;
  for (const turn of visibleTurns) {
    if (turn.role === 'specular') {
      currentQuestionId = turn.id;
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
        const status = deliveryLabel(turn.deliveryState);
        return (
          <article
            aria-current={current ? 'true' : undefined}
            aria-label={current ? 'Current Specular question' : undefined}
            className={`turn ${roleClass(turn.role)}${current ? ' turn--current' : ''}`}
            data-testid={turn.role === 'specular' ? 'specular-turn' : undefined}
            key={turn.id}
          >
            <p className="turn__content">{turn.content}</p>
            {status === null ? null : (
              <span className={`turn__delivery turn__delivery--${turn.deliveryState}`}>
                {status}
              </span>
            )}
          </article>
        );
      })}
      {pendingUserTurn === null ? null : (
        <article className="turn turn--user turn--pending" data-testid="pending-user-turn">
          <p className="turn__content">{pendingUserTurn.content}</p>
          <span className="turn__delivery turn__delivery--pending">Sending…</span>
        </article>
      )}
    </section>
  );
}
