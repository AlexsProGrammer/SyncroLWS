import * as React from 'react';
import { Badge } from './badge';
import { Button } from './button';
import { eventBus } from '@/core/events';
import { listRelations, removeRelation } from '@/core/entityStore';
import { getWorkspaceDB } from '@/core/db';
import { getAspectPlugin } from '@/registry/ToolRegistry';
import type { EntityRelation, RelationKind } from '@syncrohws/shared-types';

// ── Props ────────────────────────────────────────────────────────────────────

export interface LinkedItemsPanelProps {
  entityId: string;
}

interface LinkedRow {
  relationId: string;
  kind: RelationKind;
  direction: 'outgoing' | 'incoming';
  otherId: string;
  otherTitle: string;
  otherType: string;
  primaryAspect: string | null;
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Compact list of all relations touching an entity (Phase E).
 *
 * Groups by RelationKind, shows direction (→ outgoing / ← incoming), the
 * linked entity's title, an "Open" action that fires `nav:open-detail-sheet`,
 * and a "Remove" action that deletes the relation row.
 *
 * Auto-reloads on `relation:added`/`relation:removed`.
 */
export function LinkedItemsPanel({ entityId }: LinkedItemsPanelProps): React.ReactElement {
  const [rows, setRows] = React.useState<LinkedRow[]>([]);

  const reload = React.useCallback(async (): Promise<void> => {
    const relations = await listRelations(entityId, { direction: 'both' });
    if (relations.length === 0) {
      setRows([]);
      return;
    }
    const otherIds = [
      ...new Set(
        relations.map((r) =>
          r.from_entity_id === entityId ? r.to_entity_id : r.from_entity_id,
        ),
      ),
    ];
    const titlesById = await fetchTitles(otherIds);
    const aspectsById = await fetchPrimaryAspect(otherIds);
    const next: LinkedRow[] = relations.map((r) => {
      const direction: 'outgoing' | 'incoming' =
        r.from_entity_id === entityId ? 'outgoing' : 'incoming';
      const otherId = direction === 'outgoing' ? r.to_entity_id : r.from_entity_id;
      const meta = titlesById.get(otherId);
      return {
        relationId: r.id,
        kind: r.kind,
        direction,
        otherId,
        otherTitle: meta?.title || 'Untitled',
        otherType: meta?.type || 'general',
        primaryAspect: aspectsById.get(otherId) ?? null,
      };
    });
    // Most-recent first (relations list already sorted DESC by created_at).
    setRows(next);
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

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No links yet. Use <code>[[Note title]]</code> in a note to create one.
      </p>
    );
  }

  // Group by kind for tidy display.
  const byKind = groupBy(rows, (r) => r.kind);

  return (
    <div className="space-y-3">
      {[...byKind.entries()].map(([kind, items]) => (
        <div key={kind} className="space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {labelForKind(kind)}
            </span>
            <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
              {items.length}
            </Badge>
          </div>
          <ul className="divide-y divide-border rounded-md border border-border">
            {items.map((row) => {
              const plugin = row.primaryAspect ? getAspectPlugin(row.primaryAspect) : undefined;
              const Icon = plugin?.icon;
              return (
                <li
                  key={row.relationId}
                  className="flex items-center gap-2 px-2 py-1.5 text-sm"
                >
                  <span
                    className="text-xs text-muted-foreground"
                    title={row.direction === 'outgoing' ? 'Outgoing' : 'Incoming'}
                  >
                    {row.direction === 'outgoing' ? '→' : '←'}
                  </span>
                  {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
                  <button
                    onClick={() =>
                      eventBus.emit('nav:open-detail-sheet', {
                        id: row.otherId,
                        ...(row.primaryAspect
                          ? { initialAspectType: row.primaryAspect as never }
                          : {}),
                      })
                    }
                    className="flex-1 truncate text-left hover:text-primary"
                  >
                    {row.otherTitle}
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => void removeRelation(row.relationId)}
                    title="Remove link"
                  >
                    ×
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const KIND_LABELS: Record<RelationKind, string> = {
  wiki_link: 'Wiki links',
  reference: 'References',
  embed: 'Embeds',
};

function labelForKind(kind: RelationKind): string {
  return KIND_LABELS[kind] ?? kind;
}

function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    const arr = out.get(k);
    if (arr) arr.push(item);
    else out.set(k, [item]);
  }
  return out;
}

interface CoreLite {
  id: string;
  title: string;
  type: string;
}

async function fetchTitles(ids: string[]): Promise<Map<string, CoreLite>> {
  const out = new Map<string, CoreLite>();
  if (ids.length === 0) return out;
  const db = getWorkspaceDB();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.select<CoreLite[]>(
    `SELECT id, title, type FROM base_entities
       WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
    ids,
  );
  for (const r of rows) out.set(r.id, r);
  return out;
}

/**
 * Pick a "primary" aspect type per linked entity so the row can show a
 * tool-appropriate icon. Falls back to first aspect by sort_order.
 */
async function fetchPrimaryAspect(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const db = getWorkspaceDB();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.select<{ entity_id: string; aspect_type: string }[]>(
    `SELECT entity_id, aspect_type FROM entity_aspects
       WHERE entity_id IN (${placeholders}) AND deleted_at IS NULL
       ORDER BY sort_order ASC, created_at ASC`,
    ids,
  );
  for (const r of rows) {
    if (!out.has(r.entity_id)) out.set(r.entity_id, r.aspect_type);
  }
  return out;
}
