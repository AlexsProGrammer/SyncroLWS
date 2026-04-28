import { initTRPC, TRPCError } from '@trpc/server';
import type { TRPCContext, AuthContext } from '@syncrohws/shared-types';

const t = initTRPC.context<TRPCContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * Phase P — Procedure that allows ONLY a `pw_change_only`-scoped user token
 * OR a full-scope user token. Used by `auth.changePassword` so the forced
 * first-login pw-change flow can succeed.
 */
export const pwChangeProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.auth.kind !== 'user') {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required.' });
  }
  return next({ ctx: { ...ctx, auth: ctx.auth } });
});

/**
 * Authenticated procedure — full-scope user token OR device token. Used for
 * sync / general routes. `pw_change_only` tokens are explicitly rejected
 * here so a half-authenticated user cannot read or write anything beyond
 * their own password change.
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  const a = ctx.auth;
  if (a.kind === 'user') {
    if (a.scope !== 'full') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Password change required before continuing.',
      });
    }
    return next({ ctx: { ...ctx, auth: a as AuthContext } });
  }
  if (a.kind === 'device') {
    return next({ ctx: { ...ctx, auth: a as AuthContext } });
  }
  throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required.' });
});

/**
 * Phase P — admin-only procedure. Used for user management, audit log, and
 * device-pair / share-link admin (legacy `ownerProcedure` callers).
 */
export const adminProcedure = t.procedure.use(({ ctx, next }) => {
  const a = ctx.auth;
  if (a.kind !== 'user' || a.scope !== 'full' || a.orgRole !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin credentials required.' });
  }
  return next({ ctx: { ...ctx, auth: a } });
});

/** @deprecated Phase P — kept as alias of {@link adminProcedure} for any
 *  external code still importing the old name. */
export const ownerProcedure = adminProcedure;

export { t };
