import { z } from 'zod';

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
    form.set('audio', audio, `dictation.${audio.type.includes('ogg') ? 'ogg' : 'webm'}`);
    const response = await this.fetcher('/api/dictation/transcribe', { method: 'POST', body: form });
    if (!response.ok) throw new Error('Transcription unavailable. Your saved draft is safe.');
    return transcriptResponseSchema.parse(await response.json()).transcript;
  }

  async clean(verbatim: string): Promise<string> {
    const response = await this.fetcher('/api/dictation/cleanup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ verbatim }),
    });
    if (!response.ok) throw new Error('Faithful cleanup unavailable. You can keep the verbatim transcript.');
    return cleanupResponseSchema.parse(await response.json()).cleaned;
  }
}
