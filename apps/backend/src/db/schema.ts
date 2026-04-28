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

// ── owner ─────────────────────────────────────────────────────────────────────
/**
 * Single-user owner record. Phase H: at most one row, seeded from
 * OWNER_BOOTSTRAP_EMAIL/PASSWORD on first startup if the table is empty.
 */
export const owner = pgTable('owner', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── devices ───────────────────────────────────────────────────────────────────
/**
 * One row per paired desktop client (per profile). Long-lived device JWTs are
 * minted by the owner and revoked here. `token_hash` stores SHA-256 of the
 * issued JWT so we can validate without keeping the raw token.
 */
export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    owner_id: uuid('owner_id').notNull().references(() => owner.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    profile_id: text('profile_id').notNull(),
    token_hash: text('token_hash').notNull(),
    last_seen_at: timestamp('last_seen_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    ownerIdx: index('devices_owner_idx').on(t.owner_id),
    profileIdx: index('devices_profile_idx').on(t.profile_id),
    revokedIdx: index('devices_revoked_idx').on(t.revoked_at),
  }),
);

// ── share_links ───────────────────────────────────────────────────────────────
/**
 * Tokenized public links for the read-only / limited-write client portal.
 * Phase M will populate this fully; the table is created here so Phase H/I
 * auth context can reference it without another migration.
 */
export const shareLinks = pgTable(
  'share_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parent_entity_id: uuid('parent_entity_id'),
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
  }),
);

export type OwnerRow = typeof owner.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type NewDeviceRow = typeof devices.$inferInsert;
export type ShareLinkRow = typeof shareLinks.$inferSelect;
