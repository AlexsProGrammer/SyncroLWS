import { useMemo } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { mkdir, writeFile } from '@tauri-apps/plugin-fs';
import {
  executeWriteAtomic,
  getCurrentProfileId,
  getCurrentWorkspaceId,
  getWorkspaceDB,
} from '@/core/db';
import type { TLAssetStore } from '@tldraw/tldraw';

/** Compute a hex-encoded SHA-256 digest of `buffer`. */
async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * useCanvasAssets — offline content-addressable asset store (Phase 4).
 *
 * Returns a `TLAssetStore` for use as the `<Tldraw assets={…}>` prop.
 *
 * `upload(asset, file)`:
 *   1. Reads the file bytes and derives a SHA-256 content hash.
 *   2. Writes the bytes to `<workspacePath>/files/<hash>.<ext>` (skips write
 *      on dedup hit).
 *   3. Registers / increments the `local_files` row inside a serialised write.
 *   4. Returns `{ src: convertFileSrc(filePath) }` — a `asset://localhost/…`
 *      URL the Tauri webview can render without any external network call.
 *
 * `resolve(asset)`:
 *   Passes the already-stored `asset://localhost/…` src straight back to
 *   tldraw — no network lookup required.
 */
export function useCanvasAssets(): TLAssetStore {
  return useMemo<TLAssetStore>(
    () => ({
      async upload(_asset, file) {
        const profileId = getCurrentProfileId();
        const workspaceId = getCurrentWorkspaceId();
        if (!profileId || !workspaceId) {
          throw new Error('[canvas] No active profile/workspace for asset upload.');
        }

        // Step 4.2 – hash the file bytes for content-addressable storage.
        const buffer = await file.arrayBuffer();
        const hash = await sha256Hex(buffer);

        const rawExt = file.name.split('.').pop() ?? '';
        const ext = rawExt.replace(/[^a-zA-Z0-9]/g, '');
        const fileName = ext ? `${hash}.${ext}` : hash;

        // Resolve the workspace path (Rust command creates it if missing).
        const workspacePath = await invoke<string>('create_workspace_folder', {
          profileUuid: profileId,
          workspaceUuid: workspaceId,
        });

        const filesDir = `${workspacePath}/files`;
        const filePath = `${filesDir}/${fileName}`;
        const mime = file.type || 'application/octet-stream';
        const now = new Date().toISOString();

        // Step 4.3 – atomically dedup-check, optionally write, then register.
        await executeWriteAtomic(async () => {
          const db = getWorkspaceDB();

          const existing = await db.select<{ hash: string }[]>(
            `SELECT hash FROM local_files WHERE hash = ?`,
            [hash],
          );

          if (existing.length > 0) {
            // Already on disk — just track the extra reference.
            await db.execute(
              `UPDATE local_files SET reference_count = reference_count + 1 WHERE hash = ?`,
              [hash],
            );
          } else {
            // Ensure the files sub-directory exists (no-op if already there).
            await mkdir(filesDir, { recursive: true });

            // Step 4.2 – write bytes to disk.
            await writeFile(filePath, new Uint8Array(buffer));

            // Step 4.3 – register with reference_count = 1.
            await db.execute(
              `INSERT INTO local_files (hash, local_path, mime_type, size_bytes, reference_count, created_at)
               VALUES (?, ?, ?, ?, 1, ?)`,
              [hash, filePath, mime, file.size, now],
            );
          }
        });

        // Step 4.4 – return a Tauri asset:// URL (zero external network calls).
        return { src: convertFileSrc(filePath), meta: { hash } };
      },

      resolve(asset) {
        // The src stored in asset.props is already a convertFileSrc() result.
        const src = (asset.props as { src?: string | null }).src;
        return Promise.resolve(src ?? null);
      },
    }),
    [],
  );
}
