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
 *
 * Phase F — Hybrid model only:
 *  - Shared "core" fields are real columns: title, description, color,
 *    icon, tags, parent_id. Aspect-specific data lives in `entity_aspects`.
 *  - The legacy `type` / `payload` / `metadata` columns were dropped in Phase F.
 */
export const baseEntities = sqliteTable('base_entities', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default(''),
  description: text('description').notNull().default(''),
  description_json: text('description_json'),
  color: text('color').notNull().default('#6366f1'),
  icon: text('icon').notNull().default('box'),
  tags: text('tags').notNull().default('[]'),
  parent_id: text('parent_id'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
  deleted_at: text('deleted_at'),
});

// ── entity_aspects ────────────────────────────────────────────────────────────
/**
 * One *personality* of a base entity (note / task / calendar_event / …).
 * A single base_entity row can have multiple aspects → "this is simultaneously
 * a note and a kanban card and a calendar event".
 *
 * Uniqueness:  (entity_id, aspect_type, tool_instance_id)
 *   tool_instance_id is the `workspace_tools.id` of the kanban board /
 *   calendar / etc. that scopes this aspect, or NULL for workspace-wide
 *   aspects (notes, habits, bookmarks).
 */
export const entityAspects = sqliteTable('entity_aspects', {
  id: text('id').primaryKey(),
  entity_id: text('entity_id').notNull(),
  aspect_type: text('aspect_type').notNull(),
  data: text('data').notNull().default('{}'),
  tool_instance_id: text('tool_instance_id'),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
  deleted_at: text('deleted_at'),
});

// ── entity_relations ──────────────────────────────────────────────────────────
/**
 * Soft links between distinct base entities (wiki-links, references, embeds).
 * Replaces the inline `linked_entity_id` / `linked_entity_ids` payload fields
 * once Phase E ships.
 */
export const entityRelations = sqliteTable('entity_relations', {
  id: text('id').primaryKey(),
  from_entity_id: text('from_entity_id').notNull(),
  to_entity_id: text('to_entity_id').notNull(),
  kind: text('kind').notNull(),
  metadata: text('metadata').notNull().default('{}'),
  created_at: text('created_at').notNull(),
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
