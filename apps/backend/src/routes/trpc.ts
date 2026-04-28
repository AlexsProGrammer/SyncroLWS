import { t, publicProcedure } from '../trpc';
import { authRouter } from './auth';
import { syncRouter } from './sync';

export const appRouter = t.router({
  auth: authRouter,
  sync: syncRouter,
  health: publicProcedure.query(() => ({
    status: 'ok' as const,
    timestamp: new Date().toISOString(),
  })),
});

export type AppRouter = typeof appRouter;

export { t };
