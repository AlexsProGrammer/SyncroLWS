/**
 * Phase P — Auth tRPC router (multi-user).
 *
 * Routes:
 *   auth.login                 — public; password → user JWT (or scoped
 *                                pw-change token if must_change_password=1).
 *   auth.ownerLogin            — DEPRECATED alias of `login`, retained so
 *                                pre-Phase-P desktop pair flows keep working.
 *                                Refuses non-admin users.
 *   auth.changePassword        — pwChange-scoped or full-scope; clears the
 *                                must_change_password flag and returns a new
 *                                full-scope token.
 *   auth.me                    — protected; returns current auth context.
 *
 *   auth.users.list            — admin-only.
 *   auth.users.create          — admin-only; default password +
 *                                must_change_password=true.
 *   auth.users.update          — admin-only; display_name / org_role.
 *   auth.users.disable         — admin-only; set/unset disabled_at.
 *   auth.users.resetPassword   — admin-only; set new default pw,
 *                                must_change_password=true.
 *
 *   auth.devices.{pair,list,rename,revoke} — admin-only.
 *   auth.shareLinks.{create,list,revoke}   — admin-only.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { devices, users, shareLinks } from '../db/schema';
import {
  hashPassword,
  hashToken,
  signDeviceToken,
  signPasswordChangeToken,
  signShareToken,
  signUserToken,
  verifyPassword,
  type OrgRole,
} from '../auth';
import {
  t,
  adminProcedure,
  protectedProcedure,
  publicProcedure,
  pwChangeProcedure,
} from '../trpc';

// ── helpers ──────────────────────────────────────────────────────────────────

const ORG_ROLE = z.enum(['admin', 'member']);

function asOrgRole(s: string): OrgRole {
  return s === 'admin' ? 'admin' : 'member';
}

async function loadUser(userId: string) {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
}

// ── login ────────────────────────────────────────────────────────────────────

const login = publicProcedure
  .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
  .mutation(async ({ input }) => {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    const row = rows[0];
    if (!row || row.disabled_at) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid credentials.' });
    }
    const ok = await verifyPassword(input.password, row.password_hash);
    if (!ok) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid credentials.' });
    }
    const orgRole = asOrgRole(row.org_role);
    if (row.must_change_password) {
      const token = signPasswordChangeToken(row.id, orgRole);
      return {
        token,
        must_change_password: true as const,
        user: {
          id: row.id,
          email: row.email,
          display_name: row.display_name,
          org_role: orgRole,
        },
      };
    }
    const token = signUserToken(row.id, orgRole, 'full');
    return {
      token,
      must_change_password: false as const,
      user: {
        id: row.id,
        email: row.email,
        display_name: row.display_name,
        org_role: orgRole,
      },
    };
  });

/** @deprecated Phase P — alias of `login` that rejects non-admins so legacy
 *  desktop pair flow (which expects the returned token to be admin-capable)
 *  keeps working. New clients should use `login`. */
const ownerLogin = publicProcedure
  .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
  .mutation(async ({ input }) => {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    const row = rows[0];
    if (!row || row.disabled_at) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid credentials.' });
    }
    const ok = await verifyPassword(input.password, row.password_hash);
    if (!ok) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid credentials.' });
    }
    if (row.org_role !== 'admin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin account required.' });
    }
    if (row.must_change_password) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Password change required. Use auth.login then auth.changePassword.',
      });
    }
    const token = signUserToken(row.id, 'admin', 'full');
    return { token, owner: { id: row.id, email: row.email } };
  });

// ── changePassword (works with full OR pw_change_only scope) ─────────────────

const changePassword = pwChangeProcedure
  .input(
    z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    if (ctx.auth.kind !== 'user') throw new TRPCError({ code: 'UNAUTHORIZED' });
    const userId = ctx.auth.userId;
    const row = await loadUser(userId);
    if (!row || row.disabled_at) throw new TRPCError({ code: 'UNAUTHORIZED' });
    const ok = await verifyPassword(input.currentPassword, row.password_hash);
    if (!ok) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Current password incorrect.' });
    const hash = await hashPassword(input.newPassword);
    await db
      .update(users)
      .set({ password_hash: hash, must_change_password: false })
      .where(eq(users.id, userId));
    const orgRole = asOrgRole(row.org_role);
    const token = signUserToken(userId, orgRole, 'full');
    return {
      token,
      user: {
        id: row.id,
        email: row.email,
        display_name: row.display_name,
        org_role: orgRole,
      },
    };
  });

// ── me ───────────────────────────────────────────────────────────────────────

const me = protectedProcedure.query(({ ctx }) => ({ auth: ctx.auth }));

// ── users (admin) ────────────────────────────────────────────────────────────

const usersRouter = t.router({
  list: adminProcedure.query(async () => {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        display_name: users.display_name,
        org_role: users.org_role,
        must_change_password: users.must_change_password,
        disabled_at: users.disabled_at,
        created_at: users.created_at,
        created_by: users.created_by,
      })
      .from(users)
      .orderBy(desc(users.created_at));
    return rows;
  }),

  create: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
        display_name: z.string().min(1).max(120),
        org_role: ORG_ROLE.default('member'),
        default_password: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.auth.kind !== 'user') throw new TRPCError({ code: 'FORBIDDEN' });
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
      if (existing[0]) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Email already in use.' });
      }
      const hash = await hashPassword(input.default_password);
      const inserted = await db
        .insert(users)
        .values({
          email: input.email,
          password_hash: hash,
          display_name: input.display_name,
          org_role: input.org_role,
          must_change_password: true,
          created_by: ctx.auth.userId,
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      return {
        id: row.id,
        email: row.email,
        display_name: row.display_name,
        org_role: asOrgRole(row.org_role),
      };
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        display_name: z.string().min(1).max(120).optional(),
        org_role: ORG_ROLE.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.auth.kind !== 'user') throw new TRPCError({ code: 'FORBIDDEN' });
      const patch: Partial<{ display_name: string; org_role: string }> = {};
      if (input.display_name !== undefined) patch.display_name = input.display_name;
      if (input.org_role !== undefined) {
        // Prevent demoting the last admin.
        if (input.org_role !== 'admin') {
          const admins = await db
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.org_role, 'admin'), isNull(users.disabled_at)));
          if (admins.length <= 1 && admins[0]?.id === input.id) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Cannot demote the last admin.',
            });
          }
        }
        patch.org_role = input.org_role;
      }
      if (Object.keys(patch).length === 0) return { success: true };
      await db.update(users).set(patch).where(eq(users.id, input.id));
      return { success: true };
    }),

  disable: adminProcedure
    .input(z.object({ id: z.string().uuid(), disabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.auth.kind !== 'user') throw new TRPCError({ code: 'FORBIDDEN' });
      if (input.id === ctx.auth.userId && input.disabled) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot disable yourself.' });
      }
      if (input.disabled) {
        // Don't allow disabling the last active admin.
        const target = await loadUser(input.id);
        if (target?.org_role === 'admin') {
          const admins = await db
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.org_role, 'admin'), isNull(users.disabled_at)));
          if (admins.length <= 1) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Cannot disable the last active admin.',
            });
          }
        }
      }
      await db
        .update(users)
        .set({ disabled_at: input.disabled ? new Date() : null })
        .where(eq(users.id, input.id));
      return { success: true };
    }),

  resetPassword: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        new_default_password: z.string().min(8),
      }),
    )
    .mutation(async ({ input }) => {
      const hash = await hashPassword(input.new_default_password);
      await db
        .update(users)
        .set({ password_hash: hash, must_change_password: true })
        .where(eq(users.id, input.id));
      return { success: true };
    }),
});

// ── devices ──────────────────────────────────────────────────────────────────

const devicesRouter = t.router({
  pair: adminProcedure
    .input(
      z.object({
        deviceName: z.string().min(1).max(120),
        profileId: z.string().min(1).max(120),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.auth.kind !== 'user') throw new TRPCError({ code: 'FORBIDDEN' });
      const userId = ctx.auth.userId;
      const inserted = await db
        .insert(devices)
        .values({
          user_id: userId,
          name: input.deviceName,
          profile_id: input.profileId,
          token_hash: 'pending',
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const token = signDeviceToken(row.id, userId, input.profileId);
      const tokenHash = hashToken(token);
      await db.update(devices).set({ token_hash: tokenHash }).where(eq(devices.id, row.id));
      return { token, device: { id: row.id, name: row.name, profile_id: row.profile_id } };
    }),

  list: adminProcedure.query(async ({ ctx }) => {
    if (ctx.auth.kind !== 'user') throw new TRPCError({ code: 'FORBIDDEN' });
    const userId = ctx.auth.userId;
    const rows = await db
      .select({
        id: devices.id,
        name: devices.name,
        profile_id: devices.profile_id,
        last_seen_at: devices.last_seen_at,
        created_at: devices.created_at,
        revoked_at: devices.revoked_at,
      })
      .from(devices)
      .where(eq(devices.user_id, userId))
      .orderBy(desc(devices.created_at));
    return rows;
  }),

  rename: adminProcedure
    .input(z.object({ id: z.string().uuid(), name: z.string().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.auth.kind !== 'user') throw new TRPCError({ code: 'FORBIDDEN' });
      const userId = ctx.auth.userId;
      await db
        .update(devices)
        .set({ name: input.name })
        .where(and(eq(devices.id, input.id), eq(devices.user_id, userId)));
      return { success: true };
    }),

  revoke: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.auth.kind !== 'user') throw new TRPCError({ code: 'FORBIDDEN' });
      const userId = ctx.auth.userId;
      await db
        .update(devices)
        .set({ revoked_at: new Date() })
        .where(and(eq(devices.id, input.id), eq(devices.user_id, userId)));
      return { success: true };
    }),
});

// ── share links (Phase M scaffold) ───────────────────────────────────────────

const shareLinksRouter = t.router({
  create: adminProcedure
    .input(
      z.object({
        parent_entity_id: z.string().uuid().nullable().optional(),
        profile_id: z.string().min(1),
        workspace_id: z.string().min(1),
        label: z.string().max(120).optional(),
        scope: z.record(z.unknown()).default({}),
        can_upload: z.boolean().default(false),
        can_submit: z.boolean().default(false),
        expires_in_seconds: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const inserted = await db
        .insert(shareLinks)
        .values({
          parent_entity_id: input.parent_entity_id ?? null,
          profile_id: input.profile_id,
          workspace_id: input.workspace_id,
          label: input.label ?? '',
          token_hash: 'pending',
          scope: input.scope,
          can_upload: input.can_upload ? 1 : 0,
          can_submit: input.can_submit ? 1 : 0,
          expires_at: input.expires_in_seconds
            ? new Date(Date.now() + input.expires_in_seconds * 1000)
            : null,
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const token = signShareToken(row.id, input.expires_in_seconds);
      const tokenHash = hashToken(token);
      await db
        .update(shareLinks)
        .set({ token_hash: tokenHash })
        .where(eq(shareLinks.id, row.id));
      return { token, share: { id: row.id, expires_at: row.expires_at } };
    }),

  list: adminProcedure.query(async () => {
    const rows = await db
      .select({
        id: shareLinks.id,
        parent_entity_id: shareLinks.parent_entity_id,
        profile_id: shareLinks.profile_id,
        workspace_id: shareLinks.workspace_id,
        label: shareLinks.label,
        scope: shareLinks.scope,
        can_upload: shareLinks.can_upload,
        can_submit: shareLinks.can_submit,
        expires_at: shareLinks.expires_at,
        revoked_at: shareLinks.revoked_at,
        created_at: shareLinks.created_at,
      })
      .from(shareLinks)
      .where(isNull(shareLinks.revoked_at))
      .orderBy(desc(shareLinks.created_at));
    return rows;
  }),

  revoke: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await db
        .update(shareLinks)
        .set({ revoked_at: new Date() })
        .where(eq(shareLinks.id, input.id));
      return { success: true };
    }),
});

export const authRouter = t.router({
  login,
  ownerLogin,
  changePassword,
  me,
  users: usersRouter,
  devices: devicesRouter,
  shareLinks: shareLinksRouter,
});

export type AuthRouter = typeof authRouter;
