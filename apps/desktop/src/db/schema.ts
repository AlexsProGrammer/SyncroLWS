import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE-LEVEL TABLES (stored in profiles/<uuid>/data.sqlite)
// ═══════════════════════════════════════════════════════════════════════════════

// ── workspaces ────────────────────────────────────────────────────────────────
/**
 * Workspace metadata. Each workspace gets its own SQLite database.
 * parent_id enables nested folder structure for workspace organization.
 */
export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  icon: text('icon').notNull().default('folder'),
  color: text('color').notNull().default('#6366f1'),
  parent_id: text('parent_id'),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
  deleted_at: text('deleted_at'),
});

// ── active_tools ─────────────────────────────────────────────────────────────
/**
 * Tracks which tools are enabled for this profile.
 */
export const activeTools = sqliteTable('active_tools', {
  profile_id: text('profile_id').notNull(),
  tool_id: text('tool_id').notNull(),
  is_enabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
});

// ═══════════════════════════════════════════════════════════════════════════════
// WORKSPACE-LEVEL TABLES (stored in profiles/<uuid>/workspaces/<uuid>/data.sqlite)
// ═══════════════════════════════════════════════════════════════════════════════

// ── base_entities ─────────────────────────────────────────────────────────────
/**
 * Central store for ALL domain objects within a workspace.
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

// ── workspace_tools ──────────────────────────────────────────────────────────
/**
 * Tool instances within a workspace. A workspace can have multiple
 * instances of the same tool type (e.g. two Kanban boards).
 */
export const workspaceTools = sqliteTable('workspace_tools', {
  id: text('id').primaryKey(),
  tool_id: text('tool_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  config: text('config').notNull().default('{}'),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: text('created_at').notNull(),
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
