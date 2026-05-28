import { useEffect, useRef } from 'react';
import type { Editor, TLShape, TLRecord } from '@tldraw/tldraw';
import { getWorkspaceDB, executeWriteAtomic } from '@/core/db';
import { eventBus } from '@/core/events';

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function uuid(): string {
  return crypto.randomUUID();
}

/** Build a readable base_entities.title from the tldraw shape type. */
function shapeTitleFromType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1) + ' shape';
}

/** Map a tldraw TLShape to the fields stored in CanvasShapeAspectDataSchema. */
function shapeToAspectData(shape: TLShape): Record<string, unknown> {
  return {
    id: shape.id,
    type: shape.type,
    x: shape.x,
    y: shape.y,
    rotation: shape.rotation,
    index: shape.index as string,
    props: shape.props as Record<string, unknown>,
    parentId: shape.parentId as string,
  };
}

/** Determines whether a record is a canvas shape (not a page/camera/pointer). */
function isShape(record: TLRecord): record is TLShape {
  return (record as { typeName?: string }).typeName === 'shape';
}

// ── DB row mapping ────────────────────────────────────────────────────────────

interface ShapeMapping {
  /** entity_aspects.id */
  aspectId: string;
  /** base_entities.id */
  entityId: string;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * useTldrawStore — granular shape persistence hook (Phase 3).
 *
 * Wires a `store.listen()` handler on the tldraw Editor and maps every
 * individual shape mutation into the local SQLite `entity_aspects` table:
 *
 *   added   → INSERT base_entities + INSERT entity_aspects (dirty = 1 by default)
 *   updated → UPDATE entity_aspects SET data = ?, dirty = 1   (300 ms debounced)
 *   removed → UPDATE entity_aspects SET deleted_at + dirty = 1
 *             + INSERT sync_tombstones (kind = 'aspect')
 *
 * Each shape row carries `tool_instance_id = toolInstanceId` so multiple canvas
 * boards remain isolated within the same workspace.
 *
 * @param editor         - Editor instance returned by Tldraw's `onMount` prop.
 * @param toolInstanceId - workspace_tools.id that scopes this canvas board.
 */
export function useTldrawStore(
  editor: Editor | null,
  toolInstanceId: string | undefined,
): void {
  // tldraw shapeId → { aspectId, entityId } — populated from DB on mount.
  const mapRef = useRef<Map<string, ShapeMapping>>(new Map());
  // Per-shape 300 ms debounce timers for UPDATE operations.
  const debounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // ── Step 3.1: Load existing shape → aspect mappings from the workspace DB ──
  useEffect(() => {
    if (!editor || !toolInstanceId) return;

    let cancelled = false;

    const loadMappings = async (): Promise<void> => {
      try {
        const db = getWorkspaceDB();
        const rows = await db.select<{ id: string; entity_id: string; data: string }[]>(
          `SELECT id, entity_id, data
             FROM entity_aspects
            WHERE aspect_type = 'canvas_shape'
              AND tool_instance_id = ?
              AND deleted_at IS NULL`,
          [toolInstanceId],
        );

        if (cancelled) return;

        const map = mapRef.current;
        map.clear();
        for (const row of rows) {
          try {
            const data = JSON.parse(row.data) as Record<string, unknown>;
            const tldrawId = typeof data['id'] === 'string' ? data['id'] : null;
            if (tldrawId) {
              map.set(tldrawId, { aspectId: row.id, entityId: row.entity_id });
            }
          } catch {
            // Malformed JSON — skip silently.
          }
        }
        console.log(
          `[module:canvas] Loaded ${map.size} shape mapping(s) for instance ${toolInstanceId}`,
        );
      } catch (err) {
        console.error('[module:canvas] Failed to load shape mappings:', err);
      }
    };

    void loadMappings();

    return () => {
      cancelled = true;
      // Flush pending debounce timers.
      for (const timer of debounceRef.current.values()) {
        clearTimeout(timer);
      }
      debounceRef.current.clear();
      mapRef.current.clear();
    };
  }, [editor, toolInstanceId]);

  // ── Step 3.2: Wire store listener ─────────────────────────────────────────
  useEffect(() => {
    if (!editor || !toolInstanceId) return;

    const unsubscribe = editor.store.listen(
      (entry) => {
        const { added, updated, removed } = entry.changes;
        const map = mapRef.current;
        const debounceMap = debounceRef.current;

        // ── Step 3.3: added shapes ──────────────────────────────────────────
        for (const record of Object.values(added)) {
          if (!isShape(record)) continue;
          const shape = record;
          const tldrawId = shape.id as string;

          void executeWriteAtomic(async () => {
            const db = getWorkspaceDB();
            const now = nowIso();
            const entityId = uuid();
            const aspectId = uuid();
            const aspectData = JSON.stringify(shapeToAspectData(shape));

            // Create the owning base entity (title derived from shape type).
            await db.execute(
              `INSERT INTO base_entities
                 (id, title, description, description_json, color, icon, tags, parent_id, created_at, updated_at, deleted_at)
               VALUES (?, ?, '', NULL, '#6366f1', 'box', '[]', NULL, ?, ?, NULL)`,
              [entityId, shapeTitleFromType(shape.type), now, now],
            );

            // Create the canvas_shape aspect (dirty = 1 is the column default).
            await db.execute(
              `INSERT INTO entity_aspects
                 (id, entity_id, aspect_type, data, tool_instance_id, sort_order, created_at, updated_at, deleted_at)
               VALUES (?, ?, 'canvas_shape', ?, ?, 0, ?, ?, NULL)`,
              [aspectId, entityId, aspectData, toolInstanceId, now, now],
            );

            // Record the mapping so subsequent updates/removes can find the row.
            map.set(tldrawId, { aspectId, entityId });
            eventBus.emit('sync:dirty', undefined);
          }).catch((err: unknown) => {
            console.error('[module:canvas] Failed to persist added shape:', err);
          });
        }

        // ── Step 3.3: updated shapes (debounced 300 ms per shape) ───────────
        for (const [, pair] of Object.entries(updated)) {
          const [, next] = pair as [TLRecord, TLRecord];
          if (!isShape(next)) continue;
          const shape = next;
          const tldrawId = shape.id as string;

          // Reset the per-shape debounce timer.
          const existing = debounceMap.get(tldrawId);
          if (existing !== undefined) clearTimeout(existing);

          const timer = setTimeout(() => {
            debounceMap.delete(tldrawId);
            const mapping = map.get(tldrawId);
            if (!mapping) return; // INSERT may still be in flight — drop.

            void executeWriteAtomic(async () => {
              const db = getWorkspaceDB();
              await db.execute(
                `UPDATE entity_aspects
                    SET data = ?, updated_at = ?, dirty = 1
                  WHERE id = ?`,
                [JSON.stringify(shapeToAspectData(shape)), nowIso(), mapping.aspectId],
              );
              eventBus.emit('sync:dirty', undefined);
            }).catch((err: unknown) => {
              console.error('[module:canvas] Failed to persist updated shape:', err);
            });
          }, 300);

          debounceMap.set(tldrawId, timer);
        }

        // ── Step 3.4: removed shapes → soft-delete + tombstone ───────────────
        for (const record of Object.values(removed)) {
          if (!isShape(record)) continue;
          const tldrawId = record.id as string;

          // Cancel any pending update for this shape before it writes stale data.
          const pendingTimer = debounceMap.get(tldrawId);
          if (pendingTimer !== undefined) {
            clearTimeout(pendingTimer);
            debounceMap.delete(tldrawId);
          }

          const mapping = map.get(tldrawId);
          if (!mapping) continue;
          map.delete(tldrawId);

          void executeWriteAtomic(async () => {
            const db = getWorkspaceDB();
            const now = nowIso();

            // Soft-delete the aspect row (dirty = 1 wakes the sync engine).
            await db.execute(
              `UPDATE entity_aspects
                  SET deleted_at = ?, updated_at = ?, dirty = 1
                WHERE id = ?`,
              [now, now, mapping.aspectId],
            );

            // Write to sync_tombstones so the next push reports the deletion.
            await db.execute(
              `INSERT INTO sync_tombstones (kind, id, revision, dirty, base_revision, deleted_at)
               VALUES ('aspect', ?, 0, 1, 0, ?)
               ON CONFLICT(kind, id) DO UPDATE
                 SET dirty = 1, base_revision = 0, deleted_at = excluded.deleted_at`,
              [mapping.aspectId, now],
            );

            eventBus.emit('sync:dirty', undefined);
          }).catch((err: unknown) => {
            console.error('[module:canvas] Failed to tombstone removed shape:', err);
          });
        }
      },
      // Only intercept direct user gestures; 'remote' changes come from the
      // sync engine which writes to entity_aspects directly — no round-trip.
      { source: 'user', scope: 'document' },
    );

    return () => {
      unsubscribe();
      for (const timer of debounceRef.current.values()) {
        clearTimeout(timer);
      }
      debounceRef.current.clear();
    };
  }, [editor, toolInstanceId]);
}
