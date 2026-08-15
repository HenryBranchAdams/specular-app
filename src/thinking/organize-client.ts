import { z } from 'zod';
import { protectedFetch } from '../auth/protected-fetch';
import { thoughtKindSchema, type ThoughtKind } from './model';

const organizationResponseSchema = z.object({
  title: z.string().trim().min(1).max(80),
  kinds: z.array(z.object({
    id: z.string().min(1).max(128),
    kind: thoughtKindSchema,
  }).strict()).max(200),
}).strict();

export interface OrganizationBlock {
  id: string;
  content: string;
}

export interface OrganizationRequest {
  documentId: string;
  blocks: OrganizationBlock[];
}

export interface OrganizationResult {
  title: string;
  kinds: { id: string; kind: ThoughtKind }[];
}

export interface Organizer {
  organize(input: OrganizationRequest): Promise<OrganizationResult>;
}

export class HttpOrganizer implements Organizer {
  async organize(input: OrganizationRequest): Promise<OrganizationResult> {
    const response = await protectedFetch('/api/organize', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-specular-intent': 'mutate' },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error('Automatic organization is temporarily unavailable.');
    return organizationResponseSchema.parse(await response.json());
  }
}
