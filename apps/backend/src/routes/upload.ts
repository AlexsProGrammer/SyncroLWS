import type { Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import multer from 'multer';
import { createHash } from 'crypto';
import path from 'path';
import fse from 'fs-extra';
import { z } from 'zod';
import { Client as MinioClient } from 'minio';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '../db/client';
import { files } from '../db/schema';
import { env } from '../config/env';
import { t, protectedProcedure } from '../trpc';

// ── MinIO client ──────────────────────────────────────────────────────────────
const minioUrl = new URL(env.MINIO_URL);
const minio = new MinioClient({
  endPoint: minioUrl.hostname,
  port: parseInt(minioUrl.port) || (minioUrl.protocol === 'https:' ? 443 : 9000),
  useSSL: minioUrl.protocol === 'https:',
  accessKey: env.MINIO_ACCESS_KEY,
  secretKey: env.MINIO_SECRET_KEY,
});

const BUCKET = env.MINIO_BUCKET;

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

// ── Chunked upload tRPC procedures (Phase 4) ──────────────────────────────────
//
// Three-step protocol:
//   1. upload.initChunked  — declare the file (hash + size + chunk count).
//   2. upload.pushChunk    — stream each base64-encoded slice (0-indexed).
//   3. upload.finalizeChunked — verify SHA-256, push to MinIO, update DB.
//
// DSGVO: staging files under /tmp/syncro_staging/ are deleted immediately
// after finalization (or on hash mismatch) — no residual data left on disk.

const STAGING_DIR = path.join('/tmp', 'syncro_staging');

/** SHA-256 hex guard — also prevents path traversal via the hash parameter. */
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

interface ChunkMeta {
  total_size: number;
  mime_type: string;
  chunk_count: number;
  received_indices: Set<number>;
}

/** In-process registry of in-flight chunked uploads keyed by content hash. */
const chunkStore = new Map<string, ChunkMeta>();

function stagingFilePath(hash: string): string {
  return path.join(STAGING_DIR, hash);
}

// ── Step 4.1 / 4.2 — upload.initChunked ──────────────────────────────────────
const initChunkedProcedure = protectedProcedure
  .input(
    z.object({
      hash: z.string().regex(SHA256_HEX_RE, 'hash must be a valid SHA-256 hex string'),
      total_size: z.number().int().positive(),
      mime_type: z.string().min(1),
      chunk_count: z.number().int().positive(),
    }),
  )
  .mutation(async ({ input }) => {
    await fse.ensureDir(STAGING_DIR);
    // Remove any stale staging file from a previous failed attempt (DSGVO sweep).
    await fse.remove(stagingFilePath(input.hash));
    chunkStore.set(input.hash, {
      total_size: input.total_size,
      mime_type: input.mime_type,
      chunk_count: input.chunk_count,
      received_indices: new Set(),
    });
    return { staging_id: input.hash, ready: true };
  });

// ── Step 4.1 / 4.3 — upload.pushChunk ────────────────────────────────────────
const pushChunkProcedure = protectedProcedure
  .input(
    z.object({
      hash: z.string().regex(SHA256_HEX_RE, 'hash must be a valid SHA-256 hex string'),
      chunk_index: z.number().int().min(0),
      /** Base64-encoded binary payload for this chunk. */
      data: z.string().min(1),
    }),
  )
  .mutation(async ({ input }) => {
    const meta = chunkStore.get(input.hash);
    if (!meta) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Upload session not found. Call upload.initChunked first.',
      });
    }
    if (input.chunk_index >= meta.chunk_count) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `chunk_index ${input.chunk_index} exceeds declared chunk_count ${meta.chunk_count}.`,
      });
    }
    const bytes = Buffer.from(input.data, 'base64');
    // Append binary block onto the staging file for this upload.
    await fse.appendFile(stagingFilePath(input.hash), bytes);
    meta.received_indices.add(input.chunk_index);
    return { chunk_index: input.chunk_index, received: true };
  });

// ── Step 4.1 / 4.4 — upload.finalizeChunked ──────────────────────────────────
const finalizeChunkedProcedure = protectedProcedure
  .input(
    z.object({
      hash: z.string().regex(SHA256_HEX_RE, 'hash must be a valid SHA-256 hex string'),
    }),
  )
  .mutation(async ({ input }) => {
    const meta = chunkStore.get(input.hash);
    if (!meta) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Upload session not found.',
      });
    }

    const filePath = stagingFilePath(input.hash);

    // Read the assembled staging file.
    let fileBuffer: Buffer;
    try {
      fileBuffer = await fse.readFile(filePath);
    } catch {
      chunkStore.delete(input.hash);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Staging file missing — upload may be incomplete.',
      });
    }

    // Step 4.4 — Verify SHA-256 signature using Node's native crypto module.
    const computedHash = createHash('sha256').update(fileBuffer).digest('hex');
    if (computedHash !== input.hash) {
      // DSGVO: discard corrupted data immediately on mismatch.
      await fse.remove(filePath);
      chunkStore.delete(input.hash);
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'SHA-256 signature mismatch — assembled file is corrupt.',
      });
    }

    const objectKey = `files/${input.hash}`;
    const minioPath = `${BUCKET}/${objectKey}`;

    // Check deduplication — avoid re-uploading an already-stored artifact.
    const existing = await db
      .select()
      .from(files)
      .where(eq(files.hash, input.hash))
      .limit(1);

    let deduplicated: boolean;
    let reference_count: number;

    if (existing[0]) {
      // Deduplication hit: increment reference_count, skip MinIO upload.
      deduplicated = true;
      reference_count = existing[0].reference_count + 1;
      await db
        .update(files)
        .set({ reference_count })
        .where(eq(files.hash, input.hash));
    } else {
      // New artifact: push binary into MinIO bucket, then record in DB.
      await minio.putObject(
        BUCKET,
        objectKey,
        fileBuffer,
        fileBuffer.length,
        { 'Content-Type': meta.mime_type },
      );
      await db.insert(files).values({
        hash: input.hash,
        minio_path: minioPath,
        mime_type: meta.mime_type,
        size_bytes: fileBuffer.length,
        reference_count: 1,
      });
      deduplicated = false;
      reference_count = 1;
    }

    // DSGVO: sweep staging file from disk immediately after successful finalization.
    await fse.remove(filePath);
    chunkStore.delete(input.hash);

    return { hash: input.hash, minio_path: minioPath, deduplicated, reference_count };
  });

// ── tRPC router export ────────────────────────────────────────────────────────
export const uploadTrpcRouter = t.router({
  initChunked: initChunkedProcedure,
  pushChunk: pushChunkProcedure,
  finalizeChunked: finalizeChunkedProcedure,
});
