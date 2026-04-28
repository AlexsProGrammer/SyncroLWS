/**
 * Phase M — owner-facing REST endpoints for managing share links.
 *
 * Mirrors the `auth.shareLinks` tRPC router, but exposed as plain JSON over
 * HTTP so the desktop UI can call it with `fetch` (matching the existing
 * pattern used by /sync and /upload). Auth: owner OR device JWT.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { shareLinks } from '../db/schema';
import { hashToken, signShareToken } from '../auth';

export const shareAdminRouter = Router();

const createSchema = z.object({
  parent_entity_id: z.string().uuid().nullable().optional(),
  profile_id: z.string().min(1),
  workspace_id: z.string().min(1),
  label: z.string().max(120).optional(),
  scope: z.record(z.unknown()).optional(),
  can_upload: z.boolean().optional(),
  can_submit: z.boolean().optional(),
  expires_in_seconds: z.number().int().positive().optional(),
});

shareAdminRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload.', details: parsed.error.format() });
      return;
    }
    const input = parsed.data;
    const inserted = await db
      .insert(shareLinks)
      .values({
        parent_entity_id: input.parent_entity_id ?? null,
        profile_id: input.profile_id,
        workspace_id: input.workspace_id,
        label: input.label ?? '',
        token_hash: 'pending',
        scope: input.scope ?? {},
        can_upload: input.can_upload ? 1 : 0,
        can_submit: input.can_submit ? 1 : 0,
        expires_at: input.expires_in_seconds
          ? new Date(Date.now() + input.expires_in_seconds * 1000)
          : null,
      })
      .returning();
    const row = inserted[0];
    if (!row) {
      res.status(500).json({ error: 'Insert failed.' });
      return;
    }
    const token = signShareToken(row.id, input.expires_in_seconds);
    const tokenHash = hashToken(token);
    await db
      .update(shareLinks)
      .set({ token_hash: tokenHash })
      .where(eq(shareLinks.id, row.id));
    res.status(201).json({
      token,
      share: {
        id: row.id,
        expires_at: row.expires_at,
        label: input.label ?? '',
        profile_id: input.profile_id,
        workspace_id: input.workspace_id,
        parent_entity_id: input.parent_entity_id ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
});

shareAdminRouter.get('/', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rows = await db
      .select({
        id: shareLinks.id,
        parent_entity_id: shareLinks.parent_entity_id,
        profile_id: shareLinks.profile_id,
        workspace_id: shareLinks.workspace_id,
        label: shareLinks.label,
        scope: shareLinks.scope,
        can_upload: shareLinks.can_upload,
        can_submit: shareLinks.can_submit,
        expires_at: shareLinks.expires_at,
        revoked_at: shareLinks.revoked_at,
        created_at: shareLinks.created_at,
      })
      .from(shareLinks)
      .where(isNull(shareLinks.revoked_at))
      .orderBy(desc(shareLinks.created_at));
    res.json({ links: rows });
  } catch (err) {
    next(err);
  }
});

shareAdminRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    if (!id) {
      res.status(400).json({ error: 'Missing id.' });
      return;
    }
    await db
      .update(shareLinks)
      .set({ revoked_at: new Date() })
      .where(and(eq(shareLinks.id, id), isNull(shareLinks.revoked_at)));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
