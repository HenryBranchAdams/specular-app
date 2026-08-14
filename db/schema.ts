import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const publishedSnapshots = sqliteTable('published_snapshots', {
  slug: text('slug').primaryKey(),
  payload: text('payload').notNull(),
  createdAt: integer('created_at').notNull(),
});
