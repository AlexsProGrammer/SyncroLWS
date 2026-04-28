/**
 * Phase M — token-gated client portal API.
 *
 * Endpoints (mounted under `/portal-api`):
 *   GET  /me            — resolve share token, return scope + permissions.
 *   GET  /data          — return all entities (cores + aspects + relations) under
 *                         the share's workspace, optionally filtered to a parent
 *                         project subtree if `share_links.parent_entity_id` is set.
 *   GET  /file/:hash    — proxy a content-addressed file from MinIO (presigned).
 *   POST /upload        — multipart/form-data file upload (requires `can_upload`).
 *   POST /submit        — create a `note` entity scoped under the share's
 *                         project (requires `can_submit`).
 *
 * Auth: share JWT provided as `Authorization: Bearer <token>` OR `?token=<t>`
 * query param (so the SPA can build href-able URLs to e.g. file downloads).
 */
import type { Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import multer from 'multer';
import { createHash, randomUUID } from 'crypto';
import { Client as MinioClient } from 'minio';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import {
  baseEntities,
  entityAspects,
  entityRelations,
  files,
  shareLinks,
  type ShareLinkRow,
} from '../db/schema';
import { env } from '../config/env';
import { hashToken, parseBearer, verifyToken } from '../auth';

// ── MinIO ────────────────────────────────────────────────────────────────────
const minioUrl = new URL(env.MINIO_URL);
const minio = new MinioClient({
  endPoint: minioUrl.hostname,
  port: parseInt(minioUrl.port) || (minioUrl.protocol === 'https:' ? 443 : 9000),
  useSSL: minioUrl.protocol === 'https:',
  accessKey: env.MINIO_ACCESS_KEY,
  secretKey: env.MINIO_SECRET_KEY,
});
const BUCKET = env.MINIO_BUCKET;

// ── Token resolution ─────────────────────────────────────────────────────────

interface PortalAuth {
  share: ShareLinkRow;
}

async function resolveShareToken(req: Request): Promise<PortalAuth | null> {
  const token =
    parseBearer(req.header('authorization')) ??
    (typeof req.query.token === 'string' ? req.query.token : null);
  if (!token) return null;
  const decoded = verifyToken(token);
  if (!decoded || decoded.kind !== 'share') return null;

  const tokenHash = hashToken(token);
  const rows = await db
    .select()
    .from(shareLinks)
    .where(eq(shareLinks.id, decoded.sub))
    .limit(1);
  const row = rows[0];
  if (!row || row.revoked_at || row.token_hash !== tokenHash) return null;
  if (row.expires_at && row.expires_at.getTime() < Date.now()) return null;
  return { share: row };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      portal?: PortalAuth;
    }
  }
}

async function requireShare(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = await resolveShareToken(req);
  if (!auth) {
    res.status(401).json({ error: 'Invalid or expired share link.' });
    return;
  }
  req.portal = auth;
  next();
}

// ── Subtree resolution helpers ───────────────────────────────────────────────

/**
 * If the share is scoped to `parent_entity_id`, walk the `parent_id` graph
 * to collect every descendant entity id. Otherwise return null (= no filter,
 * full workspace visible).
 */
async function resolveVisibleEntityIds(share: ShareLinkRow): Promise<Set<string> | null> {
  if (!share.parent_entity_id) return null;
  const result = new Set<string>([share.parent_entity_id]);
  let frontier: string[] = [share.parent_entity_id];
  while (frontier.length > 0) {
    const rows = await db
      .select({ id: baseEntities.id })
      .from(baseEntities)
      .where(
        and(
          eq(baseEntities.profile_id, share.profile_id),
          eq(baseEntities.workspace_id, share.workspace_id),
          isNull(baseEntities.deleted_at),
          // Drizzle inArray over `parent_id` (uuid) — we use raw SQL to keep
          // this type-clean across versions.
          sql`${baseEntities.parent_id} = ANY(${frontier as unknown as string[]}::uuid[])`,
        ),
      );
    const next: string[] = [];
    for (const r of rows) {
      if (!result.has(r.id)) {
        result.add(r.id);
        next.push(r.id);
      }
    }
    frontier = next;
  }
  return result;
}

// ── Router ──────────────────────────────────────────────────────────────────

export const portalRouter = Router();

portalRouter.use(requireShare);

// GET /portal-api/me
portalRouter.get('/me', (req: Request, res: Response): void => {
  const s = req.portal!.share;
  res.json({
    id: s.id,
    label: s.label,
    profile_id: s.profile_id,
    workspace_id: s.workspace_id,
    parent_entity_id: s.parent_entity_id,
    can_upload: !!s.can_upload,
    can_submit: !!s.can_submit,
    expires_at: s.expires_at,
  });
});

// GET /portal-api/data
portalRouter.get('/data', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const share = req.portal!.share;
    const visibleIds = await resolveVisibleEntityIds(share);

    const cores = await db
      .select()
      .from(baseEntities)
      .where(
        and(
          eq(baseEntities.profile_id, share.profile_id),
          eq(baseEntities.workspace_id, share.workspace_id),
          isNull(baseEntities.deleted_at),
        ),
      );
    const filteredCores = visibleIds ? cores.filter((c) => visibleIds.has(c.id)) : cores;
    const visibleSet = new Set(filteredCores.map((c) => c.id));

    const aspectsAll = await db
      .select()
      .from(entityAspects)
      .where(
        and(
          eq(entityAspects.profile_id, share.profile_id),
          eq(entityAspects.workspace_id, share.workspace_id),
          isNull(entityAspects.deleted_at),
        ),
      );
    const aspects = aspectsAll.filter((a) => visibleSet.has(a.entity_id));

    const relationsAll = await db
      .select()
      .from(entityRelations)
      .where(
        and(
          eq(entityRelations.profile_id, share.profile_id),
          eq(entityRelations.workspace_id, share.workspace_id),
        ),
      );
    const relations = relationsAll.filter(
      (r) => visibleSet.has(r.from_entity_id) && visibleSet.has(r.to_entity_id),
    );

    res.json({ cores: filteredCores, aspects, relations });
  } catch (err) {
    next(err);
  }
});

// GET /portal-api/file/:hash → presigned MinIO URL redirect.
portalRouter.get(
  '/file/:hash',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { hash } = req.params as { hash: string };
      // Confirm the file is referenced by an aspect inside this share's scope.
      const share = req.portal!.share;
      const visibleIds = await resolveVisibleEntityIds(share);
      const refRows = await db
        .select({ entity_id: entityAspects.entity_id })
        .from(entityAspects)
        .where(
          and(
            eq(entityAspects.profile_id, share.profile_id),
            eq(entityAspects.workspace_id, share.workspace_id),
            sql`${entityAspects.data}->>'hash' = ${hash}`,
          ),
        );
      const allowed = refRows.some((r) => !visibleIds || visibleIds.has(r.entity_id));
      if (!allowed) {
        res.status(404).json({ error: 'File not in scope.' });
        return;
      }
      const fileRows = await db.select().from(files).where(eq(files.hash, hash)).limit(1);
      const file = fileRows[0];
      if (!file) {
        res.status(404).json({ error: 'File not found.' });
        return;
      }
      const objectKey = `files/${hash}`;
      const url = await minio.presignedGetObject(BUCKET, objectKey, 60 * 5);
      res.redirect(url);
    } catch (err) {
      next(err);
    }
  },
);

// POST /portal-api/upload  (requires can_upload)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
portalRouter.post(
  '/upload',
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const share = req.portal!.share;
      if (!share.can_upload) {
        res.status(403).json({ error: 'Upload not permitted by share link.' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'No file provided.' });
        return;
      }
      const hash = createHash('sha256').update(req.file.buffer).digest('hex');
      const objectKey = `files/${hash}`;

      const existing = await db.select().from(files).where(eq(files.hash, hash)).limit(1);
      if (existing[0]) {
        await db
          .update(files)
          .set({ reference_count: existing[0].reference_count + 1 })
          .where(eq(files.hash, hash));
        res.json({ hash, deduplicated: true });
        return;
      }
      await minio.putObject(
        BUCKET,
        objectKey,
        req.file.buffer,
        req.file.size,
        { 'Content-Type': req.file.mimetype },
      );
      const minioPath = `${BUCKET}/${objectKey}`;
      await db.insert(files).values({
        hash,
        minio_path: minioPath,
        mime_type: req.file.mimetype,
        size_bytes: req.file.size,
        reference_count: 1,
      });
      res.status(201).json({
        hash,
        deduplicated: false,
        size_bytes: req.file.size,
        mime_type: req.file.mimetype,
        original_name: req.file.originalname,
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /portal-api/submit  (requires can_submit). Creates a note scoped to
// the share's project (parent_entity_id).
const submitSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(50_000).default(''),
});

portalRouter.post(
  '/submit',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const share = req.portal!.share;
      if (!share.can_submit) {
        res.status(403).json({ error: 'Submit not permitted by share link.' });
        return;
      }
      const parsed = submitSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid payload.', details: parsed.error.format() });
        return;
      }

      const now = new Date();
      const coreId = randomUUID();
      const aspectId = randomUUID();
      const revQ = sql<bigint>`nextval('sync_revision')`;

      await db.insert(baseEntities).values({
        id: coreId,
        profile_id: share.profile_id,
        workspace_id: share.workspace_id,
        title: parsed.data.title,
        description: '',
        color: '#6366f1',
        icon: 'note',
        tags: [],
        parent_id: share.parent_entity_id ?? null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        revision: revQ as unknown as number,
        last_modified_by_device: null,
      });
      await db.insert(entityAspects).values({
        id: aspectId,
        entity_id: coreId,
        profile_id: share.profile_id,
        workspace_id: share.workspace_id,
        aspect_type: 'note',
        data: { content_md: parsed.data.body, source: 'portal-submit' },
        sort_order: 0,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        revision: revQ as unknown as number,
        last_modified_by_device: null,
      });

      res.status(201).json({ id: coreId });
    } catch (err) {
      next(err);
    }
  },
);
