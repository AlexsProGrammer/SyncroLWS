/**
 * FileManagerView — Browse, upload, preview workspace files.
 *
 * Files are stored in the workspace `files/` directory with hash-based dedup.
 * The `local_files` table tracks hash → path mappings.
 * File attachment entities in `base_entities` reference files by hash.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getWorkspaceDB, getCurrentProfileId, getCurrentWorkspaceId } from '@/core/db';
import { eventBus } from '@/core/events';
import { Button } from '@/ui/components/button';
import { Badge } from '@/ui/components/badge';
import { Input } from '@/ui/components/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/dialog';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FileItem {
  hash: string;
  local_path: string;
  mime_type: string;
  size_bytes: number;
  reference_count: number;
  created_at: string;
  /** Display name from the file_attachment entity */
  name: string;
  entity_id: string;
}

interface FileAttachmentPayload {
  name: string;
  hash: string;
  mime_type: string;
  size_bytes: number;
}

type ViewMode = 'grid' | 'list';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

function getFileIcon(mime: string): string {
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime === 'application/pdf') return '📄';
  if (mime.startsWith('text/')) return '📝';
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('gzip')) return '📦';
  if (mime.includes('json') || mime.includes('xml')) return '⚙️';
  return '📎';
}

function isPreviewable(mime: string): boolean {
  return (
    mime.startsWith('image/') ||
    mime === 'application/pdf' ||
    mime.startsWith('text/') ||
    mime === 'text/markdown'
  );
}

async function hashFile(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FileManagerView(): React.ReactElement {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [dragOver, setDragOver] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Load files ────────────────────────────────────────────────────────────

  const loadFiles = useCallback(async () => {
    try {
      const db = getWorkspaceDB();

      // Join local_files with base_entities to get display names
      const rows = await db.select<{
        hash: string;
        local_path: string;
        mime_type: string;
        size_bytes: number;
        reference_count: number;
        created_at: string;
        entity_id: string;
        payload: string;
      }[]>(
        `SELECT lf.hash, lf.local_path, lf.mime_type, lf.size_bytes,
                lf.reference_count, lf.created_at,
                be.id as entity_id, be.payload
         FROM local_files lf
         JOIN base_entities be ON json_extract(be.payload, '$.hash') = lf.hash
         WHERE be.type = 'file_attachment' AND be.deleted_at IS NULL
         ORDER BY lf.created_at DESC`,
      );

      const items: FileItem[] = rows.map((r) => {
        const p = JSON.parse(r.payload) as FileAttachmentPayload;
        return {
          hash: r.hash,
          local_path: r.local_path,
          mime_type: r.mime_type,
          size_bytes: r.size_bytes,
          reference_count: r.reference_count,
          created_at: r.created_at,
          name: p.name || 'Untitled',
          entity_id: r.entity_id,
        };
      });
      setFiles(items);
    } catch (err) {
      console.error('[file-manager] load failed:', err);
    }
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    const handler = (): void => {
      void loadFiles();
    };
    eventBus.on('entity:created', handler);
    eventBus.on('entity:deleted', handler);
    return () => {
      eventBus.off('entity:created', handler);
      eventBus.off('entity:deleted', handler);
    };
  }, [loadFiles]);

  // ── Upload handler ────────────────────────────────────────────────────────

  const uploadFiles = useCallback(
    async (fileList: FileList) => {
      const profileId = getCurrentProfileId();
      const workspaceId = getCurrentWorkspaceId();
      if (!profileId || !workspaceId) return;

      const db = getWorkspaceDB();

      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        if (!file) continue;

        try {
          const buffer = await file.arrayBuffer();
          const hash = await hashFile(buffer);
          const ext = file.name.split('.').pop() || '';
          const fileName = `${hash}${ext ? '.' + ext : ''}`;

          // Get workspace path via Rust
          const workspacePath = await invoke<string>('create_workspace_folder', {
            profileUuid: profileId,
            workspaceUuid: workspaceId,
          });
          const filePath = `${workspacePath}/files/${fileName}`;

          // Write file using Tauri FS
          const uint8 = new Uint8Array(buffer);
          const { writeFile: tauriWriteFile } = await import('@tauri-apps/plugin-fs');
          await tauriWriteFile(filePath, uint8);

          // Check for dedup
          const existing = await db.select<{ hash: string }[]>(
            `SELECT hash FROM local_files WHERE hash = ?`,
            [hash],
          );

          const now = new Date().toISOString();

          if (existing.length > 0) {
            // Increment reference count
            await db.execute(
              `UPDATE local_files SET reference_count = reference_count + 1 WHERE hash = ?`,
              [hash],
            );
          } else {
            // New file
            await db.execute(
              `INSERT INTO local_files (hash, local_path, mime_type, size_bytes, reference_count, created_at)
               VALUES (?, ?, ?, ?, 1, ?)`,
              [hash, filePath, file.type || 'application/octet-stream', file.size, now],
            );
          }

          // Create file_attachment entity
          const entityId = crypto.randomUUID();
          const payload: FileAttachmentPayload = {
            name: file.name,
            hash,
            mime_type: file.type || 'application/octet-stream',
            size_bytes: file.size,
          };

          await db.execute(
            `INSERT INTO base_entities
               (id, type, payload, metadata, tags, parent_id, created_at, updated_at)
             VALUES (?, 'file_attachment', ?, '{}', '[]', NULL, ?, ?)`,
            [entityId, JSON.stringify(payload), now, now],
          );

          eventBus.emit('entity:created', {
            entity: {
              id: entityId,
              type: 'file_attachment',
              payload: payload as unknown as Record<string, unknown>,
              metadata: {},
              tags: [],
              parent_id: null,
              created_at: now,
              updated_at: now,
              deleted_at: null,
            },
          });
        } catch (err) {
          console.error(`[file-manager] upload failed for ${file.name}:`, err);
          eventBus.emit('notification:show', {
            title: 'Upload failed',
            body: `Could not upload ${file.name}`,
            type: 'error',
          });
        }
      }

      eventBus.emit('notification:show', {
        title: 'Upload complete',
        body: `${fileList.length} file(s) uploaded`,
        type: 'info',
      });
    },
    [],
  );

  // ── Drag and drop ─────────────────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        void uploadFiles(e.dataTransfer.files);
      }
    },
    [uploadFiles],
  );

  // ── Delete file ───────────────────────────────────────────────────────────

  const deleteFile = useCallback(
    async (item: FileItem) => {
      try {
        const db = getWorkspaceDB();
        const now = new Date().toISOString();

        // Soft-delete the entity
        await db.execute(
          `UPDATE base_entities SET deleted_at = ? WHERE id = ?`,
          [now, item.entity_id],
        );

        // Decrement reference count
        await db.execute(
          `UPDATE local_files SET reference_count = reference_count - 1 WHERE hash = ?`,
          [item.hash],
        );

        eventBus.emit('entity:deleted', { id: item.entity_id, type: 'file_attachment' });
        void loadFiles();
      } catch (err) {
        console.error('[file-manager] delete failed:', err);
      }
    },
    [loadFiles],
  );

  // ── Preview ───────────────────────────────────────────────────────────────

  const openPreview = useCallback(async (item: FileItem) => {
    setPreviewFile(item);
    setPreviewContent(null);

    if (item.mime_type.startsWith('text/') || item.mime_type === 'application/json') {
      try {
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        const text = await readTextFile(item.local_path);
        setPreviewContent(text.slice(0, 50000)); // Cap at 50k chars
      } catch {
        setPreviewContent('(Could not read file)');
      }
    }
  }, []);

  // ── Filtered list ─────────────────────────────────────────────────────────

  const filtered = search
    ? files.filter(
        (f) =>
          f.name.toLowerCase().includes(search.toLowerCase()) ||
          f.mime_type.toLowerCase().includes(search.toLowerCase()),
      )
    : files;

  // ── Stats ─────────────────────────────────────────────────────────────────

  const totalSize = files.reduce((acc, f) => acc + f.size_bytes, 0);

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden p-4"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* ── Toolbar ────────────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search files…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-56 text-xs"
          />
          <span className="text-xs text-muted-foreground">
            {files.length} files · {formatSize(totalSize)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
            <button
              onClick={() => setViewMode('grid')}
              className={`rounded p-1 ${viewMode === 'grid' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
              </svg>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`rounded p-1 ${viewMode === 'list' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </button>
          </div>

          {/* Upload button */}
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void uploadFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <Button size="sm" onClick={() => inputRef.current?.click()} className="h-8">
            <svg className="mr-1.5 h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Upload
          </Button>
        </div>
      </div>

      {/* ── Drop zone overlay ──────────────────────────────────────── */}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/5">
          <div className="text-center">
            <svg className="mx-auto mb-2 h-12 w-12 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className="text-sm font-medium text-primary">Drop files here</p>
          </div>
        </div>
      )}

      {/* ── File list ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <svg className="h-12 w-12 text-muted-foreground/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <p className="text-sm text-muted-foreground">
              {search ? 'No files match your search' : 'No files yet — upload or drag & drop files here'}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {filtered.map((f) => (
              <div
                key={f.entity_id}
                className="group relative flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/30 cursor-pointer"
                onClick={() => isPreviewable(f.mime_type) ? void openPreview(f) : undefined}
              >
                <span className="text-3xl">{getFileIcon(f.mime_type)}</span>
                <p className="w-full truncate text-center text-xs font-medium text-foreground">
                  {f.name}
                </p>
                <p className="text-[10px] text-muted-foreground">{formatSize(f.size_bytes)}</p>

                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteFile(f);
                  }}
                  className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {filtered.map((f) => (
              <div
                key={f.entity_id}
                className="group flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-primary/30 cursor-pointer"
                onClick={() => isPreviewable(f.mime_type) ? void openPreview(f) : undefined}
              >
                <span className="text-lg">{getFileIcon(f.mime_type)}</span>
                <div className="flex-1 overflow-hidden">
                  <p className="truncate font-medium text-foreground">{f.name}</p>
                  <p className="text-xs text-muted-foreground">{f.mime_type}</p>
                </div>
                <Badge variant="outline" className="text-[10px]">{formatSize(f.size_bytes)}</Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(f.created_at).toLocaleDateString()}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteFile(f);
                  }}
                  className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Preview modal ──────────────────────────────────────────── */}
      <Dialog open={!!previewFile} onOpenChange={(open) => !open && setPreviewFile(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="truncate">{previewFile?.name}</DialogTitle>
          </DialogHeader>

          {previewFile && (
            <div className="mt-2">
              {previewFile.mime_type.startsWith('image/') && (
                <img
                  src={`asset://localhost/${encodeURIComponent(previewFile.local_path)}`}
                  alt={previewFile.name}
                  className="max-h-[60vh] w-full rounded-lg object-contain"
                />
              )}
              {(previewFile.mime_type.startsWith('text/') ||
                previewFile.mime_type === 'application/json') && (
                <pre className="max-h-[60vh] overflow-auto rounded-lg bg-muted p-4 text-xs text-foreground">
                  {previewContent ?? 'Loading…'}
                </pre>
              )}
              {previewFile.mime_type === 'application/pdf' && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  PDF preview not available in desktop mode — file saved at {previewFile.local_path}
                </p>
              )}

              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{formatSize(previewFile.size_bytes)}</span>
                <span>·</span>
                <span>{previewFile.mime_type}</span>
                <span>·</span>
                <span>SHA-256: {previewFile.hash.slice(0, 12)}…</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
