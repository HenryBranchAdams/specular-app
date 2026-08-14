import type { DictationService } from './client';
import type { DictationDraft } from '../thinking/model';

export type DictationInterruptionReason = NonNullable<DictationDraft['interruptionReason']>;

export interface DictationCaptureHandlers {
  onStarted: () => void;
  onTranscript: (transcript: string) => void;
  onInterrupted: (reason: DictationInterruptionReason) => void;
  onError: (message: string) => void;
}

export interface DictationController {
  start(handlers: DictationCaptureHandlers): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  finish(): Promise<void>;
  cancel(): void;
}

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

export interface BrowserDictationOptions {
  mediaDevices?: MediaDevices | undefined;
  MediaRecorderClass?: typeof MediaRecorder | undefined;
  document?: Document | undefined;
  window?: Window | undefined;
  wakeLock?: WakeLockLike | undefined;
  checkpointMs?: number | undefined;
}

export class BrowserDictationController implements DictationController {
  private handlers: DictationCaptureHandlers | null = null;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private checkpoint: number | null = null;
  private wakeLock: WakeLockSentinelLike | null = null;
  private transcriptionQueue: Promise<void> = Promise.resolve();
  private session = 0;
  private continuing = false;
  private readonly mediaDevices: MediaDevices | undefined;
  private readonly MediaRecorderClass: typeof MediaRecorder | undefined;
  private readonly ownerDocument: Document | undefined;
  private readonly ownerWindow: Window | undefined;
  private readonly wakeLockManager: WakeLockLike | undefined;
  private readonly checkpointMs: number;

  constructor(private readonly service: DictationService, options: BrowserDictationOptions = {}) {
    this.mediaDevices = options.mediaDevices ?? globalThis.navigator.mediaDevices;
    this.MediaRecorderClass = options.MediaRecorderClass ?? globalThis.MediaRecorder;
    this.ownerDocument = options.document ?? globalThis.document;
    this.ownerWindow = options.window ?? globalThis.window;
    this.wakeLockManager = options.wakeLock ?? (globalThis.navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
    this.checkpointMs = options.checkpointMs ?? 20_000;
  }

  async start(handlers: DictationCaptureHandlers): Promise<void> {
    this.handlers = handlers;
    if (this.mediaDevices === undefined || this.MediaRecorderClass === undefined) {
      handlers.onError('Microphone dictation is not supported in this browser.');
      return;
    }
    const session = ++this.session;
    try {
      const stream = await this.mediaDevices.getUserMedia({ audio: true });
      if (session !== this.session) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.stream = stream;
      this.installLifecycleListeners();
      for (const track of stream.getAudioTracks()) {
        track.addEventListener('ended', this.onTrackEnded, { once: true });
      }
      await this.requestWakeLock();
      this.startRecorder();
      handlers.onStarted();
    } catch (error) {
      if (session !== this.session) return;
      handlers.onError(this.microphoneError(error));
    }
  }

  async pause(): Promise<void> {
    await this.stopRecorder(false);
    this.stopStream();
    await this.releaseWakeLock();
  }

  async resume(): Promise<void> {
    const handlers = this.handlers;
    if (handlers === null) return;
    await this.start(handlers);
  }

  async finish(): Promise<void> {
    await this.stopRecorder(false);
    this.stopStream();
    await this.transcriptionQueue;
    await this.releaseWakeLock();
    this.removeLifecycleListeners();
  }

  cancel(): void {
    this.session += 1;
    this.handlers = null;
    this.continuing = false;
    this.clearCheckpoint();
    if (this.recorder?.state !== 'inactive') this.recorder?.stop();
    this.recorder = null;
    this.stopStream();
    void this.releaseWakeLock();
    this.removeLifecycleListeners();
  }

  private startRecorder(): void {
    if (this.stream === null || this.MediaRecorderClass === undefined || this.handlers === null) return;
    const RecorderClass = this.MediaRecorderClass;
    const preferredType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
      .find((type) => RecorderClass.isTypeSupported(type));
    const recorder = preferredType === undefined
      ? new RecorderClass(this.stream)
      : new RecorderClass(this.stream, { mimeType: preferredType });
    const chunks: Blob[] = [];
    recorder.addEventListener('dataavailable', (event: BlobEvent) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener('error', () => { this.interrupt('microphone_lost'); });
    recorder.addEventListener('stop', () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size > 0 && this.handlers !== null) this.queueTranscription(blob, this.session);
      if (this.continuing && this.handlers !== null && this.stream !== null) {
        this.continuing = false;
        this.startRecorder();
      }
    }, { once: true });
    this.recorder = recorder;
    recorder.start();
    this.checkpoint = this.ownerWindow?.setTimeout(() => { void this.stopRecorder(true); }, this.checkpointMs) ?? null;
  }

  private async stopRecorder(continueAfter: boolean): Promise<void> {
    this.clearCheckpoint();
    this.continuing = continueAfter;
    const recorder = this.recorder;
    if (recorder === null || recorder.state === 'inactive') {
      await this.transcriptionQueue;
      return;
    }
    await new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => { resolve(); }, { once: true });
      recorder.stop();
    });
    if (!continueAfter) await this.transcriptionQueue;
  }

  private queueTranscription(blob: Blob, session: number): void {
    this.transcriptionQueue = this.transcriptionQueue.then(async () => {
      try {
        const transcript = await this.service.transcribe(blob);
        if (session === this.session) this.handlers?.onTranscript(transcript);
      } catch (error) {
        if (session === this.session) {
          this.handlers?.onError(error instanceof Error ? error.message : 'Transcription failed.');
        }
      }
    });
  }

  private interrupt(reason: DictationInterruptionReason): void {
    if (this.handlers === null) return;
    const handlers = this.handlers;
    this.continuing = false;
    this.clearCheckpoint();
    handlers.onInterrupted(reason);
    void this.stopRecorder(false).finally(() => {
      this.stopStream();
      void this.releaseWakeLock();
      this.removeLifecycleListeners();
    });
  }

  private readonly onVisibility = () => {
    if (this.ownerDocument?.visibilityState === 'hidden') this.interrupt('backgrounded');
  };
  private readonly onOffline = () => { this.interrupt('connection_lost'); };
  private readonly onTrackEnded = () => { this.interrupt('microphone_lost'); };

  private installLifecycleListeners(): void {
    this.ownerDocument?.addEventListener('visibilitychange', this.onVisibility);
    this.ownerWindow?.addEventListener('offline', this.onOffline);
  }

  private removeLifecycleListeners(): void {
    this.ownerDocument?.removeEventListener('visibilitychange', this.onVisibility);
    this.ownerWindow?.removeEventListener('offline', this.onOffline);
  }

  private stopStream(): void {
    if (this.stream === null) return;
    for (const track of this.stream.getTracks()) track.stop();
    this.stream = null;
  }

  private clearCheckpoint(): void {
    if (this.checkpoint !== null) this.ownerWindow?.clearTimeout(this.checkpoint);
    this.checkpoint = null;
  }

  private async requestWakeLock(): Promise<void> {
    if (this.wakeLockManager === undefined || this.ownerDocument?.visibilityState === 'hidden') return;
    try { this.wakeLock = await this.wakeLockManager.request('screen'); } catch { this.wakeLock = null; }
  }

  private async releaseWakeLock(): Promise<void> {
    const wakeLock = this.wakeLock;
    this.wakeLock = null;
    try { await wakeLock?.release(); } catch { /* best effort */ }
  }

  private microphoneError(error: unknown): string {
    if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Microphone access was not allowed. Enable it in your browser settings to dictate.';
    if (error instanceof DOMException && error.name === 'NotFoundError') return 'No microphone was found.';
    if (error instanceof DOMException && error.name === 'NotReadableError') return 'The microphone is busy or unavailable.';
    return 'Specular could not start the microphone.';
  }
}
