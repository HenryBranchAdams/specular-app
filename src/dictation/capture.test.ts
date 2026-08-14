import { describe, expect, it, vi } from 'vitest';
import type { DictationService } from './client';
import { BrowserDictationController } from './capture';

function service(): DictationService {
  return { transcribe: vi.fn(), clean: vi.fn() };
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
    class FakeTrack extends EventTarget {
      stop = vi.fn();
    }
    const track = new FakeTrack();
    const stream = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream;
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
