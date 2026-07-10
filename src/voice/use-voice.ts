import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type {
  Thread,
  ThreadId,
  Turn,
} from '../domain/contracts';
import {
  createRealtimeVoiceController,
  type CompletedRealtimeExchange,
  type RealtimeAudio,
  type RealtimeControllerDependencies,
  type RealtimeControllerStatus,
  type RealtimeFailure,
  type RealtimePeerConnection,
  type RealtimeVoiceController,
} from './realtime-client';

export type VoiceStatus =
  | 'unavailable'
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'failure';

export interface VoiceControllerCallbacks {
  onStatus: (status: RealtimeControllerStatus) => void;
  onCompletedExchange: (exchange: CompletedRealtimeExchange) => Promise<void>;
  onFailure: (failure: RealtimeFailure) => void;
  onInactiveCompletionFailure: (failure: RealtimeFailure) => void;
}

export type VoiceControllerFactory = (
  callbacks: VoiceControllerCallbacks,
) => RealtimeVoiceController;

export interface UseVoiceOptions {
  acceptExchange: (exchange: CompletedRealtimeExchange) => Promise<boolean>;
  controllerFactory?: VoiceControllerFactory;
  enabled: boolean;
  onFocusRequest: () => void;
  thread: Thread | null;
  turns: readonly Turn[];
}

export interface UseVoiceResult {
  error: string | null;
  start: () => void;
  status: VoiceStatus;
  stop: () => void;
}

interface CurrentVoiceInputs {
  acceptExchange: UseVoiceOptions['acceptExchange'];
  controllerFactory: VoiceControllerFactory | undefined;
  enabled: boolean;
  onFocusRequest: UseVoiceOptions['onFocusRequest'];
  thread: Thread | null;
  turns: readonly Turn[];
}

const START_FAILURE_MESSAGE = 'Voice is temporarily unavailable.';

interface OptionalNativeVoiceEnvironment {
  AbortController?: typeof globalThis.AbortController;
  Audio?: typeof globalThis.Audio;
  fetch?: typeof globalThis.fetch;
  MediaStream?: typeof globalThis.MediaStream;
  navigator?: {
    mediaDevices?: Pick<MediaDevices, 'getUserMedia'>;
  };
  RTCPeerConnection?: typeof globalThis.RTCPeerConnection;
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof globalThis.SpeechSynthesisUtterance;
}

function nativeVoiceSupported(): boolean {
  const environment = globalThis as unknown as OptionalNativeVoiceEnvironment;
  return typeof environment.fetch === 'function'
    && typeof environment.navigator?.mediaDevices?.getUserMedia === 'function'
    && typeof environment.RTCPeerConnection === 'function'
    && typeof environment.MediaStream === 'function'
    && typeof environment.Audio === 'function'
    && typeof environment.AbortController === 'function'
    && environment.speechSynthesis !== undefined
    && typeof environment.SpeechSynthesisUtterance === 'function';
}

function createNativeVoiceController(
  callbacks: VoiceControllerCallbacks,
): RealtimeVoiceController {
  const dependencies: RealtimeControllerDependencies = {
    fetch: (input, init) => globalThis.fetch(input, init),
    mediaDevices: {
      async getUserMedia(constraints) {
        const stream = await globalThis.navigator.mediaDevices.getUserMedia(constraints);
        return stream;
      },
    },
    createPeerConnection: () => (
      new globalThis.RTCPeerConnection() as unknown as RealtimePeerConnection
    ),
    createRemoteMediaStream: () => (
      new globalThis.MediaStream()
    ),
    createAudio: () => new globalThis.Audio() as unknown as RealtimeAudio,
    createAbortController: () => new globalThis.AbortController(),
    scheduleTimeout(callback, milliseconds) {
      const handle = globalThis.setTimeout(callback, milliseconds);
      return () => { globalThis.clearTimeout(handle); };
    },
    now: () => Date.now(),
    onStatus: (status) => { callbacks.onStatus(status); },
    onCompletedExchange: (exchange) => callbacks.onCompletedExchange(exchange),
    onFailure: (failure) => { callbacks.onFailure(failure); },
    onInactiveCompletionFailure: (failure) => { callbacks.onInactiveCompletionFailure(failure); },
    speakValidatedTranscript(transcript) {
      const environment = globalThis as unknown as OptionalNativeVoiceEnvironment;
      if (
        environment.speechSynthesis === undefined
        || environment.SpeechSynthesisUtterance === undefined
      ) {
        return;
      }
      environment.speechSynthesis.speak(new environment.SpeechSynthesisUtterance(transcript));
    },
    cancelValidatedSpeech() {
      const environment = globalThis as unknown as OptionalNativeVoiceEnvironment;
      environment.speechSynthesis?.cancel();
    },
  };
  return createRealtimeVoiceController(dependencies);
}

function acceptedTurnsForThread(
  threadId: ThreadId,
  turns: readonly Turn[],
): Turn[] {
  const turnsById = new Map<string, Turn>();
  turns.forEach((turn) => {
    if (
      turn.threadId === threadId
      && turn.deliveryState === 'accepted'
      && !turnsById.has(turn.id)
    ) {
      turnsById.set(turn.id, turn);
    }
  });
  return [...turnsById.values()].sort((first, second) => first.position - second.position);
}

function isActiveThread(thread: Thread | null): thread is Thread {
  return thread !== null && thread.lifecycleState === 'active';
}

export function useVoice({
  acceptExchange,
  controllerFactory,
  enabled,
  onFocusRequest,
  thread,
  turns,
}: UseVoiceOptions): UseVoiceResult {
  const inputsRef = useRef<CurrentVoiceInputs>({
    acceptExchange,
    controllerFactory,
    enabled,
    onFocusRequest,
    thread,
    turns,
  });
  inputsRef.current = {
    acceptExchange,
    controllerFactory,
    enabled,
    onFocusRequest,
    thread,
    turns,
  };

  const mountedRef = useRef(true);
  const controllerRef = useRef<RealtimeVoiceController | null>(null);
  const activeRef = useRef(false);
  const activeThreadIdRef = useRef<ThreadId | null>(null);
  const [controllerStatus, setControllerStatus] = useState<RealtimeControllerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const supported = controllerFactory !== undefined || nativeVoiceSupported();
  const available = enabled && supported && isActiveThread(thread);

  const stopController = useCallback((requestFocus: boolean, clearError: boolean): void => {
    const wasActive = activeRef.current;
    activeRef.current = false;
    activeThreadIdRef.current = null;
    if (wasActive) {
      controllerRef.current?.stop();
    }
    if (!mountedRef.current) {
      return;
    }
    setControllerStatus('idle');
    if (clearError) {
      setError(null);
    }
    if (requestFocus && wasActive) {
      inputsRef.current.onFocusRequest();
    }
  }, []);

  const ensureController = useCallback((): RealtimeVoiceController => {
    if (controllerRef.current !== null) {
      return controllerRef.current;
    }
    const callbacks: VoiceControllerCallbacks = {
      onStatus(nextStatus) {
        if (!mountedRef.current) {
          return;
        }
        if (nextStatus === 'idle') {
          activeRef.current = false;
          activeThreadIdRef.current = null;
        }
        setControllerStatus(nextStatus);
      },
      async onCompletedExchange(exchange) {
        const current = inputsRef.current;
        if (
          !isActiveThread(current.thread)
          || current.thread.id !== exchange.threadId
        ) {
          throw new Error('The voice exchange no longer belongs to the active thread.');
        }
        const accepted = await current.acceptExchange(exchange);
        if (!accepted) {
          throw new Error('The completed voice exchange could not be saved.');
        }
      },
      onFailure(failure) {
        activeRef.current = false;
        activeThreadIdRef.current = null;
        if (!mountedRef.current) {
          return;
        }
        setControllerStatus('idle');
        setError(failure.message);
        inputsRef.current.onFocusRequest();
      },
      onInactiveCompletionFailure(failure) {
        if (!mountedRef.current) {
          return;
        }
        setError(failure.message);
        if (!activeRef.current) {
          inputsRef.current.onFocusRequest();
        }
      },
    };
    const factory = inputsRef.current.controllerFactory ?? createNativeVoiceController;
    controllerRef.current = factory(callbacks);
    return controllerRef.current;
  }, []);

  const start = useCallback((): void => {
    const current = inputsRef.current;
    const currentSupported = current.controllerFactory !== undefined || nativeVoiceSupported();
    if (
      activeRef.current
      || !current.enabled
      || !currentSupported
      || !isActiveThread(current.thread)
    ) {
      return;
    }

    const activeThread = current.thread;
    const controller = ensureController();
    activeRef.current = true;
    activeThreadIdRef.current = activeThread.id;
    setError(null);
    setControllerStatus('connecting');
    void controller.start({
      threadId: activeThread.id,
      turns: acceptedTurnsForThread(activeThread.id, current.turns),
    }).catch(() => {
      if (!activeRef.current || activeThreadIdRef.current !== activeThread.id) {
        return;
      }
      controller.stop();
      activeRef.current = false;
      activeThreadIdRef.current = null;
      if (mountedRef.current) {
        setControllerStatus('idle');
        setError(START_FAILURE_MESSAGE);
        inputsRef.current.onFocusRequest();
      }
    });
  }, [ensureController]);

  const stop = useCallback((): void => {
    stopController(true, true);
  }, [stopController]);

  useEffect(() => {
    if (
      !available
      || (activeThreadIdRef.current !== null && activeThreadIdRef.current !== thread.id)
    ) {
      stopController(false, true);
    }
  }, [available, stopController, thread]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopController(false, false);
    };
  }, [stopController]);

  return {
    error,
    start,
    status: available
      ? activeRef.current ? controllerStatus : error === null ? controllerStatus : 'failure'
      : 'unavailable',
    stop,
  };
}
