import React, { useEffect, useState, useCallback } from 'react';
import { getWorkspaceDB } from '@/core/db';
import { eventBus } from '@/core/events';
import { cn } from '@/lib/utils';

interface BacklinkItem {
  id: string;
  title: string;
}

interface BacklinksPanelProps {
  noteId: string;
  noteTitle: string;
}

export function BacklinksPanel({
  noteId,
  noteTitle,
}: BacklinksPanelProps): React.ReactElement {
  const [backlinks, setBacklinks] = useState<BacklinkItem[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  const loadBacklinks = useCallback(async () => {
    if (!noteTitle && !noteId) return;
    try {
      const db = getWorkspaceDB();
      const rows = await db.select<{ id: string; payload: string }[]>(
        `SELECT id, payload FROM base_entities
         WHERE type = 'note' AND deleted_at IS NULL AND id != ?
         AND (
           INSTR(COALESCE(json_extract(payload, '$.content_md'), ''), '[[' || ? || ']]') > 0
           OR INSTR(COALESCE(json_extract(payload, '$.linked_entity_ids'), ''), ?) > 0
         )`,
        [noteId, noteTitle, noteId],
      );
      setBacklinks(
        rows.map((r) => {
          const p = JSON.parse(r.payload) as { title?: string };
          return { id: r.id, title: p.title || 'Untitled' };
        }),
      );
    } catch (err) {
      console.error('[BacklinksPanel] load failed:', err);
    }
  }, [noteId, noteTitle]);

  useEffect(() => {
    void loadBacklinks();
  }, [loadBacklinks]);

  useEffect(() => {
    const handler = (): void => {
      void loadBacklinks();
    };
    eventBus.on('entity:updated', handler);
    eventBus.on('entity:created', handler);
    return () => {
      eventBus.off('entity:updated', handler);
      eventBus.off('entity:created', handler);
    };
  }, [loadBacklinks]);

  return (
    <div className="flex w-56 flex-col border-l border-border bg-card/50">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 border-b border-border p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        <svg
          className={cn('h-3 w-3 transition-transform', collapsed && '-rotate-90')}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <polyline points="6,9 12,15 18,9" />
        </svg>
        Backlinks ({backlinks.length})
      </button>

      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-2">
          {backlinks.length > 0 ? (
            backlinks.map((bl) => (
              <button
                key={bl.id}
                onClick={() =>
                  eventBus.emit('nav:open-entity', { id: bl.id, type: 'note' })
                }
                className="w-full rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent transition-colors"
              >
                {bl.title}
              </button>
            ))
          ) : (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              No other notes link here
            </p>
          )}
        </div>
      )}
    </div>
  );
}
