import { describe, expect, it, vi } from 'vitest';
import { HttpDictationService } from './client';

describe('HttpDictationService', () => {
  it('sends bounded audio to the same-origin transcription endpoint', async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response(JSON.stringify({ transcript: 'Spoken words.' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));
    const service = new HttpDictationService(fetcher);
    const audio = new Blob(['audio'], { type: 'audio/webm' });

    await expect(service.transcribe(audio)).resolves.toBe('Spoken words.');
    const call = fetcher.mock.calls[0];
    expect(call?.[0]).toBe('/api/dictation/transcribe');
    expect(call?.[1]?.method).toBe('POST');
    const body = call?.[1]?.body;
    if (!(body instanceof FormData)) throw new Error('Expected transcription form data.');
    const form = body;
    expect(form.get('audio')).toBeInstanceOf(Blob);
  });

  it('keeps faithful cleanup separate and reports service failures plainly', async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ cleaned: 'The clearer transcript.' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'provider_unavailable' }), { status: 503 }));
    const service = new HttpDictationService(fetcher);

    await expect(service.clean('Um, the clearer transcript.')).resolves.toBe('The clearer transcript.');
    const cleanupRequest = fetcher.mock.calls[0]?.[1];
    expect(cleanupRequest).toMatchObject({ method: 'POST' });
    const body = cleanupRequest?.body;
    if (typeof body !== 'string') throw new Error('Expected a JSON cleanup body.');
    expect(JSON.parse(body) as unknown).toEqual({ verbatim: 'Um, the clearer transcript.' });
    await expect(service.clean('Keep this verbatim.')).rejects.toThrow('cleanup unavailable');
  });

  it('aborts a stalled request instead of retaining an unbounded audio backlog', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((_input, init) => (
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => { reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
      })
    ));
    const pending = new HttpDictationService(fetcher).transcribe(new Blob(['audio'], { type: 'audio/webm' }));
    const rejection = expect(pending).rejects.toThrow('dictation request timed out');
    await vi.advanceTimersByTimeAsync(45_000);
    await rejection;
    vi.useRealTimers();
  });
});
