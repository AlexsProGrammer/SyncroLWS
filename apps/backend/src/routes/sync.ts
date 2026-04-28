import { TRPCError } from '@trpc/server';
import { eq, and, gt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  baseEntities,
  entityAspects,
  entityRelations,
  tombstones,
  workspaceMembers,
} from '../db/schema';
import {
  SyncPullInputSchema,
  SyncPushInputSchema,
} from '@syncrohws/shared-types';
import { t, protectedProcedure } from '../trpc';

// ── helpers ───────────────────────────────────────────────────────────────────

const NEXT_REV = sql<number>`nextval('sync_revision')`;

/**
 * Phase Q — Resolve the per-request sync scope.
 *
 * Two auth kinds reach sync.*:
 *  - `device` tokens (Phase H legacy / personal mode) carry a `profileId`
 *    that scopes ALL reads & writes. The workspace_id filter is unchanged
 *    from before — there's no server-side `workspaces` mirror in personal
 *    mode, just the per-profile bucket.
 *  - `user` tokens (Phase P enterprise mode) authenticate the human; the
 *    workspace ACL is checked against `workspace_members`. `profile_id`
 *    is unused on the server in enterprise mode; we synthesize the literal
 *    `'enterprise'` so the column has a stable value.
 */
type SyncScope =
  | { mode: 'device'; profileId: string; deviceId: string }
  | { mode: 'user'; userId: string; deviceId: null };

function requireSyncAuth(ctx: { auth: { kind: string } } & Record<string, unknown>): SyncScope {
  const auth = ctx.auth as {
    kind: string;
    profileId?: string;
    deviceId?: string;
    userId?: string;
    scope?: string;
  };
  if (auth.kind === 'device') {
    return { mode: 'device', profileId: auth.profileId!, deviceId: auth.deviceId! };
  }
  if (auth.kind === 'user' && auth.scope === 'full') {
    return { mode: 'user', userId: auth.userId!, deviceId: null };
  }
  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'sync.* requires a device token or full-scope user token',
  });
}

/** Returns the user's role in the workspace, or null if not a member. */
async function userWorkspaceRole(
  workspaceId: string,
  userId: string,
): Promise<'owner' | 'editor' | 'viewer' | null> {
  const rows = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspace_id, workspaceId),
        eq(workspaceMembers.user_id, userId),
      ),
    )
    .limit(1);
  const r = rows[0]?.role;
  if (r === 'owner' || r === 'editor' || r === 'viewer') return r;
  return null;
}

/**
 * For enterprise sync: workspace_id in `base_entities` is whatever the writer
 * inserted. Personal-mode rows had a per-profile bucket; enterprise-mode rows
 * use the workspace id stored on the desktop (matches `workspaces.id`).
 *
 * Server-side, the only workspace_id-scoped predicate we add is what the
 * client passed in `input.workspace_id`. The membership check above is what
 * actually authorizes the read.
 *
 * `profile_id` predicate:
 *  - device mode → exact match on the device's profile.
 *  - user mode  → no profile filter (workspace membership is the gate).
 */
const ENTERPRISE_PROFILE_TAG = 'enterprise';

// ── sync.pull ─────────────────────────────────────────────────────────────────

const pullProcedure = protectedProcedure
  .input(SyncPullInputSchema)
  .query(async ({ input, ctx }) => {
    const scope = requireSyncAuth(ctx);
    const since = input.since_revision;
    const limit = input.limit;

    // For enterprise (user-token) callers, gate by workspace membership.
    if (scope.mode === 'user') {
      const role = await userWorkspaceRole(input.workspace_id, scope.userId);
      if (!role) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this workspace.',
        });
      }
    }

    // Profile filter: device-mode keeps the legacy per-profile bucket;
    // user-mode reads any row in the (membership-checked) workspace.
    const corePf = scope.mode === 'device' ? eq(baseEntities.profile_id, scope.profileId) : sql`TRUE`;
    const aspPf = scope.mode === 'device' ? eq(entityAspects.profile_id, scope.profileId) : sql`TRUE`;
    const relPf = scope.mode === 'device' ? eq(entityRelations.profile_id, scope.profileId) : sql`TRUE`;
    const tombPf = scope.mode === 'device' ? eq(tombstones.profile_id, scope.profileId) : sql`TRUE`;

    const cores = await db
      .select()
      .from(baseEntities)
      .where(
        and(
          corePf,
          eq(baseEntities.workspace_id, input.workspace_id),
          gt(baseEntities.revision, since),
        ),
      )
      .orderBy(baseEntities.revision)
      .limit(limit);

    const aspects = await db
      .select()
      .from(entityAspects)
      .where(
        and(
          aspPf,
          eq(entityAspects.workspace_id, input.workspace_id),
          gt(entityAspects.revision, since),
        ),
      )
      .orderBy(entityAspects.revision)
      .limit(limit);

    const relations = await db
      .select()
      .from(entityRelations)
      .where(
        and(
          relPf,
          eq(entityRelations.workspace_id, input.workspace_id),
          gt(entityRelations.revision, since),
        ),
      )
      .orderBy(entityRelations.revision)
      .limit(limit);

    const tombs = await db
      .select()
      .from(tombstones)
      .where(
        and(
          tombPf,
          eq(tombstones.workspace_id, input.workspace_id),
          gt(tombstones.revision, since),
        ),
      )
      .orderBy(tombstones.revision)
      .limit(limit);

    const allRevs = [
      ...cores.map((r) => r.revision),
      ...aspects.map((r) => r.revision),
      ...relations.map((r) => r.revision),
      ...tombs.map((r) => r.revision),
    ];
    const latest = allRevs.length === 0 ? since : Math.max(...allRevs);
    const has_more =
      cores.length === limit ||
      aspects.length === limit ||
      relations.length === limit ||
      tombs.length === limit;

    return {
      cores: cores.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        description_json: r.description_json ?? undefined,
        color: r.color,
        icon: r.icon,
        tags: (r.tags as string[]) ?? [],
        parent_id: r.parent_id,
        created_at: r.created_at.toISOString(),
        updated_at: r.updated_at.toISOString(),
        deleted_at: r.deleted_at ? r.deleted_at.toISOString() : null,
        revision: r.revision,
      })),
      aspects: aspects.map((r) => ({
        id: r.id,
        entity_id: r.entity_id,
        aspect_type: r.aspect_type as never,
        data: (r.data as Record<string, unknown>) ?? {},
        tool_instance_id: r.tool_instance_id,
        sort_order: r.sort_order,
        created_at: r.created_at.toISOString(),
        updated_at: r.updated_at.toISOString(),
        deleted_at: r.deleted_at ? r.deleted_at.toISOString() : null,
        revision: r.revision,
      })),
      relations: relations.map((r) => ({
        id: r.id,
        from_entity_id: r.from_entity_id,
        to_entity_id: r.to_entity_id,
        kind: r.kind as never,
        metadata: (r.metadata as Record<string, unknown>) ?? {},
        created_at: r.created_at.toISOString(),
        revision: r.revision,
      })),
      tombstones: tombs.map((r) => ({
        kind: r.kind as 'core' | 'aspect' | 'relation',
        id: r.id,
        revision: r.revision,
      })),
      latest_revision: latest,
      has_more,
    };
  });

// ── sync.push ─────────────────────────────────────────────────────────────────

const pushProcedure = protectedProcedure
  .input(SyncPushInputSchema)
  .mutation(async ({ input, ctx }) => {
    const scope = requireSyncAuth(ctx);

    // Enterprise: must be owner/editor in the target workspace.
    if (scope.mode === 'user') {
      const role = await userWorkspaceRole(input.workspace_id, scope.userId);
      if (!role) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this workspace.',
        });
      }
      if (role === 'viewer') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Viewer role cannot push changes.',
        });
      }
    }

    const profileId = scope.mode === 'device' ? scope.profileId : ENTERPRISE_PROFILE_TAG;
    const deviceId = scope.deviceId;
    const accepted: { kind: 'core' | 'aspect' | 'relation' | 'delete'; id: string; revision: number }[] = [];
    const conflicts: { kind: 'core' | 'aspect' | 'relation' | 'delete'; id: string; server_revision: number }[] = [];

    // Cores
    for (const row of input.cores) {
      const existing = await db
        .select({ revision: baseEntities.revision })
        .from(baseEntities)
        .where(eq(baseEntities.id, row.id))
        .limit(1);

      if (existing[0] && existing[0].revision > row.base_revision) {
        conflicts.push({ kind: 'core', id: row.id, server_revision: existing[0].revision });
        continue;
      }

      const [out] = await db
        .insert(baseEntities)
        .values({
          id: row.id,
          profile_id: profileId,
          workspace_id: input.workspace_id,
          title: row.title,
          description: row.description,
          description_json: row.description_json ?? null,
          color: row.color,
          icon: row.icon,
          tags: row.tags,
          parent_id: row.parent_id,
          created_at: new Date(row.created_at),
          updated_at: new Date(row.updated_at),
          deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
          revision: NEXT_REV,
          last_modified_by_device: deviceId,
        })
        .onConflictDoUpdate({
          target: baseEntities.id,
          set: {
            title: row.title,
            description: row.description,
            description_json: row.description_json ?? null,
            color: row.color,
            icon: row.icon,
            tags: row.tags,
            parent_id: row.parent_id,
            updated_at: new Date(row.updated_at),
            deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
            revision: NEXT_REV,
            last_modified_by_device: deviceId,
          },
        })
        .returning({ revision: baseEntities.revision });
      accepted.push({ kind: 'core', id: row.id, revision: out!.revision });
    }

    // Aspects
    for (const row of input.aspects) {
      const existing = await db
        .select({ revision: entityAspects.revision })
        .from(entityAspects)
        .where(eq(entityAspects.id, row.id))
        .limit(1);
      if (existing[0] && existing[0].revision > row.base_revision) {
        conflicts.push({ kind: 'aspect', id: row.id, server_revision: existing[0].revision });
        continue;
      }
      const [out] = await db
        .insert(entityAspects)
        .values({
          id: row.id,
          entity_id: row.entity_id,
          profile_id: profileId,
          workspace_id: input.workspace_id,
          aspect_type: row.aspect_type,
          data: row.data,
          tool_instance_id: row.tool_instance_id,
          sort_order: row.sort_order,
          created_at: new Date(row.created_at),
          updated_at: new Date(row.updated_at),
          deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
          revision: NEXT_REV,
          last_modified_by_device: deviceId,
        })
        .onConflictDoUpdate({
          target: entityAspects.id,
          set: {
            data: row.data,
            tool_instance_id: row.tool_instance_id,
            sort_order: row.sort_order,
            updated_at: new Date(row.updated_at),
            deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
            revision: NEXT_REV,
            last_modified_by_device: deviceId,
          },
        })
        .returning({ revision: entityAspects.revision });
      accepted.push({ kind: 'aspect', id: row.id, revision: out!.revision });
    }

    // Relations
    for (const row of input.relations) {
      const existing = await db
        .select({ revision: entityRelations.revision })
        .from(entityRelations)
        .where(eq(entityRelations.id, row.id))
        .limit(1);
      if (existing[0] && existing[0].revision > row.base_revision) {
        conflicts.push({ kind: 'relation', id: row.id, server_revision: existing[0].revision });
        continue;
      }
      const [out] = await db
        .insert(entityRelations)
        .values({
          id: row.id,
          profile_id: profileId,
          workspace_id: input.workspace_id,
          from_entity_id: row.from_entity_id,
          to_entity_id: row.to_entity_id,
          kind: row.kind,
          metadata: row.metadata,
          created_at: new Date(row.created_at),
          revision: NEXT_REV,
          last_modified_by_device: deviceId,
        })
        .onConflictDoUpdate({
          target: entityRelations.id,
          set: {
            metadata: row.metadata,
            revision: NEXT_REV,
            last_modified_by_device: deviceId,
          },
        })
        .returning({ revision: entityRelations.revision });
      accepted.push({ kind: 'relation', id: row.id, revision: out!.revision });
    }

    // Hard deletes → tombstone + remove the original row
    for (const row of input.deletes) {
      const tableMap = {
        core: baseEntities,
        aspect: entityAspects,
        relation: entityRelations,
      } as const;
      const tbl = tableMap[row.kind];
      const existing = await db
        .select({ revision: tbl.revision })
        .from(tbl)
        .where(eq(tbl.id, row.id))
        .limit(1);
      if (existing[0] && existing[0].revision > row.base_revision) {
        conflicts.push({ kind: 'delete', id: row.id, server_revision: existing[0].revision });
        continue;
      }
      await db.delete(tbl).where(eq(tbl.id, row.id));
      const [tomb] = await db
        .insert(tombstones)
        .values({
          kind: row.kind,
          id: row.id,
          profile_id: profileId,
          workspace_id: input.workspace_id,
          revision: NEXT_REV,
          deleted_at: new Date(),
          last_modified_by_device: deviceId,
        })
        .onConflictDoUpdate({
          target: [tombstones.kind, tombstones.id],
          set: {
            revision: NEXT_REV,
            deleted_at: new Date(),
            last_modified_by_device: deviceId,
          },
        })
        .returning({ revision: tombstones.revision });
      accepted.push({ kind: 'delete', id: row.id, revision: tomb!.revision });
    }

    return { accepted, conflicts };
  });

// ── router ───────────────────────────────────────────────────────────────────

export const syncRouter = t.router({
  pull: pullProcedure,
  push: pushProcedure,
});
