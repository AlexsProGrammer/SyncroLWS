/**
 * Sync engine — Phase I.
 *
 * Connects the local workspace SQLite DB to the backend tRPC `sync.pull`/
 * `sync.push` procedures. Replaces the placeholder PowerSync stub.
 *
 * Lifecycle:
 *   - start(workspaceId)   — kicks off the schedule + dirty listener.
 *   - syncNow()            — manual trigger ("Sync now" button).
 *   - stop()               — tears down listeners and timers.
 *
 * Schedule: an immediate run on start, a debounced run after every
 * `sync:dirty` event, and a periodic background run every 60s while the
 * device is paired and a workspace is loaded.
 *
 * Conflict policy: server revisions always win on the wire; the local row
 * keeps `dirty = 1` and we emit `sync:conflict` so the (Phase N) merge UI
 * can resolve it later. Until then conflicting writes are simply blocked.
 */

import {
  getCurrentWorkspaceId,
  getWorkspaceDB,
} from './db';
import { eventBus } from './events';
import { useSyncStore } from '../store/syncStore';
import {
  type SyncPullResult,
  type SyncPushInput,
  type SyncPushResult,
  type SyncCore,
  type SyncAspect,
  type SyncRelation,
  type Tombstone,
} from '@syncrohws/shared-types';

const BG_INTERVAL_MS = 60_000;
const DIRTY_DEBOUNCE_MS = 1_500;

interface DirtyCoreRow {
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
  revision: number;
}
interface DirtyAspectRow {
  id: string;
  entity_id: string;
  aspect_type: string;
  data: string;
  tool_instance_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
}
interface DirtyRelationRow {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  kind: string;
  metadata: string;
  created_at: string;
  revision: number;
}
interface TombRow {
  kind: string;
  id: string;
  base_revision: number;
}

// ── tRPC-over-HTTP helpers ───────────────────────────────────────────────────

interface TRPCEnvelope<T> {
  result?: { data: T };
  error?: { message?: string; code?: number };
}

async function trpcQuery<T>(
  baseUrl: string,
  token: string,
  procedure: string,
  input: unknown,
): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, '')}/trpc/${procedure}?input=${encodeURIComponent(
    JSON.stringify(input),
  )}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as TRPCEnvelope<T>;
  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  }
  if (!json.result) throw new Error('Malformed tRPC response (no result)');
  return json.result.data;
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

// ── sync_state cursor helpers ────────────────────────────────────────────────

async function readCursor(serverUrl: string): Promise<number> {
  const db = getWorkspaceDB();
  const rows = await db.select<{ last_pull_revision: number }[]>(
    `SELECT last_pull_revision FROM sync_state WHERE server_url = ? LIMIT 1`,
    [serverUrl],
  );
  return rows[0]?.last_pull_revision ?? 0;
}

async function writeCursor(
  serverUrl: string,
  patch: {
    last_pull_revision?: number;
    last_pulled_at?: string;
    last_pushed_at?: string;
    last_error?: string | null;
  },
): Promise<void> {
  const db = getWorkspaceDB();
  const now = new Date().toISOString();
  const existing = await db.select<{ server_url: string }[]>(
    `SELECT server_url FROM sync_state WHERE server_url = ? LIMIT 1`,
    [serverUrl],
  );
  if (existing.length === 0) {
    await db.execute(
      `INSERT INTO sync_state
         (server_url, last_pull_revision, last_pulled_at, last_pushed_at, last_error, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        serverUrl,
        patch.last_pull_revision ?? 0,
        patch.last_pulled_at ?? null,
        patch.last_pushed_at ?? null,
        patch.last_error ?? null,
        now,
      ],
    );
  } else {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.last_pull_revision !== undefined) {
      sets.push('last_pull_revision = ?');
      params.push(patch.last_pull_revision);
    }
    if (patch.last_pulled_at !== undefined) {
      sets.push('last_pulled_at = ?');
      params.push(patch.last_pulled_at);
    }
    if (patch.last_pushed_at !== undefined) {
      sets.push('last_pushed_at = ?');
      params.push(patch.last_pushed_at);
    }
    if (patch.last_error !== undefined) {
      sets.push('last_error = ?');
      params.push(patch.last_error);
    }
    sets.push('updated_at = ?');
    params.push(now);
    params.push(serverUrl);
    await db.execute(
      `UPDATE sync_state SET ${sets.join(', ')} WHERE server_url = ?`,
      params,
    );
  }
}

// ── pending-count helper ────────────────────────────────────────────────────

async function countPending(): Promise<number> {
  const db = getWorkspaceDB();
  const rows = await db.select<{ n: number }[]>(
    `SELECT
       (SELECT COUNT(*) FROM base_entities WHERE dirty = 1) +
       (SELECT COUNT(*) FROM entity_aspects WHERE dirty = 1) +
       (SELECT COUNT(*) FROM entity_relations WHERE dirty = 1) +
       (SELECT COUNT(*) FROM sync_tombstones WHERE dirty = 1) AS n`,
  );
  return rows[0]?.n ?? 0;
}

// ── apply pulled rows to local DB ────────────────────────────────────────────

async function applyPull(result: SyncPullResult): Promise<void> {
  const db = getWorkspaceDB();

  for (const c of result.cores) {
    await applyRemoteCore(db, c);
  }
  for (const a of result.aspects) {
    await applyRemoteAspect(db, a);
  }
  for (const r of result.relations) {
    await applyRemoteRelation(db, r);
  }
  for (const t of result.tombstones) {
    await applyTombstone(db, t);
  }
}

type DB = ReturnType<typeof getWorkspaceDB>;

async function applyRemoteCore(db: DB, c: SyncCore): Promise<void> {
  // Skip if the local row is dirty and at a higher base_revision than server's
  // — that means we have unpushed local edits; we'll push them and pick the
  // updated copy on the next pull.
  const local = await db.select<{ dirty: number; revision: number }[]>(
    `SELECT dirty, revision FROM base_entities WHERE id = ? LIMIT 1`,
    [c.id],
  );
  if (local[0] && local[0].dirty === 1 && local[0].revision >= c.revision) {
    return;
  }
  await db.execute(
    `INSERT INTO base_entities
       (id, title, description, description_json, color, icon, tags, parent_id,
        created_at, updated_at, deleted_at, revision, dirty, last_modified_by_device)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       description = excluded.description,
       description_json = excluded.description_json,
       color = excluded.color,
       icon = excluded.icon,
       tags = excluded.tags,
       parent_id = excluded.parent_id,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at,
       revision = excluded.revision,
       dirty = 0`,
    [
      c.id,
      c.title,
      c.description,
      c.description_json ?? null,
      c.color,
      c.icon,
      JSON.stringify(c.tags),
      c.parent_id,
      c.created_at,
      c.updated_at,
      c.deleted_at,
      c.revision,
    ],
  );
}

async function applyRemoteAspect(db: DB, a: SyncAspect): Promise<void> {
  const local = await db.select<{ dirty: number; revision: number }[]>(
    `SELECT dirty, revision FROM entity_aspects WHERE id = ? LIMIT 1`,
    [a.id],
  );
  if (local[0] && local[0].dirty === 1 && local[0].revision >= a.revision) {
    return;
  }
  await db.execute(
    `INSERT INTO entity_aspects
       (id, entity_id, aspect_type, data, tool_instance_id, sort_order,
        created_at, updated_at, deleted_at, revision, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET
       data = excluded.data,
       tool_instance_id = excluded.tool_instance_id,
       sort_order = excluded.sort_order,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at,
       revision = excluded.revision,
       dirty = 0`,
    [
      a.id,
      a.entity_id,
      a.aspect_type,
      JSON.stringify(a.data),
      a.tool_instance_id,
      a.sort_order,
      a.created_at,
      a.updated_at,
      a.deleted_at,
      a.revision,
    ],
  );
}

async function applyRemoteRelation(db: DB, r: SyncRelation): Promise<void> {
  const local = await db.select<{ dirty: number; revision: number }[]>(
    `SELECT dirty, revision FROM entity_relations WHERE id = ? LIMIT 1`,
    [r.id],
  );
  if (local[0] && local[0].dirty === 1 && local[0].revision >= r.revision) {
    return;
  }
  await db.execute(
    `INSERT INTO entity_relations
       (id, from_entity_id, to_entity_id, kind, metadata, created_at, revision, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET
       metadata = excluded.metadata,
       revision = excluded.revision,
       dirty = 0`,
    [
      r.id,
      r.from_entity_id,
      r.to_entity_id,
      r.kind,
      JSON.stringify(r.metadata),
      r.created_at,
      r.revision,
    ],
  );
}

async function applyTombstone(db: DB, t: Tombstone): Promise<void> {
  const tableMap = {
    core: 'base_entities',
    aspect: 'entity_aspects',
    relation: 'entity_relations',
  } as const;
  const table = tableMap[t.kind];
  // Drop the original row if it's still around.
  await db.execute(`DELETE FROM ${table} WHERE id = ?`, [t.id]);
  // Mark in local sync_tombstones (dirty=0) so the row is "known dead".
  await db.execute(
    `INSERT INTO sync_tombstones (kind, id, revision, dirty, base_revision, deleted_at)
     VALUES (?, ?, ?, 0, ?, ?)
     ON CONFLICT(kind, id) DO UPDATE SET
       revision = excluded.revision,
       dirty = 0,
       deleted_at = excluded.deleted_at`,
    [t.kind, t.id, t.revision, t.revision, new Date().toISOString()],
  );
}

// ── collect dirty rows for push ──────────────────────────────────────────────

async function collectPushBatch(): Promise<Omit<SyncPushInput, 'workspace_id'>> {
  const db = getWorkspaceDB();
  const cores = await db.select<DirtyCoreRow[]>(
    `SELECT id, title, description, description_json, color, icon, tags, parent_id,
            created_at, updated_at, deleted_at, revision
       FROM base_entities WHERE dirty = 1 LIMIT 200`,
  );
  const aspects = await db.select<DirtyAspectRow[]>(
    `SELECT id, entity_id, aspect_type, data, tool_instance_id, sort_order,
            created_at, updated_at, deleted_at, revision
       FROM entity_aspects WHERE dirty = 1 LIMIT 200`,
  );
  const relations = await db.select<DirtyRelationRow[]>(
    `SELECT id, from_entity_id, to_entity_id, kind, metadata, created_at, revision
       FROM entity_relations WHERE dirty = 1 LIMIT 200`,
  );
  const tombs = await db.select<TombRow[]>(
    `SELECT kind, id, base_revision FROM sync_tombstones WHERE dirty = 1 LIMIT 200`,
  );

  return {
    cores: cores.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      description_json: r.description_json ?? undefined,
      color: '#6366f1', // overwritten below
      icon: 'box',
      tags: JSON.parse(r.tags) as string[],
      parent_id: r.parent_id,
      created_at: r.created_at,
      updated_at: r.updated_at,
      deleted_at: r.deleted_at,
      base_revision: r.revision,
    })).map((row, i) => ({
      ...row,
      color: cores[i]!.color,
      icon: cores[i]!.icon,
    })),
    aspects: aspects.map((r) => ({
      id: r.id,
      entity_id: r.entity_id,
      aspect_type: r.aspect_type,
      data: JSON.parse(r.data) as Record<string, unknown>,
      tool_instance_id: r.tool_instance_id,
      sort_order: r.sort_order,
      created_at: r.created_at,
      updated_at: r.updated_at,
      deleted_at: r.deleted_at,
      base_revision: r.revision,
      // aspect_type is enum-typed in shared-types; cast to satisfy the schema
    })) as never,
    relations: relations.map((r) => ({
      id: r.id,
      from_entity_id: r.from_entity_id,
      to_entity_id: r.to_entity_id,
      kind: r.kind,
      metadata: JSON.parse(r.metadata) as Record<string, unknown>,
      created_at: r.created_at,
      base_revision: r.revision,
    })) as never,
    deletes: tombs.map((t) => ({
      kind: t.kind as 'core' | 'aspect' | 'relation',
      id: t.id,
      base_revision: t.base_revision,
    })),
  };
}

// ── apply server's push acknowledgement ──────────────────────────────────────

async function applyPushResult(result: SyncPushResult): Promise<void> {
  const db = getWorkspaceDB();
  for (const ack of result.accepted) {
    if (ack.kind === 'core') {
      await db.execute(
        `UPDATE base_entities SET revision = ?, dirty = 0 WHERE id = ?`,
        [ack.revision, ack.id],
      );
    } else if (ack.kind === 'aspect') {
      await db.execute(
        `UPDATE entity_aspects SET revision = ?, dirty = 0 WHERE id = ?`,
        [ack.revision, ack.id],
      );
    } else if (ack.kind === 'relation') {
      await db.execute(
        `UPDATE entity_relations SET revision = ?, dirty = 0 WHERE id = ?`,
        [ack.revision, ack.id],
      );
    } else if (ack.kind === 'delete') {
      await db.execute(
        `UPDATE sync_tombstones SET revision = ?, dirty = 0 WHERE id = ?`,
        [ack.revision, ack.id],
      );
    }
  }
  for (const c of result.conflicts) {
    eventBus.emit('sync:conflict', {
      kind: c.kind,
      id: c.id,
      server_revision: c.server_revision,
    });
  }
}

// ── orchestrator ──────────────────────────────────────────────────────────────

async function runSyncCycle(): Promise<void> {
  const state = useSyncStore.getState();
  if (!state.isSyncActive || !state.deviceToken || !state.syncUrl) return;
  if (state.inFlight) return;
  const workspaceId = getCurrentWorkspaceId();
  if (!workspaceId) return;

  state.setStatus({ inFlight: true });
  eventBus.emit('sync:start', undefined);
  try {
    // ── PULL ───────────────────────────────────────────────────────────────
    let cursor = await readCursor(state.syncUrl);
    for (let safety = 0; safety < 20; safety += 1) {
      const pull = await trpcQuery<SyncPullResult>(
        state.syncUrl,
        state.deviceToken,
        'sync.pull',
        { workspace_id: workspaceId, since_revision: cursor, limit: 500 },
      );
      await applyPull(pull);
      if (pull.latest_revision > cursor) cursor = pull.latest_revision;
      await writeCursor(state.syncUrl, {
        last_pull_revision: cursor,
        last_pulled_at: new Date().toISOString(),
      });
      if (!pull.has_more) break;
    }

    // ── PUSH ───────────────────────────────────────────────────────────────
    const batch = await collectPushBatch();
    const totalDirty =
      batch.cores.length +
      batch.aspects.length +
      batch.relations.length +
      batch.deletes.length;
    if (totalDirty > 0) {
      const push = await trpcMutation<SyncPushResult>(
        state.syncUrl,
        state.deviceToken,
        'sync.push',
        { workspace_id: workspaceId, ...batch },
      );
      await applyPushResult(push);
      await writeCursor(state.syncUrl, { last_pushed_at: new Date().toISOString() });
    }

    const pending = await countPending();
    state.setStatus({
      inFlight: false,
      lastPulledAt: new Date().toISOString(),
      lastPushedAt: totalDirty > 0 ? new Date().toISOString() : state.lastPushedAt,
      pendingChanges: pending,
      lastError: null,
    });
    await writeCursor(state.syncUrl, { last_error: null });
    eventBus.emit('sync:complete', { synced_at: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sync] cycle failed:', message);
    state.setStatus({ inFlight: false, lastError: message });
    await writeCursor(state.syncUrl, { last_error: message });
    eventBus.emit('sync:error', { message });
  }
}

// ── singleton lifecycle ───────────────────────────────────────────────────────

let bgTimer: ReturnType<typeof setInterval> | null = null;
let dirtyTimer: ReturnType<typeof setTimeout> | null = null;
let dirtyHandler: (() => void) | null = null;
let started = false;

export const syncEngine = {
  start(): void {
    if (started) return;
    started = true;
    // Initial run; ignore errors (logged inside runSyncCycle).
    void runSyncCycle();
    bgTimer = setInterval(() => { void runSyncCycle(); }, BG_INTERVAL_MS);

    dirtyHandler = (): void => {
      if (dirtyTimer) clearTimeout(dirtyTimer);
      dirtyTimer = setTimeout(() => { void runSyncCycle(); }, DIRTY_DEBOUNCE_MS);
      // Refresh pending count immediately for UI.
      void (async () => {
        try {
          const n = await countPending();
          useSyncStore.getState().setStatus({ pendingChanges: n });
        } catch { /* ignore */ }
      })();
    };
    eventBus.on('sync:dirty', dirtyHandler);
  },

  stop(): void {
    if (!started) return;
    started = false;
    if (bgTimer) { clearInterval(bgTimer); bgTimer = null; }
    if (dirtyTimer) { clearTimeout(dirtyTimer); dirtyTimer = null; }
    if (dirtyHandler) { eventBus.off('sync:dirty', dirtyHandler); dirtyHandler = null; }
  },

  /** Manual trigger from "Sync now" UI button. */
  async syncNow(): Promise<void> {
    await runSyncCycle();
  },

  /** Initial pending count helper for the Settings UI. */
  async refreshPending(): Promise<void> {
    try {
      const n = await countPending();
      useSyncStore.getState().setStatus({ pendingChanges: n });
    } catch { /* ignore */ }
  },
};
