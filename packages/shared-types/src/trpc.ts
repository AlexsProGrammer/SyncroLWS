import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { BaseEntitySchema } from './base-entity';

/**
 * tRPC context shape — populated per-request in apps/backend.
 * Exported so the desktop client can mirror the same type.
 */
export interface TRPCContext {
  requestId: string;
}

const t = initTRPC.context<TRPCContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

// ── Base Entity Router ────────────────────────────────────────────────────────

export const baseEntityRouter = router({
  list: publicProcedure
    .input(
      z.object({
        type: BaseEntitySchema.shape.type.optional(),
        parent_id: z.string().uuid().nullable().optional(),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async () => {
      // Implementation lives in apps/backend
      return [] as never;
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async () => {
      return null as never;
    }),

  upsert: publicProcedure
    .input(BaseEntitySchema)
    .mutation(async () => {
      return null as never;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid(), hard: z.boolean().default(false) }))
    .mutation(async () => {
      return { success: true };
    }),
});

export type BaseEntityRouter = typeof baseEntityRouter;

// ── App Router ────────────────────────────────────────────────────────────────

export const appRouter = router({
  entities: baseEntityRouter,
});

export type AppRouter = typeof appRouter;
