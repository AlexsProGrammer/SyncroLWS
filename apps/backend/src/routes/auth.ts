/**
 * Phase H — Auth tRPC router.
 *
 * Routes:
 *   auth.ownerLogin            — public; password → owner JWT.
 *   auth.me                    — protected; returns current auth context.
 *   auth.devices.pair          — owner-only; mints long-lived device JWT.
 *   auth.devices.list          — owner-only; lists non-revoked devices.
 *   auth.devices.rename        — owner-only.
 *   auth.devices.revoke        — owner-only.
 *   auth.shareLinks.create     — owner-only; mints share JWT (Phase M).
 *   auth.shareLinks.list       — owner-only.
 *   auth.shareLinks.revoke     — owner-only.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { devices, owner, shareLinks } from '../db/schema';
import {
  hashPassword,
  hashToken,
  signDeviceToken,
  signOwnerToken,
  signShareToken,
  verifyPassword,
} from '../auth';
import { t, ownerProcedure, protectedProcedure, publicProcedure } from '../trpc';

// ── owner login / bootstrap ──────────────────────────────────────────────────

const ownerLogin = publicProcedure
  .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
  .mutation(async ({ input }) => {
    const rows = await db
      .select()
      .from(owner)
      .where(eq(owner.email, input.email))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid credentials.' });
    }
    const ok = await verifyPassword(input.password, row.password_hash);
    if (!ok) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid credentials.' });
    }
    const token = signOwnerToken(row.id);
    return { token, owner: { id: row.id, email: row.email } };
  });

// ── me ───────────────────────────────────────────────────────────────────────

const me = protectedProcedure.query(({ ctx }) => ({ auth: ctx.auth }));

// ── devices ──────────────────────────────────────────────────────────────────

const devicesRouter = t.router({
  pair: ownerProcedure
    .input(
      z.object({
        deviceName: z.string().min(1).max(120),
        profileId: z.string().min(1).max(120),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ownerId = ctx.auth.kind === 'owner' ? ctx.auth.ownerId : null;
      if (!ownerId) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const inserted = await db
        .insert(devices)
        .values({
          owner_id: ownerId,
          name: input.deviceName,
          profile_id: input.profileId,
          token_hash: 'pending',
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const token = signDeviceToken(row.id, ownerId, input.profileId);
      const tokenHash = hashToken(token);
      await db.update(devices).set({ token_hash: tokenHash }).where(eq(devices.id, row.id));
      return { token, device: { id: row.id, name: row.name, profile_id: row.profile_id } };
    }),

  list: ownerProcedure.query(async ({ ctx }) => {
    const ownerId = ctx.auth.kind === 'owner' ? ctx.auth.ownerId : null;
    if (!ownerId) throw new TRPCError({ code: 'FORBIDDEN' });
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
      .where(eq(devices.owner_id, ownerId))
      .orderBy(desc(devices.created_at));
    return rows;
  }),

  rename: ownerProcedure
    .input(z.object({ id: z.string().uuid(), name: z.string().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const ownerId = ctx.auth.kind === 'owner' ? ctx.auth.ownerId : null;
      if (!ownerId) throw new TRPCError({ code: 'FORBIDDEN' });
      await db
        .update(devices)
        .set({ name: input.name })
        .where(and(eq(devices.id, input.id), eq(devices.owner_id, ownerId)));
      return { success: true };
    }),

  revoke: ownerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const ownerId = ctx.auth.kind === 'owner' ? ctx.auth.ownerId : null;
      if (!ownerId) throw new TRPCError({ code: 'FORBIDDEN' });
      await db
        .update(devices)
        .set({ revoked_at: new Date() })
        .where(and(eq(devices.id, input.id), eq(devices.owner_id, ownerId)));
      return { success: true };
    }),
});

// ── share links (Phase M scaffold) ───────────────────────────────────────────

const shareLinksRouter = t.router({
  create: ownerProcedure
    .input(
      z.object({
        parent_entity_id: z.string().uuid().nullable().optional(),
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

  list: ownerProcedure.query(async () => {
    const rows = await db
      .select({
        id: shareLinks.id,
        parent_entity_id: shareLinks.parent_entity_id,
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

  revoke: ownerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await db
        .update(shareLinks)
        .set({ revoked_at: new Date() })
        .where(eq(shareLinks.id, input.id));
      return { success: true };
    }),
});

// ── owner password change ────────────────────────────────────────────────────

const changePassword = ownerProcedure
  .input(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) }))
  .mutation(async ({ ctx, input }) => {
    const ownerId = ctx.auth.kind === 'owner' ? ctx.auth.ownerId : null;
    if (!ownerId) throw new TRPCError({ code: 'FORBIDDEN' });
    const rows = await db.select().from(owner).where(eq(owner.id, ownerId)).limit(1);
    const row = rows[0];
    if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
    const ok = await verifyPassword(input.currentPassword, row.password_hash);
    if (!ok) throw new TRPCError({ code: 'UNAUTHORIZED' });
    const hash = await hashPassword(input.newPassword);
    await db.update(owner).set({ password_hash: hash }).where(eq(owner.id, ownerId));
    return { success: true };
  });

export const authRouter = t.router({
  ownerLogin,
  me,
  changePassword,
  devices: devicesRouter,
  shareLinks: shareLinksRouter,
});

export type AuthRouter = typeof authRouter;
