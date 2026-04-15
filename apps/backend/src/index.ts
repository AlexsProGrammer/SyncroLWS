// ── Env validation — MUST be the first import so the process crashes
// before any other module initialises with bad / missing config. ───────────────
import { env } from './config/env';

import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { randomUUID } from 'crypto';
import path from 'path';
import { appRouter } from './routes/trpc';
import { uploadRouter } from './routes/upload';

const app = express();
const PORT = env.PORT;

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors());

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── tRPC API ──────────────────────────────────────────────────────────────────
app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext: (): { requestId: string } => ({ requestId: randomUUID() }),
  }),
);

// ── File upload / delete ──────────────────────────────────────────────────────
app.use('/upload', uploadRouter);

// ── Client Portal (Phase 3) ───────────────────────────────────────────────────
const webDistPath = path.join(__dirname, 'web', 'dist');
app.use('/portal', express.static(webDistPath));
app.get('/portal/:projectId', (_req: Request, res: Response) => {
  res.sendFile(path.join(webDistPath, 'index.html'));
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[backend] Listening on http://localhost:${PORT}`);
});

export { app, appRouter };
export type { AppRouter } from './routes/trpc';
