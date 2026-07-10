import {
  act,
  renderHook,
} from '@testing-library/react';
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type {
  RealtimeFailure,
  RealtimeStartContext,
  RealtimeVoiceController,
} from './realtime-client';
import {
  threadIdSchema,
  threadSchema,
  turnSchema,
} from '../domain/schemas';
import type { Turn } from '../domain/contracts';
import {
  useVoice,
  type VoiceControllerCallbacks,
  type VoiceControllerFactory,
} from './use-voice';

const THREAD_ID = threadIdSchema.parse('thread-voice-hook');
const THREAD = threadSchema.parse({
  id: THREAD_ID,
  ownerScope: 'local',
  title: 'Voice hook',
  lifecycleState: 'active',
  createdAt: 1,
  updatedAt: 2,
  turnIds: [],
  understanding: {
    claims: [],
    observations: [],
    stakeholders: [],
    contexts: [],
    distinctions: [],
    tensions: [],
    exploredBlindSpots: [],
    unexploredBlindSpots: [],
  },
});

const OTHER_THREAD = threadSchema.parse({
  ...THREAD,
  id: threadIdSchema.parse('thread-voice-hook-other'),
  title: 'Other voice hook',
});

function turn(options: {
  deliveryState?: Turn['deliveryState'];
  id: string;
  position: number;
  threadId?: string;
}): Turn {
  return turnSchema.parse({
    id: options.id,
    ownerScope: 'local',
    threadId: options.threadId ?? THREAD_ID,
    role: options.position % 2 === 0 ? 'user' : 'specular',
    content: `Turn ${String(options.position)}`,
    modality: 'text',
    createdAt: options.position + 1,
    position: options.position,
    operation: 'next_question',
    deliveryState: options.deliveryState ?? 'accepted',
  });
}

interface ControllerHarness {
  callbacks: VoiceControllerCallbacks | null;
  controller: RealtimeVoiceController;
  factory: VoiceControllerFactory;
  start: ReturnType<typeof vi.fn<(context: RealtimeStartContext) => Promise<void>>>;
  stop: ReturnType<typeof vi.fn<() => void>>;
}

function createControllerHarness(): ControllerHarness {
  let callbacks: VoiceControllerCallbacks | null = null;
  const start = vi.fn<(context: RealtimeStartContext) => Promise<void>>(() => Promise.resolve());
  const stop = vi.fn<() => void>();
  const controller: RealtimeVoiceController = {
    getStatus: () => 'idle',
    start,
    stop,
  };
  const factory = vi.fn<VoiceControllerFactory>((nextCallbacks) => {
    callbacks = nextCallbacks;
    return controller;
  });
  return {
    get callbacks() {
      return callbacks;
    },
    controller,
    factory,
    start,
    stop,
  };
}

describe('useVoice', () => {
  it('starts only on explicit activation with current accepted turns from the active thread', async () => {
    const harness = createControllerHarness();
    const acceptExchange = vi.fn(() => Promise.resolve(true));
    const turns = [
      turn({ id: 'turn-accepted-2', position: 2 }),
      turn({ id: 'turn-pending', position: 3, deliveryState: 'pending' }),
      turn({ id: 'turn-accepted-0', position: 0 }),
      turn({ id: 'turn-other', position: 1, threadId: 'thread-other' }),
    ];
    const { result } = renderHook(() => useVoice({
      acceptExchange,
      controllerFactory: harness.factory,
      enabled: true,
      onFocusRequest: vi.fn(),
      thread: THREAD,
      turns,
    }));

    expect(result.current.status).toBe('idle');
    expect(harness.factory).not.toHaveBeenCalled();
    expect(harness.start).not.toHaveBeenCalled();

    await act(async () => {
      result.current.start();
      await Promise.resolve();
    });

    expect(harness.factory).toHaveBeenCalledOnce();
    expect(harness.start).toHaveBeenCalledWith({
      threadId: THREAD_ID,
      turns: [turns[2], turns[0]],
    });
    act(() => {
      harness.callbacks?.onStatus('listening');
    });
    expect(result.current.status).toBe('listening');
  });

  it('stops one active controller exactly once across repeated stop and unmount', async () => {
    const harness = createControllerHarness();
    const focus = vi.fn();
    const { result, unmount } = renderHook(() => useVoice({
      acceptExchange: () => Promise.resolve(true),
      controllerFactory: harness.factory,
      enabled: true,
      onFocusRequest: focus,
      thread: THREAD,
      turns: [],
    }));
    await act(async () => {
      result.current.start();
      await Promise.resolve();
    });

    act(() => {
      result.current.stop();
      result.current.stop();
    });
    unmount();

    expect(harness.stop).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });

  it('surfaces safe controller and persistence failures and requests focus restoration', async () => {
    const harness = createControllerHarness();
    const focus = vi.fn();
    const acceptExchange = vi.fn(() => Promise.resolve(false));
    const { result } = renderHook(() => useVoice({
      acceptExchange,
      controllerFactory: harness.factory,
      enabled: true,
      onFocusRequest: focus,
      thread: THREAD,
      turns: [],
    }));
    await act(async () => {
      result.current.start();
      await Promise.resolve();
    });
    const exchange = {
      threadId: THREAD_ID,
      userTranscript: 'The handoff keeps getting lost.',
      assistantTranscript: 'Which handoff owner needs the clearest signal first?',
    };

    await expect(harness.callbacks?.onCompletedExchange(exchange)).rejects.toThrow();
    const failure: RealtimeFailure = {
      code: 'completion_failed',
      message: 'The completed voice exchange could not be saved.',
    };
    act(() => {
      harness.callbacks?.onStatus('idle');
      harness.callbacks?.onFailure(failure);
    });

    expect(acceptExchange).toHaveBeenCalledWith(exchange);
    expect(result.current.status).toBe('failure');
    expect(result.current.error).toBe(failure.message);
    expect(focus).toHaveBeenCalledOnce();
  });

  it('keeps disabled or threadless voice unavailable without creating a controller', () => {
    const disabled = createControllerHarness();
    const threadless = createControllerHarness();
    const { result: disabledResult } = renderHook(() => useVoice({
      acceptExchange: () => Promise.resolve(true),
      controllerFactory: disabled.factory,
      enabled: false,
      onFocusRequest: vi.fn(),
      thread: THREAD,
      turns: [],
    }));
    const { result: threadlessResult } = renderHook(() => useVoice({
      acceptExchange: () => Promise.resolve(true),
      controllerFactory: threadless.factory,
      enabled: true,
      onFocusRequest: vi.fn(),
      thread: null,
      turns: [],
    }));

    act(() => {
      disabledResult.current.start();
      threadlessResult.current.start();
    });

    expect(disabledResult.current.status).toBe('unavailable');
    expect(threadlessResult.current.status).toBe('unavailable');
    expect(disabled.factory).not.toHaveBeenCalled();
    expect(threadless.factory).not.toHaveBeenCalled();
  });

  it('stops a superseded thread and rejects its late completion without double cleanup', async () => {
    const harness = createControllerHarness();
    const acceptExchange = vi.fn(() => Promise.resolve(true));
    const { result, rerender, unmount } = renderHook(
      ({ currentThread }) => useVoice({
        acceptExchange,
        controllerFactory: harness.factory,
        enabled: true,
        onFocusRequest: vi.fn(),
        thread: currentThread,
        turns: [],
      }),
      { initialProps: { currentThread: THREAD } },
    );
    await act(async () => {
      result.current.start();
      await Promise.resolve();
    });
    const callbacks = harness.callbacks;
    if (callbacks === null) {
      throw new Error('Voice controller callbacks were not registered.');
    }

    rerender({ currentThread: OTHER_THREAD });
    await expect(callbacks.onCompletedExchange({
      threadId: THREAD_ID,
      userTranscript: 'This belongs to the old thread.',
      assistantTranscript: 'It must not cross into the new thread.',
    })).rejects.toThrow('no longer belongs');
    unmount();

    expect(acceptExchange).not.toHaveBeenCalled();
    expect(harness.stop).toHaveBeenCalledOnce();
  });
});
