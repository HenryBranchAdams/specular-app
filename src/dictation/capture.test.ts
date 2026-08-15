import { describe, expect, it, vi } from 'vitest';
import type { DictationService } from './client';
import { BrowserDictationController } from './capture';

function service(): DictationService {
  return { transcribe: vi.fn(), clean: vi.fn() };
}

class FakeTrack extends EventTarget {
  stop = vi.fn();
}

class FakeRecorder extends EventTarget {
  static isTypeSupported() { return false; }
  readonly mimeType = 'audio/webm';
  state: RecordingState = 'inactive';
  start() { this.state = 'recording'; }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    const data = new Event('dataavailable');
    Object.defineProperty(data, 'data', { value: new Blob(['audio'], { type: 'audio/webm' }) });
    this.dispatchEvent(data);
    this.dispatchEvent(new Event('stop'));
  }
}

function captureHarness(overrides: Partial<DictationService> = {}) {
  const track = new FakeTrack();
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  const ownerDocument = new EventTarget() as Document;
  Object.defineProperty(ownerDocument, 'visibilityState', { configurable: true, value: 'visible' });
  const ownerWindow = new EventTarget() as Window;
  Object.defineProperties(ownerWindow, {
    setTimeout: { value: globalThis.setTimeout.bind(globalThis) },
    clearTimeout: { value: globalThis.clearTimeout.bind(globalThis) },
  });
  const dictationService: DictationService = {
    transcribe: vi.fn(() => Promise.resolve('checkpoint text')),
    clean: vi.fn(),
    ...overrides,
  };
  const controller = new BrowserDictationController(dictationService, {
    mediaDevices: { getUserMedia: vi.fn(() => Promise.resolve(stream)) } as unknown as MediaDevices,
    MediaRecorderClass: FakeRecorder as unknown as typeof MediaRecorder,
    document: ownerDocument,
    window: ownerWindow,
    checkpointMs: 60_000,
  });
  const handlers = {
    onStarted: vi.fn(),
    onTranscript: vi.fn(),
    onInterrupted: vi.fn(),
    onError: vi.fn(),
  };
  return { controller, handlers, ownerDocument, ownerWindow, track };
}

describe('BrowserDictationController', () => {
  it('reports unsupported capture without pretending to record', async () => {
    const onError = vi.fn();
    const controller = new BrowserDictationController(service(), {
      mediaDevices: undefined,
      MediaRecorderClass: undefined,
    });

    await controller.start({ onStarted: vi.fn(), onTranscript: vi.fn(), onInterrupted: vi.fn(), onError });
    expect(onError).toHaveBeenCalledWith('Microphone dictation is not supported in this browser.');
  });

  it('stops the replacement recorder when a periodic checkpoint transcription fails', async () => {
    const track = new FakeTrack();
    const stream = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream;
    const onInterrupted = vi.fn();
    const onError = vi.fn();
    const controller = new BrowserDictationController({
      transcribe: vi.fn(() => Promise.reject(new Error('checkpoint failed'))),
      clean: vi.fn(),
    }, {
      mediaDevices: { getUserMedia: vi.fn(() => Promise.resolve(stream)) } as unknown as MediaDevices,
      MediaRecorderClass: FakeRecorder as unknown as typeof MediaRecorder,
      checkpointMs: 1,
    });

    await controller.start({ onStarted: vi.fn(), onTranscript: vi.fn(), onInterrupted, onError });
    await new Promise((resolve) => { globalThis.setTimeout(resolve, 20); });

    expect(onInterrupted).toHaveBeenCalledWith('transcription_failure');
    expect(onError).toHaveBeenCalledWith('checkpoint failed');
    expect(track.stop).toHaveBeenCalled();
    controller.cancel();
  });

  it.each([
    ['backgrounded', (harness: ReturnType<typeof captureHarness>) => {
      Object.defineProperty(harness.ownerDocument, 'visibilityState', { configurable: true, value: 'hidden' });
      harness.ownerDocument.dispatchEvent(new Event('visibilitychange'));
    }],
    ['connection_lost', (harness: ReturnType<typeof captureHarness>) => {
      harness.ownerWindow.dispatchEvent(new Event('offline'));
    }],
    ['microphone_lost', (harness: ReturnType<typeof captureHarness>) => {
      harness.track.dispatchEvent(new Event('ended'));
    }],
  ] as const)('stops capture and reports %s when the browser lifecycle interrupts it', async (reason, interrupt) => {
    const harness = captureHarness();
    await harness.controller.start(harness.handlers);

    interrupt(harness);
    await Promise.resolve();

    expect(harness.handlers.onInterrupted).toHaveBeenCalledWith(reason);
    expect(harness.track.stop).toHaveBeenCalled();
    harness.controller.cancel();
  });

  it('ignores a late transcript after the author cancels capture', async () => {
    let resolveTranscript: ((value: string) => void) | undefined;
    const harness = captureHarness({
      transcribe: vi.fn(() => new Promise<string>((resolve) => { resolveTranscript = resolve; })),
    });
    await harness.controller.start(harness.handlers);
    const finishing = harness.controller.finish();
    await vi.waitFor(() => { expect(resolveTranscript).toBeTypeOf('function'); });

    harness.controller.cancel();
    resolveTranscript?.('text from a cancelled session');
    await finishing;

    expect(harness.handlers.onTranscript).not.toHaveBeenCalled();
  });

  it('delivers an empty provider result before finish resolves', async () => {
    const harness = captureHarness({ transcribe: vi.fn(() => Promise.resolve('')) });
    await harness.controller.start(harness.handlers);

    await harness.controller.finish();

    expect(harness.handlers.onTranscript).toHaveBeenCalledWith('');
  });

  it('turns ignored microphone permission into an explicit cancellable request state', async () => {
    let resolvePermission: ((stream: MediaStream) => void) | undefined;
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => { resolvePermission = resolve; }));
    const onError = vi.fn();
    const controller = new BrowserDictationController(service(), {
      mediaDevices: { getUserMedia } as unknown as MediaDevices,
      MediaRecorderClass: function FakeMediaRecorder() { throw new Error('not instantiated'); } as unknown as typeof MediaRecorder,
    });

    const starting = controller.start({ onStarted: vi.fn(), onTranscript: vi.fn(), onInterrupted: vi.fn(), onError });
    controller.cancel();
    resolvePermission?.({ getTracks: () => [] } as unknown as MediaStream);
    await starting;

    expect(onError).not.toHaveBeenCalled();
  });
});
