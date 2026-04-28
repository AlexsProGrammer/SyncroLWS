/**
 * Phase R — Audit log read API. Mounted at `auth.audit`.
 *
 * Visibility:
 *   - admins see all rows.
 *   - workspace owners see rows where workspace_id ∈ owned, plus their own
 *     actor rows.
 *   - everyone else sees only their own actor rows.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { and, desc, eq, gte, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { auditLog, workspaceMembers } from '../db/schema';
import { t, protectedProcedure } from '../trpc';

function requireUser(ctx: { auth: { kind: string } }) {
  const a = ctx.auth as { kind: string; userId?: string; orgRole?: string; scope?: string };
  if (a.kind !== 'user' || a.scope !== 'full') {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User authentication required.' });
  }
  return { userId: a.userId!, orgRole: (a.orgRole ?? 'member') as 'admin' | 'member' };
}

const list = protectedProcedure
  .input(
    z
      .object({
        workspace_id: z.string().min(1).optional(),
        actor_user_id: z.string().uuid().optional(),
        action: z.string().min(1).optional(),
        since: z.string().datetime().optional(),
        until: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(500).default(100),
      })
      .default({ limit: 100 }),
  )
  .query(async ({ ctx, input }) => {
    const { userId, orgRole } = requireUser(ctx);

    const conds: SQL[] = [];
    if (input.action) conds.push(eq(auditLog.action, input.action));
    if (input.actor_user_id) conds.push(eq(auditLog.actor_user_id, input.actor_user_id));
    if (input.since) conds.push(gte(auditLog.ts, new Date(input.since)));
    if (input.until) conds.push(lt(auditLog.ts, new Date(input.until)));
    if (input.workspace_id) conds.push(eq(auditLog.workspace_id, input.workspace_id));

    if (orgRole !== 'admin') {
      // Non-admin: own actions OR rows scoped to a workspace they own.
      const ownedRows = await db
        .select({ workspace_id: workspaceMembers.workspace_id })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.user_id, userId),
            eq(workspaceMembers.role, 'owner'),
          ),
        );
      const ownedIds = ownedRows.map((r) => r.workspace_id);
      if (ownedIds.length > 0) {
        const visibility = or(
          eq(auditLog.actor_user_id, userId),
          inArray(auditLog.workspace_id, ownedIds),
        );
        if (visibility) conds.push(visibility);
      } else {
        conds.push(eq(auditLog.actor_user_id, userId));
      }
    }

    const rows = await db
      .select()
      .from(auditLog)
      .where(conds.length === 0 ? sql`TRUE` : and(...conds))
      .orderBy(desc(auditLog.ts))
      .limit(input.limit);

    return rows.map((r) => ({
      id: r.id,
      ts: r.ts.toISOString(),
      actor_user_id: r.actor_user_id,
      actor_device_id: r.actor_device_id,
      workspace_id: r.workspace_id,
      target_kind: r.target_kind,
      target_id: r.target_id,
      action: r.action,
      payload: r.payload as Record<string, unknown>,
      ip_addr: r.ip_addr,
    }));
  });

export const auditRouter = t.router({ list });
