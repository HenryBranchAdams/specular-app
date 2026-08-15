import { z } from 'zod';
import { reportIfAuthenticationLost } from '../auth/protected-fetch';

const transcriptResponseSchema = z.object({ transcript: z.string().max(40_000) }).strict();
const cleanupResponseSchema = z.object({ cleaned: z.string().max(40_000) }).strict();

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface DictationService {
  transcribe(audio: Blob): Promise<string>;
  clean(verbatim: string): Promise<string>;
}

export class HttpDictationService implements DictationService {
  constructor(private readonly fetcher: Fetcher = globalThis.fetch.bind(globalThis)) {}

  async transcribe(audio: Blob): Promise<string> {
    const form = new FormData();
    const extensionByMime: Readonly<Record<string, string>> = {
      'audio/flac': 'flac',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'mp4',
      'audio/ogg': 'ogg',
      'audio/wav': 'wav',
      'audio/webm': 'webm',
      'audio/x-m4a': 'm4a',
    };
    const extension = extensionByMime[audio.type.split(';', 1)[0]?.toLowerCase() ?? ''] ?? 'webm';
    form.set('audio', audio, `dictation.${extension}`);
    const response = await this.fetchWithTimeout('/api/dictation/transcribe', {
      method: 'POST',
      headers: { 'x-specular-intent': 'mutate' },
      body: form,
    });
    if (!response.ok) throw new Error('Transcription unavailable. Your saved draft is safe.');
    return transcriptResponseSchema.parse(await response.json()).transcript;
  }

  async clean(verbatim: string): Promise<string> {
    const response = await this.fetchWithTimeout('/api/dictation/cleanup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-specular-intent': 'mutate' },
      body: JSON.stringify({ verbatim }),
    });
    if (!response.ok) throw new Error('Faithful cleanup unavailable. You can keep the verbatim transcript.');
    return cleanupResponseSchema.parse(await response.json()).cleaned;
  }

  private async fetchWithTimeout(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => { controller.abort(); }, 45_000);
    try {
      return reportIfAuthenticationLost(await this.fetcher(input, { ...init, signal: controller.signal }));
    } catch (error) {
      if (controller.signal.aborted) throw new Error('The dictation request timed out. Your checkpointed text remains in the draft.', { cause: error });
      throw error;
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }
}
