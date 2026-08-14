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
