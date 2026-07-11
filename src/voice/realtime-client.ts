import { z } from 'zod';
import { assertNever } from '../domain/contracts';
import type { Turn, TurnRole } from '../domain/contracts';
import {
  MAX_CONTEXT_TURNS,
  threadIdSchema,
  turnSchema,
} from '../domain/schemas';
import {
  addRealtimeListener,
  realtimeEventData,
  realtimeEventTrack,
  releaseRealtimeResources,
} from './realtime-browser';
import type {
  CompletedRealtimeExchange,
  RealtimeBrowserResources,
  RealtimeControllerDependencies,
  RealtimeControllerStatus,
  RealtimeFailureCode,
  RealtimeMediaStream,
  RealtimeStartContext,
  RealtimeVoiceController,
} from './realtime-browser';
import {
  createRealtimeEventAccumulator,
  type CompletedTranscriptPair,
  type RealtimeEventAccumulator,
  type RealtimeMessageOutcome,
} from './realtime-events';

export type {
  CompletedRealtimeExchange,
  RealtimeAbortController,
  RealtimeAudio,
  RealtimeControllerDependencies,
  RealtimeControllerStatus,
  RealtimeDataChannel,
  RealtimeFailure,
  RealtimeFailureCode,
  RealtimeFetch,
  RealtimeFetchResponse,
  RealtimeMediaStream,
  RealtimeMediaStreamTrack,
  RealtimePeerConnection,
  RealtimeStartContext,
  RealtimeVoiceController,
} from './realtime-browser';

const REALTIME_CREDENTIAL_PATH = '/api/realtime/session';
const REALTIME_SDP_URL = 'https://api.openai.com/v1/realtime/calls';
const MAX_CREDENTIAL_LENGTH = 4_096;
const MAX_SDP_LENGTH = 1_000_000;
const MAX_CREDENTIAL_LIFETIME_SECONDS = 7_200;
const CONNECTION_TIMEOUT_MS = 15_000;

const credentialSchema = z.object({
  value: z.string().min(1).max(MAX_CREDENTIAL_LENGTH),
  expiresAt: z.number().int().positive().finite(),
}).strict();

interface ActiveSession extends RealtimeBrowserResources {
  accumulator?: RealtimeEventAccumulator;
  seedTurns: readonly Turn[];
  seeded: boolean;
  threadId: RealtimeStartContext['threadId'];
}

function failureMessage(code: RealtimeFailureCode): string {
  switch (code) {
    case 'completion_failed':
      return 'The completed voice exchange could not be saved.';
    case 'connection_failed':
      return 'The voice connection could not be established.';
    case 'credential_unavailable':
      return 'Voice is temporarily unavailable.';
    case 'microphone_unavailable':
      return 'Microphone access is unavailable.';
    case 'protocol_error':
      return 'The voice session returned an invalid event.';
    case 'realtime_error':
      return 'The voice session ended unexpectedly.';
    default:
      return assertNever(code);
  }
}

function selectedSeedTurns(context: RealtimeStartContext): readonly Turn[] {
  const parsedThreadId = threadIdSchema.safeParse(context.threadId);
  if (!parsedThreadId.success) {
    return [];
  }

  const turnsById = new Map<string, Turn>();
  context.turns.forEach((candidate) => {
    const parsedTurn = turnSchema.safeParse(candidate);
    if (
      parsedTurn.success
      && parsedTurn.data.threadId === parsedThreadId.data
      && parsedTurn.data.deliveryState === 'accepted'
      && parsedTurn.data.role !== 'system'
      && !turnsById.has(parsedTurn.data.id)
    ) {
      turnsById.set(parsedTurn.data.id, parsedTurn.data);
    }
  });

  return [...turnsById.values()]
    .sort((first, second) => first.position - second.position)
    .slice(-MAX_CONTEXT_TURNS);
}

function seedRole(role: TurnRole): 'assistant' | 'user' | undefined {
  switch (role) {
    case 'user':
      return 'user';
    case 'specular':
      return 'assistant';
    case 'system':
      return undefined;
    default:
      return assertNever(role);
  }
}

function seedContentType(role: 'assistant' | 'user'): 'input_text' | 'output_text' {
  switch (role) {
    case 'user':
      return 'input_text';
    case 'assistant':
      return 'output_text';
    default:
      return assertNever(role);
  }
}

export function createRealtimeVoiceController(
  dependencies: RealtimeControllerDependencies,
): RealtimeVoiceController {
  let activeSession: ActiveSession | undefined;
  let completionQueue = Promise.resolve();
  let status: RealtimeControllerStatus = 'idle';

  const setStatus = (nextStatus: RealtimeControllerStatus): void => {
    if (nextStatus !== status) {
      status = nextStatus;
      dependencies.onStatus(status);
    }
  };

  const isActive = (session: ActiveSession): boolean => (
    activeSession === session && !session.cleaned
  );

  const cleanup = (session: ActiveSession): void => {
    if (!releaseRealtimeResources(session)) {
      return;
    }
    dependencies.cancelValidatedSpeech();
    session.accumulator?.clear();
    if (activeSession === session) {
      activeSession = undefined;
    }
    setStatus('idle');
  };

  const fail = (session: ActiveSession, code: RealtimeFailureCode): void => {
    if (!isActive(session)) {
      return;
    }
    cleanup(session);
    dependencies.onFailure({ code, message: failureMessage(code) });
  };

  const completeExchange = (
    session: ActiveSession,
    pair: CompletedTranscriptPair,
  ): void => {
    if (!isActive(session)) {
      return;
    }
    const exchange: CompletedRealtimeExchange = {
      threadId: session.threadId,
      userTranscript: pair.userTranscript,
      assistantTranscript: pair.assistantTranscript,
    };
    completionQueue = completionQueue.then(async () => {
      try {
        await dependencies.onCompletedExchange(exchange);
      } catch {
        if (isActive(session)) {
          fail(session, 'completion_failed');
        } else {
          dependencies.onInactiveCompletionFailure({
            code: 'completion_failed',
            message: failureMessage('completion_failed'),
          });
        }
        return;
      }
      if (!isActive(session)) {
        return;
      }
      try {
        await dependencies.speakValidatedTranscript(exchange.assistantTranscript);
      } catch {
        fail(session, 'connection_failed');
      }
    });
  };

  const handleMessageOutcome = (
    session: ActiveSession,
    outcome: RealtimeMessageOutcome,
  ): void => {
    switch (outcome) {
      case 'handled':
      case 'ignored':
        return;
      case 'malformed':
        fail(session, 'protocol_error');
        return;
      case 'realtime_error':
        fail(session, 'realtime_error');
        return;
      default:
        return assertNever(outcome);
    }
  };

  const seedConversation = (session: ActiveSession): void => {
    if (!isActive(session) || session.seeded || session.channel === undefined) {
      return;
    }
    session.seeded = true;

    try {
      session.seedTurns.forEach((turn) => {
        const role = seedRole(turn.role);
        if (role === undefined) {
          return;
        }
        session.channel?.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role,
            content: [{ type: seedContentType(role), text: turn.content }],
          },
        }));
      });
      setStatus('listening');
    } catch {
      fail(session, 'connection_failed');
    }
  };

  const requestCredential = async (
    session: ActiveSession,
  ): Promise<z.infer<typeof credentialSchema>> => {
    const response = await dependencies.fetch(REALTIME_CREDENTIAL_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: session.abortController.signal,
    });
    if (!response.ok) {
      throw new Error('Credential request was rejected.');
    }

    const parsed = credentialSchema.safeParse(await response.json());
    const nowSeconds = Math.floor(dependencies.now() / 1_000);
    if (
      !parsed.success
      || parsed.data.expiresAt <= nowSeconds
      || parsed.data.expiresAt > nowSeconds + MAX_CREDENTIAL_LIFETIME_SECONDS
    ) {
      throw new Error('Credential response was invalid.');
    }
    return parsed.data;
  };

  const requestSdpAnswer = async (
    session: ActiveSession,
    credential: string,
    offer: string,
  ): Promise<string> => {
    const response = await dependencies.fetch(REALTIME_SDP_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credential}`,
        'Content-Type': 'application/sdp',
      },
      body: offer,
      signal: session.abortController.signal,
    });
    if (!response.ok) {
      throw new Error('Realtime SDP request was rejected.');
    }
    const answer = await response.text();
    if (answer.trim() === '' || answer.length > MAX_SDP_LENGTH) {
      throw new Error('Realtime SDP response was invalid.');
    }
    return answer;
  };

  const registerSessionListeners = (session: ActiveSession): void => {
    if (session.channel === undefined || session.peer === undefined) {
      throw new Error('Realtime browser resources are incomplete.');
    }
    addRealtimeListener(session, session.channel, 'open', () => {
      session.cancelDeadline?.();
      delete session.cancelDeadline;
      seedConversation(session);
    });
    addRealtimeListener(session, session.channel, 'message', (event) => {
      const outcome = session.accumulator?.acceptMessage(realtimeEventData(event));
      if (outcome !== undefined) {
        handleMessageOutcome(session, outcome);
      }
    });
    addRealtimeListener(session, session.channel, 'error', () => {
      fail(session, 'connection_failed');
    });
    addRealtimeListener(session, session.channel, 'close', () => {
      fail(session, 'connection_failed');
    });
    addRealtimeListener(session, session.peer, 'track', (event) => {
      const track = realtimeEventTrack(event);
      if (track === undefined || !isActive(session)) {
        return;
      }
      if (!session.remoteTracks.has(track)) {
        session.remoteTracks.add(track);
      }
    });
    addRealtimeListener(session, session.peer, 'connectionstatechange', () => {
      if (session.peer?.connectionState === 'failed') {
        fail(session, 'connection_failed');
      }
    });
  };

  const connectBrowserSession = async (
    session: ActiveSession,
    credential: string,
  ): Promise<void> => {
    session.peer = dependencies.createPeerConnection();
    session.channel = session.peer.createDataChannel('oai-events');

    const localStream = session.localStream;
    if (localStream === undefined) {
      throw new Error('Microphone stream is unavailable.');
    }
    localStream.getTracks().forEach((track) => {
      session.peer?.addTrack(track, localStream);
    });
    registerSessionListeners(session);

    const offer = await session.peer.createOffer();
    if (offer.sdp.trim() === '' || offer.sdp.length > MAX_SDP_LENGTH) {
      throw new Error('Realtime offer was invalid.');
    }
    await session.peer.setLocalDescription(offer);
    const answer = await requestSdpAnswer(session, credential, offer.sdp);
    if (isActive(session)) {
      await session.peer.setRemoteDescription({ type: 'answer', sdp: answer });
    }
  };

  const start = async (context: RealtimeStartContext): Promise<void> => {
    if (activeSession !== undefined) {
      cleanup(activeSession);
    }

    const threadId = threadIdSchema.safeParse(context.threadId);
    if (!threadId.success) {
      dependencies.onFailure({
        code: 'protocol_error',
        message: failureMessage('protocol_error'),
      });
      return;
    }

    const session: ActiveSession = {
      abortController: dependencies.createAbortController(),
      cleaned: false,
      listeners: [],
      remoteTracks: new Set(),
      seedTurns: selectedSeedTurns(context),
      seeded: false,
      threadId: threadId.data,
    };
    session.accumulator = createRealtimeEventAccumulator((pair) => {
      completeExchange(session, pair);
    });
    session.cancelDeadline = dependencies.scheduleTimeout(() => {
      fail(session, 'connection_failed');
    }, CONNECTION_TIMEOUT_MS);
    activeSession = session;
    setStatus('connecting');

    let credential: z.infer<typeof credentialSchema>;
    try {
      credential = await requestCredential(session);
    } catch {
      fail(session, 'credential_unavailable');
      return;
    }
    if (!isActive(session)) {
      return;
    }

    let localStream: RealtimeMediaStream;
    try {
      localStream = await dependencies.mediaDevices.getUserMedia({ audio: true });
    } catch {
      fail(session, 'microphone_unavailable');
      return;
    }
    if (!isActive(session)) {
      localStream.getTracks().forEach((track) => { track.stop(); });
      return;
    }
    session.localStream = localStream;

    try {
      await connectBrowserSession(session, credential.value);
    } catch {
      fail(session, 'connection_failed');
    }
  };

  return {
    getStatus(): RealtimeControllerStatus {
      return status;
    },
    start,
    stop(): void {
      if (activeSession !== undefined) {
        cleanup(activeSession);
      }
    },
  };
}
