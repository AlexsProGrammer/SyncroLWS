// ── Env validation — MUST be the first import so the process crashes
// before any other module initialises with bad / missing config. ───────────────
import { env } from './config/env';

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { randomUUID } from 'crypto';
import path from 'path';
import { eq } from 'drizzle-orm';
import { appRouter } from './routes/trpc';
import { uploadRouter } from './routes/upload';
import { portalRouter } from './routes/portal';
import { shareAdminRouter } from './routes/share-admin';
import { bootstrapAdmin } from './bootstrap';
import { db } from './db/client';
import { devices, shareLinks, users } from './db/schema';
import { hashToken, parseBearer, verifyToken } from './auth';
import type { AuthContext, TRPCContext } from '@syncrohws/shared-types';

const app = express();
const PORT = env.PORT;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

async function resolveAuth(authHeader: string | undefined): Promise<AuthContext> {
  const token = parseBearer(authHeader);
  if (!token) return { kind: 'anonymous' };
  const decoded = verifyToken(token);
  if (!decoded) return { kind: 'anonymous' };

  if (decoded.kind === 'user') {
    // Re-validate the user row each request (cheap; lets us enforce
    // disable / role-change without waiting for token expiry).
    const rows = await db.select().from(users).where(eq(users.id, decoded.sub)).limit(1);
    const row = rows[0];
    if (!row || row.disabled_at) return { kind: 'anonymous' };
    const orgRole = row.org_role === 'admin' ? 'admin' : 'member';
    const scope = decoded.scope === 'pw_change_only' ? 'pw_change_only' : 'full';
    // If the server still flags must_change_password but the token claims
    // full scope (e.g. issued before the flag was re-set), force pw_change.
    const effectiveScope = row.must_change_password ? 'pw_change_only' : scope;
    return {
      kind: 'user',
      userId: row.id,
      orgRole,
      scope: effectiveScope,
      email: row.email,
      displayName: row.display_name,
    };
  }

  if (decoded.kind === 'device') {
    const tokenHash = hashToken(token);
    const rows = await db.select().from(devices).where(eq(devices.id, decoded.sub)).limit(1);
    const row = rows[0];
    if (!row || row.revoked_at || row.token_hash !== tokenHash) {
      return { kind: 'anonymous' };
    }
    db.update(devices)
      .set({ last_seen_at: new Date() })
      .where(eq(devices.id, row.id))
      .catch(() => { /* ignore */ });
    return {
      kind: 'device',
      deviceId: row.id,
      userId: row.user_id,
      profileId: row.profile_id,
    };
  }

  if (decoded.kind === 'share') {
    const tokenHash = hashToken(token);
    const rows = await db
      .select()
      .from(shareLinks)
      .where(eq(shareLinks.id, decoded.sub))
      .limit(1);
    const row = rows[0];
    if (!row || row.revoked_at || row.token_hash !== tokenHash) {
      return { kind: 'anonymous' };
    }
    if (row.expires_at && row.expires_at.getTime() < Date.now()) {
      return { kind: 'anonymous' };
    }
    return { kind: 'share', shareId: row.id };
  }

  return { kind: 'anonymous' };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

async function attachAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  req.auth = await resolveAuth(req.header('authorization'));
  next();
}

function requireOwnerOrDevice(req: Request, res: Response, next: NextFunction): void {
  const a = req.auth;
  if (!a) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (a.kind === 'user' && a.scope === 'full') return next();
  if (a.kind === 'device') return next();
  res.status(401).json({ error: 'Authentication required.' });
}

app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext: async ({ req }): Promise<TRPCContext> => ({
      requestId: randomUUID(),
      auth: await resolveAuth(req.header('authorization')),
      ipAddr: (req.ip ?? req.socket.remoteAddress ?? '').toString() || undefined,
    }),
  }),
);

app.use('/upload', attachAuth, requireOwnerOrDevice, uploadRouter);

// Phase M — owner-managed share-link admin (REST mirror of the
// `auth.shareLinks` tRPC router for the desktop UI's plain-fetch path).
app.use('/share-links', attachAuth, requireOwnerOrDevice, shareAdminRouter);

// Phase M — public client portal API (token-gated via share JWT, validated
// inside the router itself).
app.use('/portal-api', portalRouter);

const webDistPath = path.join(__dirname, 'web', 'dist');
app.use('/portal', express.static(webDistPath));
app.get('/portal/:projectId', (_req: Request, res: Response) => {
  res.sendFile(path.join(webDistPath, 'index.html'));
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

bootstrapAdmin()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[backend] Listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[backend] Bootstrap failed:', err);
    process.exit(1);
  });

export { app, appRouter };
export type { AppRouter } from './routes/trpc';
