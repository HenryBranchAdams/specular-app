import type { SourceReference } from './model';
import { protectedFetch } from '../auth/protected-fetch';

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

export interface HostedSnapshotSummary {
  slug: string;
  title: string;
  createdAt: number;
  revokedAt: number | null;
}

export interface SharePublisher {
  publish(snapshot: PublishedSnapshot): Promise<{ url: string }>;
}

export class HttpSharePublisher implements SharePublisher {
  async publish(snapshot: PublishedSnapshot): Promise<{ url: string }> {
    const response = await protectedFetch('/api/shares', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-specular-intent': 'mutate' },
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
  const response = await protectedFetch(`/api/shares/${encodeURIComponent(slug)}`);
  const body = await response.json() as unknown;
  if (!response.ok || typeof body !== 'object' || body === null) {
    throw new Error('This snapshot is unavailable.');
  }
  return body as PublishedSnapshot;
}

export async function revokePublishedSnapshot(url: string): Promise<void> {
  const slug = /^\/s\/([a-z0-9]{16})$/u.exec(new URL(url, globalThis.location.origin).pathname)?.[1];
  if (slug === undefined) throw new Error('This published link cannot be revoked.');
  await revokeHostedSnapshot(slug);
}

export async function listPublishedSnapshots(): Promise<HostedSnapshotSummary[]> {
  const response = await protectedFetch('/api/shares');
  const body = await response.json() as { snapshots?: unknown };
  if (!response.ok || !Array.isArray(body.snapshots)) throw new Error('Specular could not load your published links.');
  return body.snapshots.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.slug !== 'string' || typeof candidate.title !== 'string' || typeof candidate.createdAt !== 'number') return [];
    return [{
      slug: candidate.slug,
      title: candidate.title,
      createdAt: candidate.createdAt,
      revokedAt: typeof candidate.revokedAt === 'number' ? candidate.revokedAt : null,
    }];
  });
}

export async function revokeHostedSnapshot(slug: string): Promise<void> {
  if (!/^[a-z0-9]{16}$/u.test(slug)) throw new Error('This published link cannot be revoked.');
  const response = await protectedFetch(`/api/shares/${slug}`, {
    method: 'DELETE',
    headers: { 'x-specular-intent': 'mutate' },
  });
  if (!response.ok) throw new Error('Specular could not revoke this published link.');
}
