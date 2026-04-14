import {
  pgTable,
  uuid,
  text,
  jsonb,
  integer,
  bigint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ── base_entities ─────────────────────────────────────────────────────────────
/**
 * Central store for all domain objects.
 * The payload column holds module-specific JSON validated by Zod on the
 * application layer — keeping the DB schema stable across feature additions.
 */
export const baseEntities = pgTable(
  'base_entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    // sql`` expressions produce valid DB-level DEFAULT clauses for drizzle-kit 0.31+
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
    parent_id: uuid('parent_id'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    typeIdx: index('base_entities_type_idx').on(t.type),
    parentIdx: index('base_entities_parent_idx').on(t.parent_id),
    deletedAtIdx: index('base_entities_deleted_at_idx').on(t.deleted_at),
  }),
);

// ── files ─────────────────────────────────────────────────────────────────────
/**
 * Content-addressed file store.
 * SHA-256 hash is the primary key — guarantees deduplication at the DB level.
 * reference_count drives lifecycle: file is deleted from MinIO when it hits 0.
 */
export const files = pgTable('files', {
  hash: text('hash').primaryKey(),           // SHA-256 hex string
  minio_path: text('minio_path').notNull(),  // bucket/object-key
  mime_type: text('mime_type').notNull().default('application/octet-stream'),
  size_bytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  reference_count: integer('reference_count').notNull().default(1),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type BaseEntityRow = typeof baseEntities.$inferSelect;
export type NewBaseEntityRow = typeof baseEntities.$inferInsert;
export type FileRow = typeof files.$inferSelect;
export type NewFileRow = typeof files.$inferInsert;
