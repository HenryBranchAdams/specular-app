import type { Operation, ThreadContext, ThreadId } from '../domain/contracts';
import {
  MAX_CONTEXT_TURNS,
  threadContextSchema,
} from '../domain/schemas';
import type { LocalRepositories } from '../storage/repositories';

export const MAX_THREAD_CONTEXT_PAYLOAD_LENGTH = 512_000;

type ContextRepositories = Pick<LocalRepositories, 'threads' | 'turns'>;

export class ThreadContextNotFoundError extends Error {
  constructor(threadId: ThreadId) {
    super(`Thread context is unavailable for ${threadId}.`);
    this.name = 'ThreadContextNotFoundError';
  }
}

function payloadLength(context: ThreadContext): number {
  return JSON.stringify(context).length;
}

export async function buildThreadContext(
  threadId: ThreadId,
  operation: Operation,
  repositories: ContextRepositories,
): Promise<ThreadContext> {
  const thread = await repositories.threads.get(threadId);
  if (thread === undefined) {
    throw new ThreadContextNotFoundError(threadId);
  }

  const listedTurnIds = new Set(thread.turnIds);
  const selectedTurns = (await repositories.turns.listByThread(threadId))
    .filter((turn) => turn.threadId === threadId && listedTurnIds.has(turn.id))
    .sort((first, second) => first.position - second.position)
    .slice(-MAX_CONTEXT_TURNS);

  let turns = selectedTurns;
  let context = threadContextSchema.parse({
    thread: { id: thread.id },
    turns,
    understanding: thread.understanding,
    ...(thread.provisionalConclusion === undefined
      ? {}
      : { provisionalConclusion: thread.provisionalConclusion }),
    operation,
  });

  while (payloadLength(context) > MAX_THREAD_CONTEXT_PAYLOAD_LENGTH && turns.length > 1) {
    turns = turns.slice(1);
    context = threadContextSchema.parse({
      ...context,
      turns,
    });
  }

  if (payloadLength(context) > MAX_THREAD_CONTEXT_PAYLOAD_LENGTH) {
    throw new Error('Thread context exceeds the bounded application payload.');
  }

  return context;
}
