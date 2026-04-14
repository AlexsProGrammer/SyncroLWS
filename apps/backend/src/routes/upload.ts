import type { Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import multer from 'multer';
import { createHash } from 'crypto';
import { Client as MinioClient } from 'minio';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { files } from '../db/schema';

// ── MinIO client ──────────────────────────────────────────────────────────────
const minio = new MinioClient({
  endPoint: process.env['MINIO_ENDPOINT'] ?? 'localhost',
  port: parseInt(process.env['MINIO_PORT'] ?? '9000'),
  useSSL: process.env['MINIO_USE_SSL'] === 'true',
  accessKey: process.env['MINIO_ACCESS_KEY'] ?? 'syncrohws',
  secretKey: process.env['MINIO_SECRET_KEY'] ?? 'syncrohws_secret',
});

const BUCKET = process.env['MINIO_BUCKET'] ?? 'syncrohws-files';

async function ensureBucket(): Promise<void> {
  const exists = await minio.bucketExists(BUCKET);
  if (!exists) await minio.makeBucket(BUCKET);
}

ensureBucket().catch(console.error);

// ── multer v2 (memory storage so we can hash before writing) ──────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
});

// ── Router ────────────────────────────────────────────────────────────────────
export const uploadRouter = Router();

uploadRouter.post(
  '/',
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file provided.' });
        return;
      }

      // 1. Compute SHA-256 hash of raw bytes
      const hash = createHash('sha256').update(req.file.buffer).digest('hex');
      const objectKey = `files/${hash}`;

      // 2. Check DB for existing reference
      const existing = await db
        .select()
        .from(files)
        .where(eq(files.hash, hash))
        .limit(1);

      if (existing[0]) {
        // Deduplication hit — increment reference count only
        await db
          .update(files)
          .set({ reference_count: existing[0].reference_count + 1 })
          .where(eq(files.hash, hash));

        res.json({
          hash,
          minio_path: existing[0].minio_path,
          deduplicated: true,
          reference_count: existing[0].reference_count + 1,
        });
        return;
      }

      // 3. New file — upload to MinIO
      await minio.putObject(
        BUCKET,
        objectKey,
        req.file.buffer,
        req.file.size,
        { 'Content-Type': req.file.mimetype },
      );

      // 4. Insert into DB with reference_count = 1
      const minioPath = `${BUCKET}/${objectKey}`;
      await db.insert(files).values({
        hash,
        minio_path: minioPath,
        mime_type: req.file.mimetype,
        size_bytes: req.file.size,
        reference_count: 1,
      });

      res.status(201).json({ hash, minio_path: minioPath, deduplicated: false, reference_count: 1 });
    } catch (err) {
      next(err);
    }
  },
);

/** Decrement reference count. Physically deletes when count reaches 0. */
uploadRouter.delete(
  '/:hash',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { hash } = req.params as { hash: string };
      const rows = await db.select().from(files).where(eq(files.hash, hash)).limit(1);

      if (!rows[0]) {
        res.status(404).json({ error: 'File not found.' });
        return;
      }

      const newCount = rows[0].reference_count - 1;

      if (newCount <= 0) {
        // Physically remove from MinIO and DB
        const objectKey = `files/${hash}`;
        await minio.removeObject(BUCKET, objectKey);
        await db.delete(files).where(eq(files.hash, hash));
        res.json({ hash, deleted: true, reference_count: 0 });
      } else {
        await db
          .update(files)
          .set({ reference_count: newCount })
          .where(eq(files.hash, hash));
        res.json({ hash, deleted: false, reference_count: newCount });
      }
    } catch (err) {
      next(err);
    }
  },
);
