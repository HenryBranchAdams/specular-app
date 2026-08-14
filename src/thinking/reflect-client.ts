import { z } from 'zod';
import {
  contextScopeSchema,
  reflectionMoveSchema,
  type ContextScope,
  type ReflectionMove,
} from './model';

export const reflectionResponseSchema = z.object({
  mirror: z.string().trim().min(1).max(600),
  directions: z.array(z.object({
    label: z.string().trim().min(1).max(80),
    prompt: z.string().trim().min(1).max(400),
    move: reflectionMoveSchema.exclude(['calibrate']),
  }).strict()).min(1).max(4),
  referencedBlockIds: z.array(z.string().min(1).max(128)).max(100),
  sources: z.array(z.object({
    title: z.string().trim().min(1).max(300),
    url: z.string().url().max(2_000),
    excerpt: z.string().trim().max(600),
  }).strict()).max(8),
}).strict();

export interface ReflectionContextBlock {
  id: string;
  content: string;
  kind: string;
}

export interface ReflectionRequest {
  focus: string;
  focusBlockId: string;
  move: ReflectionMove;
  scope: ContextScope;
  blocks: ReflectionContextBlock[];
  calibration?: string;
  priorMirror?: string;
}

export type ReflectionResponse = z.infer<typeof reflectionResponseSchema>;

export interface Reflector {
  reflect(input: ReflectionRequest): Promise<ReflectionResponse>;
}

export class HttpReflector implements Reflector {
  async reflect(input: ReflectionRequest): Promise<ReflectionResponse> {
    const request = {
      ...input,
      scope: contextScopeSchema.parse(input.scope),
      move: reflectionMoveSchema.parse(input.move),
    };
    const response = await fetch('/api/reflect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    const body = await response.json() as unknown;
    if (!response.ok) {
      throw new Error('Specular could not reflect on this passage right now. Your writing is safe.');
    }
    return reflectionResponseSchema.parse(body);
  }
}
