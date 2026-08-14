import { z } from 'zod';

export const thoughtKindSchema = z.enum([
  'thought',
  'question',
  'definition',
  'hypothesis',
  'reference',
]);
export const thoughtStatusSchema = z.enum(['active', 'resting', 'closed']);
export const relationshipSchema = z.enum([
  'branches_from',
  'develops',
  'supports',
  'tensions_with',
  'revises',
]);
export const contextScopeSchema = z.enum([
  'selection',
  'connections',
  'document',
  'workspace',
]);
export const reflectionMoveSchema = z.enum([
  'reflect',
  'clarify',
  'distinguish',
  'challenge',
  'implications',
  'perspective',
  'check_premise',
  'calibrate',
]);

const blockVersionSchema = z.object({
  content: z.string().max(40_000),
  createdAt: z.number().int().nonnegative(),
}).strict();

export const sourceReferenceSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().trim().max(300),
  author: z.string().trim().max(200),
  url: z.string().url().max(2_000).or(z.literal('')),
  excerpt: z.string().trim().max(2_000),
  accessedAt: z.number().int().nonnegative(),
}).strict();

export const thoughtBlockSchema = z.object({
  id: z.string().min(1).max(128),
  documentId: z.string().min(1).max(128),
  parentId: z.string().min(1).max(128).nullable(),
  originPrompt: z.string().trim().max(400).nullable().default(null),
  content: z.string().max(40_000),
  kind: thoughtKindSchema,
  status: thoughtStatusSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  versions: z.array(blockVersionSchema).max(500),
  references: z.array(sourceReferenceSchema).max(50),
}).strict();

export const thoughtDocumentSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().max(300),
  status: thoughtStatusSchema,
  blockIds: z.array(z.string().min(1).max(128)).max(5_000),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();

export const connectionSchema = z.object({
  id: z.string().min(1).max(128),
  fromBlockId: z.string().min(1).max(128),
  toBlockId: z.string().min(1).max(128),
  relationship: relationshipSchema,
  createdAt: z.number().int().nonnegative(),
}).strict();

const reflectionDirectionSchema = z.object({
  label: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(400),
  move: reflectionMoveSchema.exclude(['calibrate']),
}).strict();

const calibrationTurnSchema = z.object({
  role: z.enum(['user', 'specular']),
  content: z.string().trim().min(1).max(2_000),
  createdAt: z.number().int().nonnegative(),
}).strict();

export const marginAnnotationSchema = z.object({
  id: z.string().min(1).max(128),
  documentId: z.string().min(1).max(128),
  blockId: z.string().min(1).max(128),
  focus: z.string().trim().min(1).max(12_000),
  move: reflectionMoveSchema.exclude(['calibrate']),
  mirror: z.string().trim().min(1).max(600),
  directions: z.array(reflectionDirectionSchema).min(1).max(4),
  referencedBlockIds: z.array(z.string().min(1).max(128)).max(100),
  sources: z.array(z.object({
    title: z.string().trim().min(1).max(300),
    url: z.string().url().max(2_000),
    excerpt: z.string().trim().max(600),
  }).strict()).max(8),
  calibration: z.array(calibrationTurnSchema).max(100),
  status: z.enum(['open', 'followed', 'dismissed', 'saved']),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();

export const thoughtSnapshotSchema = z.object({
  id: z.string().min(1).max(128),
  documentId: z.string().min(1).max(128),
  title: z.string().trim().min(1).max(300),
  blockIds: z.array(z.string().min(1).max(128)).min(1).max(5_000),
  createdAt: z.number().int().nonnegative(),
  publishedUrl: z.string().url().max(2_000).nullable(),
}).strict();

export const workspaceStateSchema = z.object({
  version: z.literal(1),
  activeDocumentId: z.string().min(1).max(128),
  documents: z.array(thoughtDocumentSchema).min(1).max(1_000),
  blocks: z.array(thoughtBlockSchema).max(50_000),
  connections: z.array(connectionSchema).max(100_000),
  annotations: z.array(marginAnnotationSchema).max(20_000),
  snapshots: z.array(thoughtSnapshotSchema).max(10_000),
  settings: z.object({
    contextScope: contextScopeSchema,
    dormancyDays: z.number().int().min(1).max(365),
  }).strict(),
}).strict();

export type ThoughtKind = z.infer<typeof thoughtKindSchema>;
export type ThoughtStatus = z.infer<typeof thoughtStatusSchema>;
export type Relationship = z.infer<typeof relationshipSchema>;
export type ContextScope = z.infer<typeof contextScopeSchema>;
export type ReflectionMove = z.infer<typeof reflectionMoveSchema>;
export type SourceReference = z.infer<typeof sourceReferenceSchema>;
export type ThoughtBlock = z.infer<typeof thoughtBlockSchema>;
export type ThoughtDocument = z.infer<typeof thoughtDocumentSchema>;
export type Connection = z.infer<typeof connectionSchema>;
export type ReflectionDirection = z.infer<typeof reflectionDirectionSchema>;
export type MarginAnnotation = z.infer<typeof marginAnnotationSchema>;
export type ThoughtSnapshot = z.infer<typeof thoughtSnapshotSchema>;
export type WorkspaceState = z.infer<typeof workspaceStateSchema>;

export function newId(prefix: string): string {
  return `${prefix}:${globalThis.crypto.randomUUID()}`;
}

export function createInitialWorkspace(now = Date.now()): WorkspaceState {
  const documentId = newId('document');
  const blockId = newId('block');
  return workspaceStateSchema.parse({
    version: 1,
    activeDocumentId: documentId,
    documents: [{
      id: documentId,
      title: '',
      status: 'active',
      blockIds: [blockId],
      createdAt: now,
      updatedAt: now,
    }],
    blocks: [{
      id: blockId,
      documentId,
      parentId: null,
      originPrompt: null,
      content: '',
      kind: 'thought',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      versions: [],
      references: [],
    }],
    connections: [],
    annotations: [],
    snapshots: [],
    settings: {
      contextScope: 'document',
      dormancyDays: 14,
    },
  });
}

export function effectiveStatus(
  updatedAt: number,
  status: ThoughtStatus,
  dormancyDays: number,
  now = Date.now(),
): ThoughtStatus | 'dormant' {
  if (status !== 'active') {
    return status;
  }
  const elapsed = now - updatedAt;
  return elapsed >= dormancyDays * 24 * 60 * 60 * 1_000 ? 'dormant' : 'active';
}
