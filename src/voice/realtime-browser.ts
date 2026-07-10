import type { ThreadId, Turn } from '../domain/contracts';

export type RealtimeControllerStatus = 'idle' | 'connecting' | 'listening';

export type RealtimeFailureCode =
  | 'completion_failed'
  | 'connection_failed'
  | 'credential_unavailable'
  | 'microphone_unavailable'
  | 'protocol_error'
  | 'realtime_error';

export interface RealtimeFailure {
  code: RealtimeFailureCode;
  message: string;
}

export interface CompletedRealtimeExchange {
  threadId: ThreadId;
  userTranscript: string;
  assistantTranscript: string;
}

export interface RealtimeStartContext {
  threadId: ThreadId;
  turns: readonly Turn[];
}

export interface RealtimeFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type RealtimeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<RealtimeFetchResponse>;

export interface RealtimeAbortController {
  readonly signal: AbortSignal;
  abort(): void;
}

export interface RealtimeMediaStreamTrack {
  stop(): void;
}

export interface RealtimeMediaStream {
  addTrack(track: RealtimeMediaStreamTrack): void;
  getTracks(): RealtimeMediaStreamTrack[];
}

interface RealtimeEventTarget {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

export interface RealtimeDataChannel extends RealtimeEventTarget {
  close(): void;
  send(data: string): void;
}

export interface RealtimePeerConnection extends RealtimeEventTarget {
  readonly connectionState: string;
  addTrack(track: RealtimeMediaStreamTrack, stream: RealtimeMediaStream): void;
  close(): void;
  createDataChannel(label: string): RealtimeDataChannel;
  createOffer(): Promise<{ sdp: string; type: 'offer' }>;
  setLocalDescription(description: { sdp: string; type: 'offer' }): Promise<void>;
  setRemoteDescription(description: { sdp: string; type: 'answer' }): Promise<void>;
}

export interface RealtimeAudio {
  autoplay: boolean;
  currentTime: number;
  srcObject: RealtimeMediaStream | null;
  pause(): void;
  play(): Promise<void> | void;
}

export interface RealtimeControllerDependencies {
  fetch: RealtimeFetch;
  mediaDevices: {
    getUserMedia(constraints: { audio: true }): Promise<RealtimeMediaStream>;
  };
  createPeerConnection(): RealtimePeerConnection;
  createRemoteMediaStream(): RealtimeMediaStream;
  createAudio(): RealtimeAudio;
  createAbortController(): RealtimeAbortController;
  scheduleTimeout(callback: () => void, milliseconds: number): () => void;
  now(): number;
  onStatus(status: RealtimeControllerStatus): void;
  onCompletedExchange(exchange: CompletedRealtimeExchange): Promise<void> | void;
  onFailure(failure: RealtimeFailure): void;
  onInactiveCompletionFailure(failure: RealtimeFailure): void;
  speakValidatedTranscript(transcript: string): Promise<void> | void;
  cancelValidatedSpeech(): void;
}

export interface RealtimeVoiceController {
  getStatus(): RealtimeControllerStatus;
  start(context: RealtimeStartContext): Promise<void>;
  stop(): void;
}

export interface RealtimeBrowserResources {
  abortController: RealtimeAbortController;
  audio?: RealtimeAudio;
  channel?: RealtimeDataChannel;
  cancelDeadline?: () => void;
  cleaned: boolean;
  listeners: (() => void)[];
  localStream?: RealtimeMediaStream;
  peer?: RealtimePeerConnection;
  remoteStream?: RealtimeMediaStream;
  remoteTracks: Set<RealtimeMediaStreamTrack>;
}

export function addRealtimeListener(
  resources: RealtimeBrowserResources,
  target: RealtimeEventTarget,
  type: string,
  listener: (event: unknown) => void,
): void {
  target.addEventListener(type, listener);
  resources.listeners.push(() => {
    target.removeEventListener(type, listener);
  });
}

export function realtimeEventData(event: unknown): unknown {
  if (typeof event !== 'object' || event === null || !('data' in event)) {
    return undefined;
  }
  return event.data;
}

export function realtimeEventTrack(event: unknown): RealtimeMediaStreamTrack | undefined {
  if (typeof event !== 'object' || event === null || !('track' in event)) {
    return undefined;
  }
  const track = event.track;
  return typeof track === 'object'
    && track !== null
    && 'stop' in track
    && typeof track.stop === 'function'
    ? track as RealtimeMediaStreamTrack
    : undefined;
}

export function releaseRealtimeResources(resources: RealtimeBrowserResources): boolean {
  if (resources.cleaned) {
    return false;
  }
  resources.cleaned = true;
  resources.cancelDeadline?.();
  delete resources.cancelDeadline;
  resources.abortController.abort();
  [...resources.listeners].reverse().forEach((remove) => {
    remove();
  });
  resources.listeners.length = 0;
  resources.channel?.close();

  const tracks = new Set<RealtimeMediaStreamTrack>([
    ...(resources.localStream?.getTracks() ?? []),
    ...resources.remoteTracks,
    ...(resources.remoteStream?.getTracks() ?? []),
  ]);
  tracks.forEach((track) => {
    track.stop();
  });
  resources.remoteTracks.clear();

  if (resources.audio !== undefined) {
    resources.audio.pause();
    resources.audio.currentTime = 0;
    resources.audio.srcObject = null;
  }
  resources.peer?.close();
  return true;
}
