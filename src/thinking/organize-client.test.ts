import { describe, expect, it, vi } from 'vitest';
import { HttpOrganizer } from './organize-client';

describe('automatic organization client', () => {
  it('sends bounded authored blocks and validates the response', async () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      title: 'Attention without certainty',
      kinds: [{ id: 'block:one', kind: 'hypothesis' }],
    }), { status: 200 })));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher;
    try {
      const result = await new HttpOrganizer().organize({
        documentId: 'document:one',
        blocks: [{ id: 'block:one', content: 'Attention can matter without becoming proof.' }],
      });
      expect(result).toEqual({ title: 'Attention without certainty', kinds: [{ id: 'block:one', kind: 'hypothesis' }] });
      expect(fetcher).toHaveBeenCalledWith('/api/organize', expect.objectContaining({ method: 'POST' }));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
