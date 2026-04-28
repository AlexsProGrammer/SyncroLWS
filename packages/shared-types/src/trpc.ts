import { z } from 'zod';
import {
  EntityCoreSchema,
  EntityAspectSchema,
  EntityRelationSchema,
} from './base-entity';

/**
 * tRPC auth context — mirrors apps/backend/src/auth.ts AuthContext shape.
 * Phase H: single-owner JWT + per-device long-lived tokens; share tokens
 * reserved for the Phase M client portal.
 */
export type AuthContext =
  | { kind: 'anonymous' }
  | { kind: 'owner'; ownerId: string }
  | { kind: 'device'; deviceId: string; ownerId: string; profileId: string }
  | { kind: 'share'; shareId: string };

/**
 * tRPC context shape — populated per-request in apps/backend.
 * Exported so the desktop client can mirror the same type.
 */
export interface TRPCContext {
  requestId: string;
  auth: AuthContext;
}

// ── Sync wire types (Phase I) ────────────────────────────────────────────────

/** Tombstone kinds exchanged between server and clients. */
export const TombstoneKindSchema = z.enum(['core', 'aspect', 'relation']);
export type TombstoneKind = z.infer<typeof TombstoneKindSchema>;

export const TombstoneSchema = z.object({
  kind: TombstoneKindSchema,
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
});
export type Tombstone = z.infer<typeof TombstoneSchema>;

/**
 * The shape of a sync row — the EntityCore/Aspect/Relation schemas augmented
 * with the server-assigned `revision` value.
 */
export const SyncCoreSchema = EntityCoreSchema.extend({
  revision: z.number().int().nonnegative(),
});
export type SyncCore = z.infer<typeof SyncCoreSchema>;

export const SyncAspectSchema = EntityAspectSchema.extend({
  revision: z.number().int().nonnegative(),
});
export type SyncAspect = z.infer<typeof SyncAspectSchema>;

export const SyncRelationSchema = EntityRelationSchema.extend({
  revision: z.number().int().nonnegative(),
});
export type SyncRelation = z.infer<typeof SyncRelationSchema>;

// ── Pull ───────────────────────────────────────────────────────────────────────

export const SyncPullInputSchema = z.object({
  workspace_id: z.string(),
  since_revision: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(2000).default(500),
});
export type SyncPullInput = z.infer<typeof SyncPullInputSchema>;

export const SyncPullResultSchema = z.object({
  cores: z.array(SyncCoreSchema),
  aspects: z.array(SyncAspectSchema),
  relations: z.array(SyncRelationSchema),
  tombstones: z.array(TombstoneSchema),
  /** Highest revision contained in this batch — clients persist as cursor. */
  latest_revision: z.number().int().nonnegative(),
  /** True when more rows are available beyond this batch. */
  has_more: z.boolean(),
});
export type SyncPullResult = z.infer<typeof SyncPullResultSchema>;

// ── Push ───────────────────────────────────────────────────────────────────────

/**
 * A row sent from client → server. `base_revision` is the revision the client
 * observed for this id during its last successful pull (0 for new rows). The
 * server rejects the push as a conflict if the current server revision is
 * greater than `base_revision`.
 */
export const PushCoreInputSchema = EntityCoreSchema.extend({
  base_revision: z.number().int().nonnegative(),
});
export const PushAspectInputSchema = EntityAspectSchema.extend({
  base_revision: z.number().int().nonnegative(),
});
export const PushRelationInputSchema = EntityRelationSchema.extend({
  base_revision: z.number().int().nonnegative(),
});
export const PushDeleteInputSchema = z.object({
  kind: TombstoneKindSchema,
  id: z.string().uuid(),
  base_revision: z.number().int().nonnegative(),
});

export const SyncPushInputSchema = z.object({
  workspace_id: z.string(),
  cores: z.array(PushCoreInputSchema).default([]),
  aspects: z.array(PushAspectInputSchema).default([]),
  relations: z.array(PushRelationInputSchema).default([]),
  deletes: z.array(PushDeleteInputSchema).default([]),
});
export type SyncPushInput = z.infer<typeof SyncPushInputSchema>;

export const SyncPushAckSchema = z.object({
  kind: z.enum(['core', 'aspect', 'relation', 'delete']),
  id: z.string().uuid(),
  /** New server revision after applying the write. */
  revision: z.number().int().nonnegative(),
});

export const SyncPushConflictSchema = z.object({
  kind: z.enum(['core', 'aspect', 'relation', 'delete']),
  id: z.string().uuid(),
  /** The current server revision the client must reconcile against. */
  server_revision: z.number().int().nonnegative(),
});

export const SyncPushResultSchema = z.object({
  accepted: z.array(SyncPushAckSchema),
  conflicts: z.array(SyncPushConflictSchema),
});
export type SyncPushResult = z.infer<typeof SyncPushResultSchema>;
