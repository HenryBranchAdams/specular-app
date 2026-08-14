import type { SourceReference } from './model';

export interface PublishedBlock {
  id: string;
  content: string;
  kind: string;
  references: SourceReference[];
}

export interface PublishedSnapshot {
  title: string;
  createdAt: number;
  blocks: PublishedBlock[];
}

export interface SharePublisher {
  publish(snapshot: PublishedSnapshot): Promise<{ url: string }>;
}

export class HttpSharePublisher implements SharePublisher {
  async publish(snapshot: PublishedSnapshot): Promise<{ url: string }> {
    const response = await fetch('/api/shares', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    const body = await response.json() as { url?: unknown };
    if (!response.ok || typeof body.url !== 'string') {
      throw new Error('Specular could not publish this snapshot.');
    }
    return { url: new URL(body.url, globalThis.location.origin).toString() };
  }
}

export async function loadPublishedSnapshot(slug: string): Promise<PublishedSnapshot> {
  const response = await fetch(`/api/shares/${encodeURIComponent(slug)}`);
  const body = await response.json() as unknown;
  if (!response.ok || typeof body !== 'object' || body === null) {
    throw new Error('This snapshot is unavailable.');
  }
  return body as PublishedSnapshot;
}
