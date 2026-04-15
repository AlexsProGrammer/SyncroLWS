import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// ── base_entities ─────────────────────────────────────────────────────────────
/**
 * Central store for ALL domain objects within a profile.
 * The payload column holds module-specific JSON — validated at the app layer.
 * This keeps the DB schema stable across feature additions.
 */
export const baseEntities = sqliteTable('base_entities', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  payload: text('payload').notNull().default('{}'),
  metadata: text('metadata').notNull().default('{}'),
  tags: text('tags').notNull().default('[]'),
  parent_id: text('parent_id'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
  deleted_at: text('deleted_at'),
});

// ── local_files ──────────────────────────────────────────────────────────────
/**
 * Content-addressed local file reference store.
 * SHA-256 hash is the PK — deduplication at the DB level.
 */
export const localFiles = sqliteTable('local_files', {
  hash: text('hash').primaryKey(),
  local_path: text('local_path').notNull(),
  mime_type: text('mime_type').notNull().default('application/octet-stream'),
  size_bytes: integer('size_bytes').notNull(),
  reference_count: integer('reference_count').notNull().default(1),
  created_at: text('created_at').notNull(),
});

// ── active_tools (Phase 3 prep) ─────────────────────────────────────────────
/**
 * Tracks which tools are enabled for this profile.
 * Populated by the Settings UI in Phase 3.
 */
export const activeTools = sqliteTable('active_tools', {
  profile_id: text('profile_id').notNull(),
  tool_id: text('tool_id').notNull(),
  is_enabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
});
