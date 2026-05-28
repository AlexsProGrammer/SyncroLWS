import { t, publicProcedure } from '../trpc';
import { authRouter } from './auth';
import { syncRouter } from './sync';
import { uploadTrpcRouter } from './upload';

export const appRouter = t.router({
  auth: authRouter,
  sync: syncRouter,
  upload: uploadTrpcRouter,
  health: publicProcedure.query(() => ({
    status: 'ok' as const,
    timestamp: new Date().toISOString(),
  })),
});

export type AppRouter = typeof appRouter;

export { t };
