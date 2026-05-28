/**
 * uploadEngine — Phase 5.
 *
 * Reads a file from disk via tauri-plugin-fs, slices it into uniform
 * CHUNK_SIZE Uint8Array blocks, and streams them to the backend via the
 * upload.initChunked → upload.pushChunk → upload.finalizeChunked pipeline.
 *
 * Used by FileManagerView to replace single-shot HTTP POST uploads with a
 * resumable, content-addressed chunked upload flow.
 */

import { readFile } from '@tauri-apps/plugin-fs';
import { useSyncStore } from '../store/syncStore';
import { useProfileStore } from '../store/profileStore';

// ── Configuration ─────────────────────────────────────────────────────────────

/** Uniform chunk size: 2 MiB */
export const CHUNK_SIZE = 2 * 1024 * 1024;

// ── tRPC transport helper ─────────────────────────────────────────────────────

interface TRPCEnvelope<T> {
  result?: { data: T };
  error?: { message?: string };
}

async function trpcMutation<T>(
  baseUrl: string,
  token: string,
  procedure: string,
  input: unknown,
): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, '')}/trpc/${procedure}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const json = (await res.json()) as TRPCEnvelope<T>;
  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  }
  if (!json.result) throw new Error('Malformed tRPC response (no result)');
  return json.result.data;
}

// ── Credential resolver ───────────────────────────────────────────────────────

function getServerCredentials(): { serverUrl: string; token: string } | null {
  const sync = useSyncStore.getState();
  if (!sync.isSyncActive || !sync.syncUrl) return null;
  const profileStore = useProfileStore.getState();
  const profile = profileStore.profiles.find(
    (p) => p.id === profileStore.activeProfileId,
  );
  const token =
    profile?.mode === 'enterprise' ? sync.userToken : sync.deviceToken;
  if (!token) return null;
  return { serverUrl: sync.syncUrl, token };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ChunkedUploadResult {
  hash: string;
  minio_path: string;
  deduplicated: boolean;
  reference_count: number;
}

/**
 * Read a local file by path and upload it to the server in fixed-size chunks.
 *
 * Steps:
 *  1. Read binary bytes from `path` via tauri-plugin-fs.
 *  2. Slice into consecutive Uint8Array blocks of CHUNK_SIZE.
 *  3. Call upload.initChunked to reserve a staging slot on the server.
 *  4. Push each block as a base64-encoded chunk via upload.pushChunk.
 *  5. Call upload.finalizeChunked to verify the SHA-256 and commit to MinIO.
 *
 * Returns null when sync is not configured (local-only mode) without error.
 */
export async function uploadFileChunked(params: {
  path: string;
  hash: string;
  mimeType: string;
  totalSize: number;
}): Promise<ChunkedUploadResult | null> {
  const creds = getServerCredentials();
  if (!creds) return null;

  const { serverUrl, token } = creds;

  // Step 5.1: Read on-disk binary via tauri-plugin-fs
  const bytes: Uint8Array = await readFile(params.path);

  // Step 5.2: Slice into consecutive Uint8Array blocks of CHUNK_SIZE
  const chunkCount = Math.ceil(bytes.byteLength / CHUNK_SIZE) || 1;

  // Initialise the chunked session on the server
  await trpcMutation<{ staging_id: string; ready: boolean }>(
    serverUrl,
    token,
    'upload.initChunked',
    {
      hash: params.hash,
      total_size: params.totalSize,
      mime_type: params.mimeType,
      chunk_count: chunkCount,
    },
  );

  // Push each Uint8Array slice as a base64-encoded chunk
  for (let i = 0; i < chunkCount; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, bytes.byteLength);
    const slice = bytes.slice(start, end);

    // Encode chunk to base64 for JSON transport (tRPC uses JSON serialisation)
    let binary = '';
    for (let j = 0; j < slice.byteLength; j++) {
      binary += String.fromCharCode(slice[j]!);
    }
    const data = btoa(binary);

    await trpcMutation<{ chunk_index: number; received: boolean }>(
      serverUrl,
      token,
      'upload.pushChunk',
      { hash: params.hash, chunk_index: i, data },
    );
  }

  // Finalise: server verifies SHA-256 and commits artifact to MinIO
  return trpcMutation<ChunkedUploadResult>(
    serverUrl,
    token,
    'upload.finalizeChunked',
    { hash: params.hash },
  );
}
