import { initTRPC, TRPCError } from '@trpc/server';
import type { TRPCContext, AuthContext } from '@syncrohws/shared-types';

const t = initTRPC.context<TRPCContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * Authenticated procedure — owner or device JWT required. Used for sync /
 * entity routes which both desktop clients and the owner UI need to hit.
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.auth.kind !== 'owner' && ctx.auth.kind !== 'device') {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required.' });
  }
  return next({ ctx: { ...ctx, auth: ctx.auth as AuthContext } });
});

/**
 * Owner-only procedure — for device pairing, share-link management, etc.
 */
export const ownerProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.auth.kind !== 'owner') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Owner credentials required.' });
  }
  return next({ ctx: { ...ctx, auth: ctx.auth } });
});

export { t };
