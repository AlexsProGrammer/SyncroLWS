/**
 * Phase Q — Workspaces & ACL router.
 *
 * Mounted under `auth.workspaces`. All routes require a full-scope user
 * token. Org admins implicitly have `owner` role on every workspace they
 * created; non-owners can be invited as `editor` or `viewer`.
 *
 * Routes:
 *   list                       — every workspace the caller is a member of.
 *   members                    — list members of a single workspace.
 *   create({id, name, ...})    — caller becomes owner.
 *   update({id, name?, icon?, color?}) — owner only.
 *   softDelete({id})           — owner only; sets deleted_at.
 *   invite({workspace_id, email, role}) — owner only; auto-accepts.
 *   setMemberRole({...})       — owner only.
 *   removeMember({...})        — owner only.
 *   leave({workspace_id})      — non-owner self-removal.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { users, workspaces, workspaceMembers } from '../db/schema';
import { t, protectedProcedure } from '../trpc';
import { record } from '../audit';

const ROLE = z.enum(['owner', 'editor', 'viewer']);
type Role = z.infer<typeof ROLE>;

/** Resolve full-scope user auth or throw. */
function requireUser(ctx: { auth: { kind: string } }) {
  const a = ctx.auth as { kind: string; userId?: string; orgRole?: string; scope?: string };
  if (a.kind !== 'user' || a.scope !== 'full') {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User authentication required.' });
  }
  return { userId: a.userId!, orgRole: (a.orgRole ?? 'member') as 'admin' | 'member' };
}

/** Returns the caller's role in a workspace, or null if not a member. */
async function callerRole(workspaceId: string, userId: string): Promise<Role | null> {
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

async function requireOwnerOf(workspaceId: string, userId: string): Promise<void> {
  const role = await callerRole(workspaceId, userId);
  if (role !== 'owner') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Workspace owner required.' });
  }
}

// ── list ─────────────────────────────────────────────────────────────────────

const list = protectedProcedure.query(async ({ ctx }) => {
  const { userId } = requireUser(ctx);

  // workspaces the caller is a member of
  const memberRows = await db
    .select({
      workspace_id: workspaceMembers.workspace_id,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.user_id, userId));

  if (memberRows.length === 0) return [];

  const wsIds = memberRows.map((r) => r.workspace_id);
  const wsRows = await db
    .select({
      id: workspaces.id,
      owner_user_id: workspaces.owner_user_id,
      name: workspaces.name,
      icon: workspaces.icon,
      color: workspaces.color,
      created_at: workspaces.created_at,
      deleted_at: workspaces.deleted_at,
    })
    .from(workspaces)
    .where(and(inArray(workspaces.id, wsIds), isNull(workspaces.deleted_at)));

  // owner display names
  const ownerIds = Array.from(new Set(wsRows.map((w) => w.owner_user_id)));
  const ownerRows = ownerIds.length
    ? await db
        .select({ id: users.id, email: users.email, display_name: users.display_name })
        .from(users)
        .where(inArray(users.id, ownerIds))
    : [];
  const ownerById = new Map(ownerRows.map((u) => [u.id, u]));
  const roleById = new Map(memberRows.map((m) => [m.workspace_id, m.role as Role]));

  return wsRows.map((w) => ({
    id: w.id,
    name: w.name,
    icon: w.icon,
    color: w.color,
    created_at: w.created_at.toISOString(),
    role: roleById.get(w.id) ?? 'viewer',
    owner: {
      id: w.owner_user_id,
      email: ownerById.get(w.owner_user_id)?.email ?? '',
      display_name: ownerById.get(w.owner_user_id)?.display_name ?? '',
    },
    is_owner: w.owner_user_id === userId,
  }));
});

// ── members ──────────────────────────────────────────────────────────────────

const members = protectedProcedure
  .input(z.object({ workspace_id: z.string().min(1) }))
  .query(async ({ ctx, input }) => {
    const { userId } = requireUser(ctx);
    // Caller must be a member to view membership.
    const role = await callerRole(input.workspace_id, userId);
    if (!role) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this workspace.' });
    }

    const rows = await db
      .select({
        user_id: workspaceMembers.user_id,
        role: workspaceMembers.role,
        invited_by: workspaceMembers.invited_by,
        accepted_at: workspaceMembers.accepted_at,
        created_at: workspaceMembers.created_at,
        email: users.email,
        display_name: users.display_name,
        org_role: users.org_role,
        disabled_at: users.disabled_at,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.user_id))
      .where(eq(workspaceMembers.workspace_id, input.workspace_id))
      .orderBy(desc(workspaceMembers.created_at));

    return rows.map((r) => ({
      user_id: r.user_id,
      email: r.email,
      display_name: r.display_name,
      org_role: r.org_role,
      role: r.role as Role,
      invited_by: r.invited_by,
      accepted_at: r.accepted_at ? r.accepted_at.toISOString() : null,
      created_at: r.created_at.toISOString(),
      disabled: !!r.disabled_at,
    }));
  });

// ── create ──────────────────────────────────────────────────────────────────

const create = protectedProcedure
  .input(
    z.object({
      id: z.string().min(1).max(120),
      name: z.string().min(1).max(120),
      icon: z.string().max(64).optional(),
      color: z.string().max(32).optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const { userId } = requireUser(ctx);
    const existing = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, input.id))
      .limit(1);
    if (existing[0]) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Workspace id already exists.' });
    }
    await db.insert(workspaces).values({
      id: input.id,
      owner_user_id: userId,
      name: input.name,
      icon: input.icon ?? 'folder',
      color: input.color ?? '#6366f1',
    });
    await db.insert(workspaceMembers).values({
      workspace_id: input.id,
      user_id: userId,
      role: 'owner',
      invited_by: userId,
      accepted_at: new Date(),
    });
    void record(ctx, {
      action: 'workspace.create',
      target_kind: 'workspace',
      target_id: input.id,
      workspace_id: input.id,
      payload: { name: input.name },
    });
    return { id: input.id };
  });

// ── update ──────────────────────────────────────────────────────────────────

const update = protectedProcedure
  .input(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1).max(120).optional(),
      icon: z.string().max(64).optional(),
      color: z.string().max(32).optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const { userId } = requireUser(ctx);
    await requireOwnerOf(input.id, userId);
    const patch: Partial<{ name: string; icon: string; color: string }> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.icon !== undefined) patch.icon = input.icon;
    if (input.color !== undefined) patch.color = input.color;
    if (Object.keys(patch).length === 0) return { success: true };
    await db.update(workspaces).set(patch).where(eq(workspaces.id, input.id));
    void record(ctx, {
      action: 'workspace.update',
      target_kind: 'workspace',
      target_id: input.id,
      workspace_id: input.id,
      payload: patch,
    });
    return { success: true };
  });

// ── softDelete ──────────────────────────────────────────────────────────────

const softDelete = protectedProcedure
  .input(z.object({ id: z.string().min(1) }))
  .mutation(async ({ ctx, input }) => {
    const { userId } = requireUser(ctx);
    await requireOwnerOf(input.id, userId);
    await db
      .update(workspaces)
      .set({ deleted_at: new Date() })
      .where(eq(workspaces.id, input.id));
    void record(ctx, {
      action: 'workspace.delete',
      target_kind: 'workspace',
      target_id: input.id,
      workspace_id: input.id,
    });
    return { success: true };
  });

// ── invite ──────────────────────────────────────────────────────────────────

const invite = protectedProcedure
  .input(
    z.object({
      workspace_id: z.string().min(1),
      email: z.string().email(),
      role: z.enum(['editor', 'viewer']).default('editor'),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const { userId } = requireUser(ctx);
    await requireOwnerOf(input.workspace_id, userId);

    const userRows = await db
      .select({ id: users.id, disabled_at: users.disabled_at })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    const target = userRows[0];
    if (!target || target.disabled_at) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'No active user with that email.' });
    }
    if (target.id === userId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'You are already the owner.' });
    }

    // Upsert: if already a member, update role (but never demote owner here).
    const existing = await callerRole(input.workspace_id, target.id);
    if (existing === 'owner') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Target is already owner.' });
    }
    if (existing) {
      await db
        .update(workspaceMembers)
        .set({ role: input.role })
        .where(
          and(
            eq(workspaceMembers.workspace_id, input.workspace_id),
            eq(workspaceMembers.user_id, target.id),
          ),
        );
    } else {
      await db.insert(workspaceMembers).values({
        workspace_id: input.workspace_id,
        user_id: target.id,
        role: input.role,
        invited_by: userId,
        accepted_at: new Date(), // auto-accept within org
      });
    }
    void record(ctx, {
      action: 'workspace.invite',
      target_kind: 'user',
      target_id: target.id,
      workspace_id: input.workspace_id,
      payload: { email: input.email, role: input.role, replaced_existing: existing !== null },
    });
    return { user_id: target.id, role: input.role };
  });

// ── setMemberRole ───────────────────────────────────────────────────────────

const setMemberRole = protectedProcedure
  .input(
    z.object({
      workspace_id: z.string().min(1),
      user_id: z.string().uuid(),
      role: z.enum(['editor', 'viewer']), // ownership transfer is a separate op
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const { userId } = requireUser(ctx);
    await requireOwnerOf(input.workspace_id, userId);

    if (input.user_id === userId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot demote yourself.' });
    }
    const cur = await callerRole(input.workspace_id, input.user_id);
    if (!cur) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User is not a member.' });
    }
    if (cur === 'owner') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot demote the owner.' });
    }
    await db
      .update(workspaceMembers)
      .set({ role: input.role })
      .where(
        and(
          eq(workspaceMembers.workspace_id, input.workspace_id),
          eq(workspaceMembers.user_id, input.user_id),
        ),
      );
    void record(ctx, {
      action: 'workspace.role_change',
      target_kind: 'user',
      target_id: input.user_id,
      workspace_id: input.workspace_id,
      payload: { role: input.role, previous: cur },
    });
    return { success: true };
  });

// ── removeMember ────────────────────────────────────────────────────────────

const removeMember = protectedProcedure
  .input(
    z.object({
      workspace_id: z.string().min(1),
      user_id: z.string().uuid(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const { userId } = requireUser(ctx);
    await requireOwnerOf(input.workspace_id, userId);

    if (input.user_id === userId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Use leave() to remove yourself; ownership transfer required first.',
      });
    }
    await db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspace_id, input.workspace_id),
          eq(workspaceMembers.user_id, input.user_id),
        ),
      );
    void record(ctx, {
      action: 'workspace.remove_member',
      target_kind: 'user',
      target_id: input.user_id,
      workspace_id: input.workspace_id,
    });
    return { success: true };
  });

// ── leave ───────────────────────────────────────────────────────────────────

const leave = protectedProcedure
  .input(z.object({ workspace_id: z.string().min(1) }))
  .mutation(async ({ ctx, input }) => {
    const { userId } = requireUser(ctx);
    const role = await callerRole(input.workspace_id, userId);
    if (!role) return { success: true };
    if (role === 'owner') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Owner cannot leave; transfer ownership or delete the workspace first.',
      });
    }
    await db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspace_id, input.workspace_id),
          eq(workspaceMembers.user_id, userId),
        ),
      );
    void record(ctx, {
      action: 'workspace.leave',
      target_kind: 'user',
      target_id: userId,
      workspace_id: input.workspace_id,
    });
    return { success: true };
  });

export const workspacesRouter = t.router({
  list,
  members,
  create,
  update,
  softDelete,
  invite,
  setMemberRole,
  removeMember,
  leave,
});

export type WorkspacesRouter = typeof workspacesRouter;
