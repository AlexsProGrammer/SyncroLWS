import {
  pgTable,
  uuid,
  text,
  jsonb,
  integer,
  bigint,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ── global revision sequence ─────────────────────────────────────────────────
// All sync-tracked tables share a single monotonically increasing sequence so
// that `sync.pull(since_revision)` is a deterministic cursor across tables.
// The sequence itself is created in the migration SQL; this declaration is
// only consumed via `sql\`nextval('sync_revision')\`` in INSERT/UPDATE.

const SCOPE_INDEX = (name: string) =>
  index(name);

// ── base_entities (Phase I — hybrid, replaces legacy type/payload model) ────
export const baseEntities = pgTable(
  'base_entities',
  {
    id: uuid('id').primaryKey(),
    profile_id: text('profile_id').notNull(),
    workspace_id: text('workspace_id').notNull(),
    title: text('title').notNull().default(''),
    description: text('description').notNull().default(''),
    description_json: text('description_json'),
    color: text('color').notNull().default('#6366f1'),
    icon: text('icon').notNull().default('box'),
    tags: jsonb('tags').notNull().default(sql`'[]'::jsonb`),
    parent_id: uuid('parent_id'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
    revision: bigint('revision', { mode: 'number' }).notNull(),
    last_modified_by_device: uuid('last_modified_by_device'),
  },
  (t) => ({
    scopeIdx: SCOPE_INDEX('base_entities_scope_idx').on(t.profile_id, t.workspace_id),
    revisionIdx: index('base_entities_revision_idx').on(t.revision),
    parentIdx: index('base_entities_parent_idx').on(t.parent_id),
  }),
);

// ── entity_aspects ───────────────────────────────────────────────────────────
export const entityAspects = pgTable(
  'entity_aspects',
  {
    id: uuid('id').primaryKey(),
    entity_id: uuid('entity_id').notNull(),
    profile_id: text('profile_id').notNull(),
    workspace_id: text('workspace_id').notNull(),
    aspect_type: text('aspect_type').notNull(),
    data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
    tool_instance_id: text('tool_instance_id'),
    sort_order: integer('sort_order').notNull().default(0),
    created_at: timestamp('created_at', { withTimezone: true }).notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
    revision: bigint('revision', { mode: 'number' }).notNull(),
    last_modified_by_device: uuid('last_modified_by_device'),
  },
  (t) => ({
    scopeIdx: index('entity_aspects_scope_idx').on(t.profile_id, t.workspace_id),
    entityIdx: index('entity_aspects_entity_idx').on(t.entity_id),
    revisionIdx: index('entity_aspects_revision_idx').on(t.revision),
  }),
);

// ── entity_relations ─────────────────────────────────────────────────────────
export const entityRelations = pgTable(
  'entity_relations',
  {
    id: uuid('id').primaryKey(),
    profile_id: text('profile_id').notNull(),
    workspace_id: text('workspace_id').notNull(),
    from_entity_id: uuid('from_entity_id').notNull(),
    to_entity_id: uuid('to_entity_id').notNull(),
    kind: text('kind').notNull(),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    created_at: timestamp('created_at', { withTimezone: true }).notNull(),
    revision: bigint('revision', { mode: 'number' }).notNull(),
    last_modified_by_device: uuid('last_modified_by_device'),
  },
  (t) => ({
    scopeIdx: index('entity_relations_scope_idx').on(t.profile_id, t.workspace_id),
    fromIdx: index('entity_relations_from_idx').on(t.from_entity_id),
    revisionIdx: index('entity_relations_revision_idx').on(t.revision),
  }),
);

// ── tombstones (hard-delete propagation) ─────────────────────────────────────
// `kind` is one of 'core' | 'aspect' | 'relation'. The id matches the deleted
// row's primary key. Soft-deletes flow through the regular tables via
// `deleted_at`; hard-deletes (e.g. relations) need a tombstone so other
// devices know to forget the row.
export const tombstones = pgTable(
  'tombstones',
  {
    kind: text('kind').notNull(),
    id: uuid('id').notNull(),
    profile_id: text('profile_id').notNull(),
    workspace_id: text('workspace_id').notNull(),
    revision: bigint('revision', { mode: 'number' }).notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }).notNull(),
    last_modified_by_device: uuid('last_modified_by_device'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.kind, t.id] }),
    scopeIdx: index('tombstones_scope_idx').on(t.profile_id, t.workspace_id),
    revisionIdx: index('tombstones_revision_idx').on(t.revision),
  }),
);

// ── files (content-addressed, server-side) ──────────────────────────────────
export const files = pgTable('files', {
  hash: text('hash').primaryKey(),
  minio_path: text('minio_path').notNull(),
  mime_type: text('mime_type').notNull().default('application/octet-stream'),
  size_bytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  reference_count: integer('reference_count').notNull().default(1),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── users / devices / share_links (Phase P — multi-user) ────────────────────
// Phase P replaces the single-row `owner` table with a real `users` table.
// `org_role` gates admin-only ops (user management, audit, share-link admin).
// `must_change_password` is set on admin-created users; the login response
// returns a scoped pw-change-only token until the user resets their password.
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    password_hash: text('password_hash').notNull(),
    display_name: text('display_name').notNull().default(''),
    org_role: text('org_role').notNull().default('member'),
    must_change_password: boolean('must_change_password').notNull().default(false),
    disabled_at: timestamp('disabled_at', { withTimezone: true }),
    created_by: uuid('created_by'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    roleIdx: index('users_role_idx').on(t.org_role),
    disabledIdx: index('users_disabled_idx').on(t.disabled_at),
  }),
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    profile_id: text('profile_id').notNull(),
    token_hash: text('token_hash').notNull(),
    last_seen_at: timestamp('last_seen_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    userIdx: index('devices_user_idx').on(t.user_id),
    profileIdx: index('devices_profile_idx').on(t.profile_id),
    revokedIdx: index('devices_revoked_idx').on(t.revoked_at),
  }),
);

export const shareLinks = pgTable(
  'share_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parent_entity_id: uuid('parent_entity_id'),
    /** Profile (Phase H multi-profile) the share is scoped to. */
    profile_id: text('profile_id').notNull().default(''),
    /** Workspace within profile the share is scoped to. */
    workspace_id: text('workspace_id').notNull().default(''),
    /** Optional human label shown in the share-link manager. */
    label: text('label').notNull().default(''),
    token_hash: text('token_hash').notNull().unique(),
    scope: jsonb('scope').notNull().default(sql`'{}'::jsonb`),
    can_upload: integer('can_upload').notNull().default(0),
    can_submit: integer('can_submit').notNull().default(0),
    expires_at: timestamp('expires_at', { withTimezone: true }),
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    parentIdx: index('share_links_parent_idx').on(t.parent_entity_id),
    revokedIdx: index('share_links_revoked_idx').on(t.revoked_at),
    scopeIdx: index('share_links_scope_idx').on(t.profile_id, t.workspace_id),
  }),
);

// ── workspaces / workspace_members (Phase Q — ACL) ──────────────────────────
// First-class workspace metadata. Existing `base_entities.workspace_id` (text)
// references `workspaces.id` (also text — match the existing column type).
// `workspaces.id` is generated client-side or by the desktop on workspace
// creation, then mirrored to the server via `auth.workspaces.create`.
export const workspaces = pgTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    owner_user_id: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    icon: text('icon').notNull().default('folder'),
    color: text('color').notNull().default('#6366f1'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    ownerIdx: index('workspaces_owner_idx').on(t.owner_user_id),
    deletedIdx: index('workspaces_deleted_idx').on(t.deleted_at),
  }),
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspace_id: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('viewer'),
    invited_by: uuid('invited_by'),
    accepted_at: timestamp('accepted_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.workspace_id, t.user_id] }),
    userIdx: index('workspace_members_user_idx').on(t.user_id),
    wsIdx: index('workspace_members_ws_idx').on(t.workspace_id),
  }),
);

// ── audit_log (Phase R) ─────────────────────────────────────────────────────
// Append-only history of meaningful actions. Server-side enterprise feature
// (audit visibility is gated in `auth.audit.list`):
//   - admins see all rows.
//   - workspace owners see rows for workspaces they own + their own actions.
//   - everyone else sees only their own actions.
//
// Action enum is enforced by callers (audit.ts), not the DB, so adding a new
// action doesn't require a migration.
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    actor_user_id: uuid('actor_user_id'),
    actor_device_id: uuid('actor_device_id'),
    workspace_id: text('workspace_id'),
    target_kind: text('target_kind'),
    target_id: text('target_id'),
    action: text('action').notNull(),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    ip_addr: text('ip_addr'),
  },
  (t) => ({
    tsIdx: index('audit_log_ts_idx').on(t.ts),
    actorIdx: index('audit_log_actor_idx').on(t.actor_user_id),
    wsIdx: index('audit_log_ws_idx').on(t.workspace_id),
    actionIdx: index('audit_log_action_idx').on(t.action),
  }),
);

// suppress unused warning for helper kept for future composite indexes
void uniqueIndex;

export type BaseEntityRow = typeof baseEntities.$inferSelect;
export type NewBaseEntityRow = typeof baseEntities.$inferInsert;
export type EntityAspectRow = typeof entityAspects.$inferSelect;
export type NewEntityAspectRow = typeof entityAspects.$inferInsert;
export type EntityRelationRow = typeof entityRelations.$inferSelect;
export type NewEntityRelationRow = typeof entityRelations.$inferInsert;
export type TombstoneRow = typeof tombstones.$inferSelect;
export type FileRow = typeof files.$inferSelect;
export type NewFileRow = typeof files.$inferInsert;
export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type DeviceRow = typeof devices.$inferSelect;
export type NewDeviceRow = typeof devices.$inferInsert;
export type ShareLinkRow = typeof shareLinks.$inferSelect;
export type WorkspaceRow = typeof workspaces.$inferSelect;
export type NewWorkspaceRow = typeof workspaces.$inferInsert;
export type WorkspaceMemberRow = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMemberRow = typeof workspaceMembers.$inferInsert;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
