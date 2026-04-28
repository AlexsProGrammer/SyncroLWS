import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { eq, isNull, and } from 'drizzle-orm';
import { db } from '../db/client';
import { baseEntities } from '../db/schema';
import { BaseEntitySchema } from '@syncrohws/shared-types';
import { randomUUID } from 'crypto';
import { t, publicProcedure, protectedProcedure } from '../trpc';
import { authRouter } from './auth';

const baseEntityRouter = t.router({
  list: protectedProcedure
    .input(
      z.object({
        type: BaseEntitySchema.shape.type.optional(),
        parent_id: z.string().uuid().nullable().optional(),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ input }) => {
      const conditions = [isNull(baseEntities.deleted_at)];
      if (input.type) conditions.push(eq(baseEntities.type, input.type));
      if (input.parent_id !== undefined) {
        if (input.parent_id === null) {
          conditions.push(isNull(baseEntities.parent_id));
        } else {
          conditions.push(eq(baseEntities.parent_id, input.parent_id));
        }
      }
      return db
        .select()
        .from(baseEntities)
        .where(and(...conditions))
        .limit(input.limit)
        .offset(input.offset);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const rows = await db
        .select()
        .from(baseEntities)
        .where(and(eq(baseEntities.id, input.id), isNull(baseEntities.deleted_at)))
        .limit(1);
      if (!rows[0]) throw new TRPCError({ code: 'NOT_FOUND' });
      return rows[0];
    }),

  upsert: protectedProcedure
    .input(BaseEntitySchema)
    .mutation(async ({ input }) => {
      const now = new Date().toISOString();
      const insertRow = {
        id: input.id ?? randomUUID(),
        type: input.type,
        payload: input.payload,
        metadata: input.metadata ?? {},
        tags: input.tags ?? [],
        parent_id: input.parent_id ?? null,
        created_at: new Date(input.created_at),
        updated_at: new Date(now),
        deleted_at: input.deleted_at ? new Date(input.deleted_at) : null,
      };
      const { created_at: _omit, ...updateRow } = insertRow;
      await db
        .insert(baseEntities)
        .values(insertRow)
        .onConflictDoUpdate({ target: baseEntities.id, set: updateRow });
      return insertRow;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid(), hard: z.boolean().default(false) }))
    .mutation(async ({ input }) => {
      if (input.hard) {
        await db.delete(baseEntities).where(eq(baseEntities.id, input.id));
      } else {
        await db
          .update(baseEntities)
          .set({ deleted_at: new Date() })
          .where(eq(baseEntities.id, input.id));
      }
      return { success: true };
    }),
});

export const appRouter = t.router({
  auth: authRouter,
  entities: baseEntityRouter,
  health: publicProcedure.query(() => ({
    status: 'ok' as const,
    timestamp: new Date().toISOString(),
  })),
});

export type AppRouter = typeof appRouter;

export { t };
