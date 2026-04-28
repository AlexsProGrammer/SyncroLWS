/**
 * entityStore — central CRUD layer for the hybrid multi-aspect entity model
 * introduced in Phase A.
 *
 * A *base entity* carries shared core fields (title, description, color, icon,
 * tags) plus 0..N aspects. Each aspect gives the entity a tool-specific
 * personality (note / task / calendar_event / …). Editing in any tool edits
 * the same root.
 *
 * All mutations emit events on the global Event Bus so other modules stay in
 * sync without direct imports.
 *
 * NOTE: as of Phase F the legacy `base_entities.type` / `payload` / `metadata`
 * columns have been dropped. All aspect data lives in `entity_aspects`; the
 * `core:*` and `aspect:*` event-bus events are the only update channel.
 */

import { getWorkspaceDB } from './db';
import { eventBus } from './events';
import { useSyncStore } from '@/store/syncStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type {
  AspectType,
  EntityAspect,
  EntityCore,
  EntityRelation,
  HybridEntity,
  RelationKind,
} from '@syncrohws/shared-types';
import { ASPECT_DATA_SCHEMAS } from '@syncrohws/shared-types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function uuid(): string {
  return crypto.randomUUID();
}

/**
 * Phase U — block mutations when:
 *   - the user's enterprise token has expired (sync engine flipped readonly), OR
 *   - the active workspace is shared and the caller's role is `viewer`.
 *
 * Lazy imports keep this module decoupled from the React stores during
 * test/SSR contexts.
 */
function assertCanMutate(): void {
  let readonly = false;
  let role: 'owner' | 'editor' | 'viewer' | undefined;
  try {
    readonly = !!useSyncStore.getState().readonly;
    const ws = useWorkspaceStore.getState();
    if (ws.activeWorkspaceId) {
      role = ws.membership.find((m) => m.workspace_id === ws.activeWorkspaceId)?.role;
    }
  } catch {
    return; // stores unavailable — fall through (e.g. unit tests)
  }
  if (readonly) {
    throw new Error('Sync session is read-only. Reconnect to make changes.');
  }
  if (role === 'viewer') {
    throw new Error('You have viewer access only. Ask the workspace owner for editor rights.');
  }
}

interface CoreRow {
  id: string;
  title: string;
  description: string;
  description_json: string | null;
  color: string;
  icon: string;
  tags: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface AspectRow {
  id: string;
  entity_id: string;
  aspect_type: string;
  data: string;
  tool_instance_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface RelationRow {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  kind: string;
  metadata: string;
  created_at: string;
}

function rowToCore(row: CoreRow): EntityCore {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    description_json: row.description_json ?? undefined,
    color: row.color,
    icon: row.icon,
    tags: JSON.parse(row.tags) as string[],
    parent_id: row.parent_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

function rowToAspect(row: AspectRow): EntityAspect {
  return {
    id: row.id,
    entity_id: row.entity_id,
    aspect_type: row.aspect_type as AspectType,
    data: JSON.parse(row.data) as Record<string, unknown>,
    tool_instance_id: row.tool_instance_id,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

function rowToRelation(row: RelationRow): EntityRelation {
  return {
    id: row.id,
    from_entity_id: row.from_entity_id,
    to_entity_id: row.to_entity_id,
    kind: row.kind as RelationKind,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    created_at: row.created_at,
  };
}

/** Validate aspect.data against the registered Zod schema for its type. */
function validateAspectData(
  type: AspectType,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const schema = ASPECT_DATA_SCHEMAS[type];
  return schema.parse(data) as Record<string, unknown>;
}

/**
 * Phase I: nudge the sync engine. INSERTs already start with `dirty = 1`
 * (column default), UPDATEs explicitly set `dirty = 1` in the SET clause, and
 * hard-deletes write into `sync_tombstones`. This helper just wakes the
 * engine via the event bus.
 */
function notifyDirty(): void {
  eventBus.emit('sync:dirty', undefined);
}

/** Record a hard-delete in `sync_tombstones` so the next push tells the server. */
async function recordTombstone(
  kind: 'core' | 'aspect' | 'relation',
  id: string,
  base_revision: number,
): Promise<void> {
  const db = getWorkspaceDB();
  await db.execute(
    `INSERT INTO sync_tombstones (kind, id, revision, dirty, base_revision, deleted_at)
     VALUES (?, ?, 0, 1, ?, ?)
     ON CONFLICT(kind, id) DO UPDATE SET dirty = 1, base_revision = excluded.base_revision, deleted_at = excluded.deleted_at`,
    [kind, id, base_revision, nowIso()],
  );
}

// ── Core CRUD ────────────────────────────────────────────────────────────────

export interface CreateEntityInput {
  core: Partial<Omit<EntityCore, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>>;
  aspects?: Array<{
    aspect_type: AspectType;
    data?: Record<string, unknown>;
    tool_instance_id?: string | null;
    sort_order?: number;
  }>;
}

/** Create a new base entity, optionally seeding it with aspects. */
export async function createEntity(input: CreateEntityInput): Promise<HybridEntity> {
  assertCanMutate();
  const db = getWorkspaceDB();
  const now = nowIso();
  const core: EntityCore = {
    id: uuid(),
    title: input.core.title ?? '',
    description: input.core.description ?? '',
    description_json: input.core.description_json,
    color: input.core.color ?? '#6366f1',
    icon: input.core.icon ?? 'box',
    tags: input.core.tags ?? [],
    parent_id: input.core.parent_id ?? null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };

  // Phase F: legacy `type` / `payload` / `metadata` columns have been dropped.
  // Aspect data lives exclusively in `entity_aspects`.

  await db.execute(
    `INSERT INTO base_entities
       (id, title, description, description_json, color, icon, tags, parent_id, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      core.id,
      core.title,
      core.description,
      core.description_json ?? null,
      core.color,
      core.icon,
      JSON.stringify(core.tags),
      core.parent_id,
      core.created_at,
      core.updated_at,
    ],
  );

  const aspects: EntityAspect[] = [];
  for (const a of input.aspects ?? []) {
    const aspect = await insertAspect(core.id, a);
    aspects.push(aspect);
  }

  eventBus.emit('core:created', { core, aspects });
  notifyDirty();
  return { core, aspects };
}

/** Fetch a single entity (core + all live aspects). Returns null if missing or soft-deleted. */
export async function getEntity(id: string): Promise<HybridEntity | null> {
  const db = getWorkspaceDB();
  const rows = await db.select<CoreRow[]>(
    `SELECT id, title, description, description_json, color, icon, tags, parent_id, created_at, updated_at, deleted_at
       FROM base_entities WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [id],
  );
  if (!rows[0]) return null;
  const core = rowToCore(rows[0]);

  const aspectRows = await db.select<AspectRow[]>(
    `SELECT id, entity_id, aspect_type, data, tool_instance_id, sort_order, created_at, updated_at, deleted_at
       FROM entity_aspects
       WHERE entity_id = ? AND deleted_at IS NULL
       ORDER BY sort_order ASC, created_at ASC`,
    [id],
  );
  return { core, aspects: aspectRows.map(rowToAspect) };
}

export interface CoreUpdate {
  title?: string;
  description?: string;
  description_json?: string | null;
  color?: string;
  icon?: string;
  tags?: string[];
  parent_id?: string | null;
}

/** Patch shared core fields; emits `core:updated`. */
export async function updateCore(id: string, patch: CoreUpdate): Promise<EntityCore> {
  assertCanMutate();
  const db = getWorkspaceDB();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.title !== undefined) { sets.push('title = ?'); params.push(patch.title); }
  if (patch.description !== undefined) { sets.push('description = ?'); params.push(patch.description); }
  if (patch.description_json !== undefined) { sets.push('description_json = ?'); params.push(patch.description_json); }
  if (patch.color !== undefined) { sets.push('color = ?'); params.push(patch.color); }
  if (patch.icon !== undefined) { sets.push('icon = ?'); params.push(patch.icon); }
  if (patch.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(patch.tags)); }
  if (patch.parent_id !== undefined) { sets.push('parent_id = ?'); params.push(patch.parent_id); }

  const updated_at = nowIso();
  sets.push('updated_at = ?'); params.push(updated_at);
  sets.push('dirty = 1');
  params.push(id);

  await db.execute(`UPDATE base_entities SET ${sets.join(', ')} WHERE id = ?`, params);

  const fresh = await getEntity(id);
  if (!fresh) throw new Error(`[entityStore] entity ${id} disappeared during update`);
  eventBus.emit('core:updated', { core: fresh.core });
  notifyDirty();
  return fresh.core;
}

/** Soft-delete an entity and all of its aspects. */
export async function softDeleteEntity(id: string): Promise<void> {
  assertCanMutate();
  const db = getWorkspaceDB();
  const now = nowIso();
  await db.execute(
    `UPDATE base_entities SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
    [now, now, id],
  );
  await db.execute(
    `UPDATE entity_aspects SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE entity_id = ? AND deleted_at IS NULL`,
    [now, now, id],
  );
  eventBus.emit('core:deleted', { id });
  notifyDirty();
}

// ── Aspect CRUD ──────────────────────────────────────────────────────────────

async function insertAspect(
  entity_id: string,
  input: {
    aspect_type: AspectType;
    data?: Record<string, unknown>;
    tool_instance_id?: string | null;
    sort_order?: number;
  },
): Promise<EntityAspect> {
  const db = getWorkspaceDB();
  const now = nowIso();
  const data = validateAspectData(input.aspect_type, input.data ?? {});
  const aspect: EntityAspect = {
    id: uuid(),
    entity_id,
    aspect_type: input.aspect_type,
    data,
    tool_instance_id: input.tool_instance_id ?? null,
    sort_order: input.sort_order ?? 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };

  await db.execute(
    `INSERT INTO entity_aspects
       (id, entity_id, aspect_type, data, tool_instance_id, sort_order, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      aspect.id,
      aspect.entity_id,
      aspect.aspect_type,
      JSON.stringify(aspect.data),
      aspect.tool_instance_id,
      aspect.sort_order,
      aspect.created_at,
      aspect.updated_at,
    ],
  );

  return aspect;
}

/** Add a new aspect to an existing entity. Emits `aspect:added`. */
export async function addAspect(
  entity_id: string,
  input: {
    aspect_type: AspectType;
    data?: Record<string, unknown>;
    tool_instance_id?: string | null;
    sort_order?: number;
  },
): Promise<EntityAspect> {
  assertCanMutate();
  const aspect = await insertAspect(entity_id, input);
  eventBus.emit('aspect:added', { aspect });
  notifyDirty();
  return aspect;
}

export interface AspectUpdate {
  data?: Record<string, unknown>;
  tool_instance_id?: string | null;
  sort_order?: number;
}

/** Patch an aspect. `data` is merged into the existing data and re-validated. */
export async function updateAspect(
  aspect_id: string,
  patch: AspectUpdate,
): Promise<EntityAspect> {
  assertCanMutate();
  const db = getWorkspaceDB();
  const rows = await db.select<AspectRow[]>(
    `SELECT id, entity_id, aspect_type, data, tool_instance_id, sort_order, created_at, updated_at, deleted_at
       FROM entity_aspects WHERE id = ? LIMIT 1`,
    [aspect_id],
  );
  if (!rows[0]) throw new Error(`[entityStore] aspect ${aspect_id} not found`);
  const existing = rowToAspect(rows[0]);

  const merged: Record<string, unknown> = patch.data
    ? validateAspectData(existing.aspect_type, { ...existing.data, ...patch.data })
    : existing.data;

  const updated_at = nowIso();
  const tool_instance_id = patch.tool_instance_id ?? existing.tool_instance_id;
  const sort_order = patch.sort_order ?? existing.sort_order;

  await db.execute(
    `UPDATE entity_aspects
       SET data = ?, tool_instance_id = ?, sort_order = ?, updated_at = ?, dirty = 1
     WHERE id = ?`,
    [JSON.stringify(merged), tool_instance_id, sort_order, updated_at, aspect_id],
  );

  const next: EntityAspect = {
    ...existing,
    data: merged,
    tool_instance_id,
    sort_order,
    updated_at,
  };
  eventBus.emit('aspect:updated', { aspect: next });
  notifyDirty();
  return next;
}

/** Soft-delete a single aspect. Emits `aspect:removed`. */
export async function removeAspect(aspect_id: string): Promise<void> {
  assertCanMutate();
  const db = getWorkspaceDB();
  const rows = await db.select<AspectRow[]>(
    `SELECT id, entity_id, aspect_type FROM entity_aspects WHERE id = ? LIMIT 1`,
    [aspect_id],
  );
  if (!rows[0]) return;
  const now = nowIso();
  await db.execute(
    `UPDATE entity_aspects SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
    [now, now, aspect_id],
  );
  eventBus.emit('aspect:removed', {
    id: rows[0].id,
    entity_id: rows[0].entity_id,
    aspect_type: rows[0].aspect_type as AspectType,
  });
  notifyDirty();
}

// ── Querying ─────────────────────────────────────────────────────────────────

export interface ListByAspectOptions {
  /** Restrict to aspects on a specific tool instance (kanban board / calendar). */
  tool_instance_id?: string | null;
  /** Maximum rows to return. */
  limit?: number;
  offset?: number;
}

export interface AspectWithCore {
  core: EntityCore;
  aspect: EntityAspect;
}

/**
 * List all *live* aspects of a given type, joined with their core record.
 * Drives every module's main list view (Notes list, Kanban board, Calendar, …).
 */
export async function listByAspect(
  aspect_type: AspectType,
  options: ListByAspectOptions = {},
): Promise<AspectWithCore[]> {
  const db = getWorkspaceDB();
  const params: unknown[] = [aspect_type];
  let toolFilter = '';
  if (options.tool_instance_id !== undefined) {
    if (options.tool_instance_id === null) {
      toolFilter = ' AND a.tool_instance_id IS NULL';
    } else {
      toolFilter = ' AND a.tool_instance_id = ?';
      params.push(options.tool_instance_id);
    }
  }

  let limitClause = '';
  if (options.limit !== undefined) {
    limitClause = ' LIMIT ?';
    params.push(options.limit);
    if (options.offset !== undefined) {
      limitClause += ' OFFSET ?';
      params.push(options.offset);
    }
  }

  const rows = await db.select<(CoreRow & AspectRow & { a_id: string; b_id: string })[]>(
    `SELECT
       b.id          AS b_id,
       b.title       AS title,
       b.description AS description,
       b.description_json AS description_json,
       b.color       AS color,
       b.icon        AS icon,
       b.tags        AS tags,
       b.parent_id   AS parent_id,
       b.created_at  AS created_at,
       b.updated_at  AS updated_at,
       b.deleted_at  AS deleted_at,
       a.id          AS a_id,
       a.entity_id   AS entity_id,
       a.aspect_type AS aspect_type,
       a.data        AS data,
       a.tool_instance_id AS tool_instance_id,
       a.sort_order  AS sort_order
     FROM entity_aspects a
     INNER JOIN base_entities b ON b.id = a.entity_id
     WHERE a.aspect_type = ?
       AND a.deleted_at IS NULL
       AND b.deleted_at IS NULL${toolFilter}
     ORDER BY a.sort_order ASC, a.created_at ASC${limitClause}`,
    params,
  );

  return rows.map((r) => ({
    core: {
      id: r.b_id,
      title: r.title,
      description: r.description,
      description_json: r.description_json ?? undefined,
      color: r.color,
      icon: r.icon,
      tags: JSON.parse(r.tags) as string[],
      parent_id: r.parent_id,
      created_at: r.created_at,
      updated_at: r.updated_at,
      deleted_at: r.deleted_at,
    },
    aspect: {
      id: r.a_id,
      entity_id: r.entity_id,
      aspect_type: r.aspect_type as AspectType,
      data: JSON.parse(r.data) as Record<string, unknown>,
      tool_instance_id: r.tool_instance_id,
      sort_order: r.sort_order,
      created_at: r.created_at,
      updated_at: r.updated_at,
      deleted_at: null,
    },
  }));
}

// ── Relations ────────────────────────────────────────────────────────────────

/** Create a soft link between two entities. Emits `relation:added`. */
export async function addRelation(
  from_entity_id: string,
  to_entity_id: string,
  kind: RelationKind,
  metadata: Record<string, unknown> = {},
): Promise<EntityRelation> {
  assertCanMutate();
  const db = getWorkspaceDB();
  const relation: EntityRelation = {
    id: uuid(),
    from_entity_id,
    to_entity_id,
    kind,
    metadata,
    created_at: nowIso(),
  };
  await db.execute(
    `INSERT INTO entity_relations
       (id, from_entity_id, to_entity_id, kind, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      relation.id,
      relation.from_entity_id,
      relation.to_entity_id,
      relation.kind,
      JSON.stringify(relation.metadata),
      relation.created_at,
    ],
  );
  eventBus.emit('relation:added', { relation });
  notifyDirty();
  return relation;
}

/** Remove a relation by id. Emits `relation:removed`. */
export async function removeRelation(id: string): Promise<void> {
  assertCanMutate();
  const db = getWorkspaceDB();
  const rows = await db.select<(RelationRow & { revision: number })[]>(
    `SELECT id, from_entity_id, to_entity_id, revision FROM entity_relations WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!rows[0]) return;
  await db.execute(`DELETE FROM entity_relations WHERE id = ?`, [id]);
  await recordTombstone('relation', id, rows[0].revision ?? 0);
  eventBus.emit('relation:removed', {
    id: rows[0].id,
    from_entity_id: rows[0].from_entity_id,
    to_entity_id: rows[0].to_entity_id,
  });
  notifyDirty();
}

export type RelationDirection = 'outgoing' | 'incoming' | 'both';

export interface ListRelationsOptions {
  kind?: RelationKind;
  direction?: RelationDirection;
}

/** List relations touching `entity_id`. Defaults to direction='both'. */
export async function listRelations(
  entity_id: string,
  options: ListRelationsOptions = {},
): Promise<EntityRelation[]> {
  const db = getWorkspaceDB();
  const direction = options.direction ?? 'both';
  const params: unknown[] = [];
  let where: string;

  if (direction === 'outgoing') {
    where = `from_entity_id = ?`;
    params.push(entity_id);
  } else if (direction === 'incoming') {
    where = `to_entity_id = ?`;
    params.push(entity_id);
  } else {
    where = `(from_entity_id = ? OR to_entity_id = ?)`;
    params.push(entity_id, entity_id);
  }

  if (options.kind) {
    where += ` AND kind = ?`;
    params.push(options.kind);
  }

  const rows = await db.select<RelationRow[]>(
    `SELECT id, from_entity_id, to_entity_id, kind, metadata, created_at
       FROM entity_relations WHERE ${where} ORDER BY created_at DESC`,
    params,
  );
  return rows.map(rowToRelation);
}

// ── Workspace tool instances ─────────────────────────────────────────────────

export interface ToolInstance {
  id: string;
  tool_id: string;
  name: string;
  description: string;
  config: Record<string, unknown>;
  sort_order: number;
  created_at: string;
}

interface ToolInstanceRow {
  id: string;
  tool_id: string;
  name: string;
  description: string;
  config: string;
  sort_order: number;
  created_at: string;
}

/**
 * List workspace tool instances, optionally filtered by tool_id.
 * Used by `AddAspectDialog` to let the user pick a target board / calendar
 * when attaching an aspect that requires a tool instance scope.
 */
export async function listToolInstances(tool_id?: string): Promise<ToolInstance[]> {
  const db = getWorkspaceDB();
  const rows = tool_id
    ? await db.select<ToolInstanceRow[]>(
        `SELECT id, tool_id, name, description, config, sort_order, created_at
           FROM workspace_tools WHERE tool_id = ? ORDER BY sort_order ASC, created_at ASC`,
        [tool_id],
      )
    : await db.select<ToolInstanceRow[]>(
        `SELECT id, tool_id, name, description, config, sort_order, created_at
           FROM workspace_tools ORDER BY sort_order ASC, created_at ASC`,
      );
  return rows.map((r) => ({
    id: r.id,
    tool_id: r.tool_id,
    name: r.name,
    description: r.description,
    config: JSON.parse(r.config) as Record<string, unknown>,
    sort_order: r.sort_order,
    created_at: r.created_at,
  }));
}

// ── Wiki-link reconciliation (Phase E) ───────────────────────────────────────

const WIKILINK_RE = /\[\[([^\]]+)]]/g;

/** Extract distinct `[[Name]]` targets from a markdown blob. */
export function extractWikiLinkTargets(content_md: string): string[] {
  if (!content_md) return [];
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(content_md)) !== null) {
    const t = (m[1] ?? '').trim();
    if (t) out.add(t);
  }
  return [...out];
}

/**
 * Reconcile wiki-link relations from `from_entity_id` against the current
 * content_md. Resolves each `[[Name]]` to an entity by case-insensitive title
 * match and writes/removes `entity_relations` rows of kind `wiki_link`.
 *
 * Returns a summary `{ added, removed, unresolved }` for diagnostics.
 */
export async function reconcileWikiLinks(
  from_entity_id: string,
  content_md: string,
): Promise<{ added: number; removed: number; unresolved: string[] }> {
  const db = getWorkspaceDB();
  const targets = extractWikiLinkTargets(content_md);

  // Resolve target names → ids (case-insensitive title match, exclude self & deleted).
  const resolved = new Set<string>();
  const unresolved: string[] = [];
  for (const name of targets) {
    const rows = await db.select<{ id: string }[]>(
      `SELECT id FROM base_entities
         WHERE LOWER(title) = LOWER(?) AND deleted_at IS NULL
         LIMIT 1`,
      [name],
    );
    const id = rows[0]?.id;
    if (id && id !== from_entity_id) resolved.add(id);
    else if (!id) unresolved.push(name);
  }

  // Existing wiki_link relations originating from this entity.
  const existingRows = await db.select<RelationRow[]>(
    `SELECT id, from_entity_id, to_entity_id, kind, metadata, created_at
       FROM entity_relations
       WHERE from_entity_id = ? AND kind = 'wiki_link'`,
    [from_entity_id],
  );
  const existingByTo = new Map<string, RelationRow>();
  for (const r of existingRows) existingByTo.set(r.to_entity_id, r);

  let added = 0;
  let removed = 0;

  // Remove relations whose target is no longer linked.
  for (const [toId, row] of existingByTo) {
    if (!resolved.has(toId)) {
      await removeRelation(row.id);
      removed += 1;
    }
  }

  // Add relations for newly-linked targets.
  for (const toId of resolved) {
    if (!existingByTo.has(toId)) {
      await addRelation(from_entity_id, toId, 'wiki_link');
      added += 1;
    }
  }

  return { added, removed, unresolved };
}

// ── Phase J: per-entity sync state for the detail-sheet badge ───────────────

export type EntitySyncState = 'synced' | 'dirty';

/**
 * Compute the sync state of an entity across its core row + aspects + outgoing
 * relations + any pending tombstone. Returns 'dirty' if any of those have a
 * pending push, otherwise 'synced'.
 *
 * Conflicted state is not yet persisted (tracked only via the in-memory
 * `sync:conflict` event stream); the Phase N merge UI will add a
 * `local_conflict` column and surface it here.
 */
export async function getEntitySyncState(id: string): Promise<EntitySyncState> {
  const db = getWorkspaceDB();
  const rows = await db.select<{ n: number }[]>(
    `SELECT
       (SELECT COUNT(*) FROM base_entities WHERE id = ? AND dirty = 1) +
       (SELECT COUNT(*) FROM entity_aspects WHERE entity_id = ? AND dirty = 1) +
       (SELECT COUNT(*) FROM entity_relations
          WHERE (from_entity_id = ? OR to_entity_id = ?) AND dirty = 1) +
       (SELECT COUNT(*) FROM sync_tombstones WHERE id = ? AND dirty = 1) AS n`,
    [id, id, id, id, id],
  );
  return (rows[0]?.n ?? 0) > 0 ? 'dirty' : 'synced';
}
