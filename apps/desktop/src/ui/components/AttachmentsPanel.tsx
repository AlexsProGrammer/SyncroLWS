import * as React from 'react';
import { Badge } from './badge';
import { Button } from './button';
import { Input } from './input';
import { eventBus } from '@/core/events';
import { addRelation, listRelations, removeRelation } from '@/core/entityStore';
import { getWorkspaceDB } from '@/core/db';

// ── Props ────────────────────────────────────────────────────────────────────

export interface AttachmentsPanelProps {
  entityId: string;
}

interface AttachmentRow {
  relationId: string;
  otherId: string;
  otherTitle: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * AttachmentsPanel (Phase K.3) — generic list of attachment-kind relations.
 *
 * Lists outgoing relations of kind `'attachment'` from the current entity,
 * showing the linked target entity's title and (when present) `file_attachment`
 * aspect metadata (name / mime / size). Provides:
 *
 *   • paste-an-entity-id input to attach an existing entity
 *   • × button to detach (deletes the relation row)
 *
 * Real file upload UI (drag-drop → blob store → file_attachment aspect entity)
 * arrives in a later phase; for now this panel works against any pre-existing
 * entity, including manually-created `file_attachment`-aspect entities.
 */
export function AttachmentsPanel({ entityId }: AttachmentsPanelProps): React.ReactElement {
  const [rows, setRows] = React.useState<AttachmentRow[]>([]);
  const [target, setTarget] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(async (): Promise<void> => {
    const relations = await listRelations(entityId, { direction: 'outgoing', kind: 'attachment' });
    if (relations.length === 0) {
      setRows([]);
      return;
    }
    const otherIds = [...new Set(relations.map((r) => r.to_entity_id))];
    const meta = await fetchAttachmentMeta(otherIds);
    setRows(
      relations.map((r) => {
        const m = meta.get(r.to_entity_id);
        return {
          relationId: r.id,
          otherId: r.to_entity_id,
          otherTitle: m?.title || 'Untitled',
          fileName: m?.fileName ?? null,
          mimeType: m?.mimeType ?? null,
          sizeBytes: m?.sizeBytes ?? null,
        };
      }),
    );
  }, [entityId]);

  React.useEffect(() => {
    void reload();
    eventBus.on('relation:added', reload);
    eventBus.on('relation:removed', reload);
    return () => {
      eventBus.off('relation:added', reload);
      eventBus.off('relation:removed', reload);
    };
  }, [reload]);

  async function handleAttach(): Promise<void> {
    const id = target.trim();
    if (!id || busy) return;
    if (id === entityId) {
      setError("Can't attach an entity to itself.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const exists = await entityExists(id);
      if (!exists) {
        setError('No entity found with that id.');
        return;
      }
      await addRelation(entityId, id, 'attachment');
      setTarget('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleAttach();
          }}
          placeholder="Paste entity id to attach…"
          className="h-8 flex-1 text-xs"
        />
        <Button size="sm" onClick={() => void handleAttach()} disabled={!target.trim() || busy}>
          Attach
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No attachments.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((row) => (
            <li key={row.relationId} className="flex items-center gap-2 px-2 py-1.5 text-sm">
              <button
                onClick={() =>
                  eventBus.emit('nav:open-detail-sheet', { id: row.otherId })
                }
                className="flex-1 truncate text-left hover:text-primary"
                title={row.otherId}
              >
                <span className="font-medium">{row.fileName || row.otherTitle}</span>
              </button>
              {row.mimeType && (
                <Badge variant="outline" className="text-[10px]">
                  {shortMime(row.mimeType)}
                </Badge>
              )}
              {row.sizeBytes !== null && row.sizeBytes > 0 && (
                <span className="text-[10px] text-muted-foreground">{formatBytes(row.sizeBytes)}</span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => void removeRelation(row.relationId)}
                title="Detach"
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface AttachmentMeta {
  title: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
}

async function fetchAttachmentMeta(ids: string[]): Promise<Map<string, AttachmentMeta>> {
  const out = new Map<string, AttachmentMeta>();
  if (ids.length === 0) return out;
  const db = getWorkspaceDB();
  const placeholders = ids.map(() => '?').join(',');
  const titleRows = await db.select<{ id: string; title: string }[]>(
    `SELECT id, title FROM base_entities WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
    ids,
  );
  for (const r of titleRows) {
    out.set(r.id, { title: r.title, fileName: null, mimeType: null, sizeBytes: null });
  }

  const aspectRows = await db.select<{ entity_id: string; data: string }[]>(
    `SELECT entity_id, data FROM entity_aspects
       WHERE entity_id IN (${placeholders})
         AND aspect_type = 'file_attachment'
         AND deleted_at IS NULL`,
    ids,
  );
  for (const r of aspectRows) {
    const existing = out.get(r.entity_id);
    if (!existing) continue;
    try {
      const data = JSON.parse(r.data) as Record<string, unknown>;
      existing.fileName = typeof data.name === 'string' ? data.name : null;
      existing.mimeType = typeof data.mime_type === 'string' ? data.mime_type : null;
      existing.sizeBytes = typeof data.size_bytes === 'number' ? data.size_bytes : null;
    } catch {
      // ignore malformed payloads
    }
  }
  return out;
}

async function entityExists(id: string): Promise<boolean> {
  const db = getWorkspaceDB();
  const rows = await db.select<{ id: string }[]>(
    `SELECT id FROM base_entities WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [id],
  );
  return rows.length > 0;
}

function shortMime(mime: string): string {
  // application/pdf → pdf, image/png → png
  const slash = mime.indexOf('/');
  return slash >= 0 ? mime.slice(slash + 1) : mime;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
