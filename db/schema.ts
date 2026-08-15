import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const authorWorkspaces = sqliteTable('author_workspaces', {
  tenantId: text('tenant_id').primaryKey(),
  cacheNamespace: text('cache_namespace').notNull().unique(),
  revision: integer('revision').notNull(),
  state: text('state').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const workspaceMutations = sqliteTable('workspace_mutations', {
  tenantId: text('tenant_id').notNull(),
  mutationId: text('mutation_id').notNull(),
  revision: integer('revision').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => [primaryKey({ columns: [table.tenantId, table.mutationId] })]);

export const inferenceDailyUsage = sqliteTable('inference_daily_usage', {
  usageDay: text('usage_day').primaryKey(),
  globalCount: integer('global_count').notNull(),
  tenantCounts: text('tenant_counts').notNull(),
});

export const publishedSnapshotsV2 = sqliteTable('published_snapshots_v2', {
  slug: text('slug').primaryKey(),
  ownerId: text('owner_id').notNull(),
  payload: text('payload').notNull(),
  createdAt: integer('created_at').notNull(),
  revokedAt: integer('revoked_at'),
});
