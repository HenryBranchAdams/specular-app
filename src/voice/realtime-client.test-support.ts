import { expect } from 'vitest';
import type { ThreadId, Turn } from '../domain/contracts';
import { threadIdSchema, turnSchema } from '../domain/schemas';
import {
  createRealtimeVoiceController,
  type CompletedRealtimeExchange,
  type RealtimeAbortController,
  type RealtimeAudio,
  type RealtimeControllerDependencies,
  type RealtimeControllerStatus,
  type RealtimeDataChannel,
  type RealtimeFailure,
  type RealtimeFetchResponse,
  type RealtimeMediaStream,
  type RealtimeMediaStreamTrack,
  type RealtimePeerConnection,
} from './realtime-client';

export const NOW = 1_000_000;
export const ACTIVE_THREAD_ID = threadIdSchema.parse('thread-active');
export const OTHER_THREAD_ID = threadIdSchema.parse('thread-other');

type Listener = (event: unknown) => void;

class FakeEventTarget {
  readonly added: { listener: Listener; type: string }[] = [];
  readonly removed: { listener: Listener; type: string }[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    this.added.push({ listener, type });
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
    this.removed.push({ listener, type });
  }

  emit(type: string, event: unknown = {}): void {
    [...(this.listeners.get(type) ?? [])].forEach((listener) => {
      listener(event);
    });
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }
}

export class FakeTrack implements RealtimeMediaStreamTrack {
  stopCount = 0;

  stop(): void {
    this.stopCount += 1;
  }
}

class FakeStream implements RealtimeMediaStream {
  readonly tracks: RealtimeMediaStreamTrack[];

  constructor(tracks: RealtimeMediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  addTrack(track: RealtimeMediaStreamTrack): void {
    this.tracks.push(track);
  }

  getTracks(): RealtimeMediaStreamTrack[] {
    return [...this.tracks];
  }
}

class FakeDataChannel extends FakeEventTarget implements RealtimeDataChannel {
  closeCount = 0;
  readonly sent: string[] = [];

  close(): void {
    this.closeCount += 1;
  }

  send(data: string): void {
    this.sent.push(data);
  }
}

class FakePeerConnection extends FakeEventTarget implements RealtimePeerConnection {
  closeCount = 0;
  connectionState = 'new';
  readonly dataChannel = new FakeDataChannel();
  readonly addedTracks: {
    stream: RealtimeMediaStream;
    track: RealtimeMediaStreamTrack;
  }[] = [];
  localDescription: { sdp: string; type: 'offer' } | undefined;
  remoteDescription: { sdp: string; type: 'answer' } | undefined;

  addTrack(track: RealtimeMediaStreamTrack, stream: RealtimeMediaStream): void {
    this.addedTracks.push({ stream, track });
  }

  close(): void {
    this.closeCount += 1;
    this.connectionState = 'closed';
  }

  createDataChannel(label: string): RealtimeDataChannel {
    expect(label).toBe('oai-events');
    return this.dataChannel;
  }

  async createOffer(): Promise<{ sdp: string; type: 'offer' }> {
    await Promise.resolve();
    return { sdp: 'local-offer-sdp', type: 'offer' };
  }

  async setLocalDescription(description: { sdp: string; type: 'offer' }): Promise<void> {
    await Promise.resolve();
    this.localDescription = description;
  }

  async setRemoteDescription(description: { sdp: string; type: 'answer' }): Promise<void> {
    await Promise.resolve();
    this.remoteDescription = description;
  }
}

class FakeAudio implements RealtimeAudio {
  autoplay = false;
  currentTime = 12;
  pauseCount = 0;
  playCount = 0;
  srcObject: RealtimeMediaStream | null = null;

  pause(): void {
    this.pauseCount += 1;
  }

  async play(): Promise<void> {
    await Promise.resolve();
    this.playCount += 1;
  }
}

class CountingAbortController implements RealtimeAbortController {
  abortCount = 0;
  private readonly controller = new AbortController();

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  abort(): void {
    this.abortCount += 1;
    this.controller.abort();
  }
}

interface FetchCall {
  init: RequestInit | undefined;
  input: RequestInfo | URL;
}

interface HarnessOptions {
  completedHandler?: (exchange: CompletedRealtimeExchange) => Promise<void> | void;
  deferUserMedia?: boolean;
  credentialBody?: unknown;
  credentialOk?: boolean;
  credentialReject?: Error;
  getUserMediaReject?: Error;
  sdpBody?: string;
  sdpOk?: boolean;
  sdpReject?: Error;
  speakReject?: Error;
}

export interface RealtimeClientHarness {
  abortControllers: CountingAbortController[];
  audio: FakeAudio;
  completed: CompletedRealtimeExchange[];
  controller: ReturnType<typeof createRealtimeVoiceController>;
  failures: RealtimeFailure[];
  inactiveCompletionFailures: RealtimeFailure[];
  speechCancelCount: () => number;
  fetchCalls: FetchCall[];
  localStream: FakeStream;
  localTrack: FakeTrack;
  mediaRequestCount: () => number;
  order: string[];
  peer: FakePeerConnection;
  remoteStream: FakeStream;
  statuses: RealtimeControllerStatus[];
  spoken: string[];
  timeoutDelays: number[];
  expireConnection(): void;
  resolveUserMedia(): void;
}

function response(options: {
  body: string;
  json?: unknown;
  ok: boolean;
  status: number;
}): RealtimeFetchResponse {
  return {
    ok: options.ok,
    status: options.status,
    async json(): Promise<unknown> {
      await Promise.resolve();
      if (options.json === undefined) {
        throw new Error('Response did not contain JSON.');
      }
      return options.json;
    },
    async text(): Promise<string> {
      await Promise.resolve();
      return options.body;
    },
  };
}

export function makeTurn(options: {
  deliveryState?: Turn['deliveryState'];
  id: string;
  position: number;
  role: Turn['role'];
  threadId?: ThreadId;
}): Turn {
  return turnSchema.parse({
    id: options.id,
    ownerScope: 'local',
    threadId: options.threadId ?? ACTIVE_THREAD_ID,
    role: options.role,
    content: `${options.role} content ${String(options.position)}`,
    modality: 'text',
    createdAt: options.position + 1,
    position: options.position,
    operation: options.role === 'system' ? undefined : 'next_question',
    deliveryState: options.deliveryState ?? 'accepted',
  });
}

export function createHarness(options: HarnessOptions = {}): RealtimeClientHarness {
  const peer = new FakePeerConnection();
  const localTrack = new FakeTrack();
  const localStream = new FakeStream([localTrack]);
  const remoteStream = new FakeStream();
  const audio = new FakeAudio();
  const fetchCalls: FetchCall[] = [];
  const order: string[] = [];
  const statuses: RealtimeControllerStatus[] = [];
  const completed: CompletedRealtimeExchange[] = [];
  const failures: RealtimeFailure[] = [];
  const inactiveCompletionFailures: RealtimeFailure[] = [];
  const spoken: string[] = [];
  let speechCancelCount = 0;
  const abortControllers: CountingAbortController[] = [];
  const timeoutCallbacks = new Set<() => void>();
  const timeoutDelays: number[] = [];
  let mediaRequestCount = 0;
  let resolveDeferredUserMedia: (() => void) | undefined;
  const deferredUserMedia = new Promise<void>((resolve) => {
    resolveDeferredUserMedia = resolve;
  });

  const dependencies: RealtimeControllerDependencies = {
    async fetch(input, init): Promise<RealtimeFetchResponse> {
      await Promise.resolve();
      fetchCalls.push({ input, init });
      if (input === '/api/realtime/session') {
        order.push('credential');
        if (options.credentialReject !== undefined) {
          throw options.credentialReject;
        }
        return response({
          body: '',
          json: options.credentialBody ?? {
            value: 'ephemeral-secret',
            expiresAt: Math.floor(NOW / 1_000) + 60,
          },
          ok: options.credentialOk ?? true,
          status: options.credentialOk === false ? 503 : 200,
        });
      }

      order.push('sdp');
      if (options.sdpReject !== undefined) {
        throw options.sdpReject;
      }
      return response({
        body: options.sdpBody ?? 'remote-answer-sdp',
        ok: options.sdpOk ?? true,
        status: options.sdpOk === false ? 502 : 200,
      });
    },
    mediaDevices: {
      async getUserMedia(): Promise<RealtimeMediaStream> {
        await Promise.resolve();
        order.push('microphone');
        mediaRequestCount += 1;
        if (options.getUserMediaReject !== undefined) {
          throw options.getUserMediaReject;
        }
        if (options.deferUserMedia === true) {
          await deferredUserMedia;
        }
        return localStream;
      },
    },
    createPeerConnection(): RealtimePeerConnection {
      order.push('peer');
      return peer;
    },
    createRemoteMediaStream(): RealtimeMediaStream {
      return remoteStream;
    },
    createAudio(): RealtimeAudio {
      return audio;
    },
    createAbortController(): RealtimeAbortController {
      const controller = new CountingAbortController();
      abortControllers.push(controller);
      return controller;
    },
    scheduleTimeout(callback, milliseconds): () => void {
      timeoutCallbacks.add(callback);
      timeoutDelays.push(milliseconds);
      return () => { timeoutCallbacks.delete(callback); };
    },
    now: () => NOW,
    onStatus(status): void {
      statuses.push(status);
    },
    onCompletedExchange(exchange): Promise<void> | void {
      completed.push(exchange);
      return options.completedHandler?.(exchange);
    },
    onFailure(failure): void {
      failures.push(failure);
    },
    onInactiveCompletionFailure(failure): void {
      inactiveCompletionFailures.push(failure);
    },
    speakValidatedTranscript(transcript): void {
      if (options.speakReject !== undefined) {
        throw options.speakReject;
      }
      spoken.push(transcript);
    },
    cancelValidatedSpeech(): void {
      speechCancelCount += 1;
    },
  };

  return {
    abortControllers,
    audio,
    completed,
    controller: createRealtimeVoiceController(dependencies),
    failures,
    inactiveCompletionFailures,
    speechCancelCount: () => speechCancelCount,
    fetchCalls,
    localStream,
    localTrack,
    mediaRequestCount: () => mediaRequestCount,
    order,
    peer,
    remoteStream,
    statuses,
    spoken,
    timeoutDelays,
    expireConnection(): void {
      [...timeoutCallbacks].forEach((callback) => { callback(); });
    },
    resolveUserMedia(): void {
      resolveDeferredUserMedia?.();
    },
  };
}

export function startContext(): { threadId: ThreadId; turns: Turn[] } {
  return {
    threadId: ACTIVE_THREAD_ID,
    turns: [
      makeTurn({ id: 'turn-user', position: 0, role: 'user' }),
      makeTurn({ id: 'turn-assistant', position: 1, role: 'specular' }),
    ],
  };
}

export function emitProviderEvent(channel: FakeDataChannel, event: unknown): void {
  channel.emit('message', { data: JSON.stringify(event) });
}

export async function connect(
  harness: RealtimeClientHarness,
  context = startContext(),
): Promise<void> {
  await harness.controller.start(context);
  harness.peer.dataChannel.emit('open');
}
