/**
 * Workspace export / import.
 *
 * Exports the active workspace as a single JSON bundle covering all
 * `base_entities`, `entity_aspects`, `entity_relations`, `local_files`
 * metadata (without the actual blobs), and `workspace_tools` instances.
 *
 * Importing the inverse, with two id-collision policies:
 *   - "skip"     — preserve existing rows, drop incoming ones with conflicting ids.
 *   - "overwrite" — replace existing rows with incoming ones (uses INSERT OR REPLACE).
 *
 * The bundle does NOT include sync-specific bookkeeping (`revision`, `dirty`,
 * `tombstones`, `sync_state`) — those are workspace-private and re-derive on
 * the next sync cycle.
 */
import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentProfileId, getCurrentWorkspaceId, getWorkspaceDB } from './db';
import { eventBus } from './events';
import type { Workspace } from '@/store/workspaceStore';

export const EXPORT_BUNDLE_VERSION = 1 as const;

export interface WorkspaceExportBundle {
  version: typeof EXPORT_BUNDLE_VERSION;
  exportedAt: string;
  profileId: string;
  workspaceId: string;
  base_entities: Record<string, unknown>[];
  entity_aspects: Record<string, unknown>[];
  entity_relations: Record<string, unknown>[];
  local_files: Record<string, unknown>[];
  workspace_tools: Record<string, unknown>[];
}

export type ImportPolicy = 'skip' | 'overwrite';

export interface ImportResult {
  inserted: number;
  skipped: number;
  errors: string[];
}

// ── Export ──────────────────────────────────────────────────────────────────

export async function exportWorkspace(): Promise<WorkspaceExportBundle> {
  const profileId = getCurrentProfileId();
  const workspaceId = getCurrentWorkspaceId();
  if (!profileId) throw new Error('No active profile.');
  if (!workspaceId) throw new Error('No active workspace.');
  const db = getWorkspaceDB();

  const [base_entities, entity_aspects, entity_relations, local_files, workspace_tools] = await Promise.all([
    db.select<Record<string, unknown>[]>(`SELECT * FROM base_entities`),
    db.select<Record<string, unknown>[]>(`SELECT * FROM entity_aspects`),
    db.select<Record<string, unknown>[]>(`SELECT * FROM entity_relations`),
    db.select<Record<string, unknown>[]>(`SELECT * FROM local_files`),
    db.select<Record<string, unknown>[]>(`SELECT * FROM workspace_tools`).catch(() => []),
  ]);

  return {
    version: EXPORT_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    profileId,
    workspaceId,
    base_entities,
    entity_aspects,
    entity_relations,
    local_files,
    workspace_tools,
  };
}

// ── Import ──────────────────────────────────────────────────────────────────

function ensureBundle(raw: unknown): WorkspaceExportBundle {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid bundle: not an object.');
  const b = raw as Partial<WorkspaceExportBundle>;
  if (b.version !== EXPORT_BUNDLE_VERSION) {
    throw new Error(`Unsupported bundle version: ${String(b.version)}`);
  }
  if (!Array.isArray(b.base_entities) || !Array.isArray(b.entity_aspects)) {
    throw new Error('Invalid bundle: missing core arrays.');
  }
  return b as WorkspaceExportBundle;
}

async function existingIds(table: string, idColumn = 'id'): Promise<Set<string>> {
  const db = getWorkspaceDB();
  const rows = await db.select<{ id: string }[]>(`SELECT ${idColumn} as id FROM ${table}`);
  return new Set(rows.map((r) => r.id));
}

interface InsertSpec {
  table: string;
  rows: Record<string, unknown>[];
  /** Column to compare for collision detection. */
  idColumn: string;
}

function buildInsert(table: string, row: Record<string, unknown>, replace: boolean): { sql: string; values: unknown[] } {
  const cols = Object.keys(row);
  const placeholders = cols.map(() => '?').join(', ');
  const verb = replace ? 'INSERT OR REPLACE' : 'INSERT';
  return {
    sql: `${verb} INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
    values: cols.map((c) => row[c] ?? null),
  };
}

export async function importWorkspace(
  raw: unknown,
  policy: ImportPolicy = 'skip',
): Promise<ImportResult> {
  const bundle = ensureBundle(raw);
  const db = getWorkspaceDB();

  const result: ImportResult = { inserted: 0, skipped: 0, errors: [] };

  const specs: InsertSpec[] = [
    { table: 'base_entities', rows: bundle.base_entities, idColumn: 'id' },
    { table: 'entity_aspects', rows: bundle.entity_aspects, idColumn: 'id' },
    { table: 'entity_relations', rows: bundle.entity_relations, idColumn: 'id' },
    { table: 'local_files', rows: bundle.local_files, idColumn: 'hash' },
    { table: 'workspace_tools', rows: bundle.workspace_tools, idColumn: 'id' },
  ];

  for (const spec of specs) {
    if (!Array.isArray(spec.rows) || spec.rows.length === 0) continue;
    let existing: Set<string>;
    try {
      existing = await existingIds(spec.table, spec.idColumn);
    } catch (err) {
      result.errors.push(`${spec.table}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    for (const row of spec.rows) {
      const id = row[spec.idColumn];
      if (typeof id !== 'string') {
        result.errors.push(`${spec.table}: row missing ${spec.idColumn}`);
        continue;
      }
      if (existing.has(id) && policy === 'skip') {
        result.skipped += 1;
        continue;
      }
      try {
        const { sql, values } = buildInsert(spec.table, row, policy === 'overwrite');
        await db.execute(sql, values);
        result.inserted += 1;
      } catch (err) {
        result.errors.push(`${spec.table}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Bus events make every list view reload.
  eventBus.emit('notification:show', {
    title: 'Import complete',
    body: `${result.inserted} rows imported, ${result.skipped} skipped${result.errors.length ? `, ${result.errors.length} errors` : ''}. Reload the app to see changes.`,
    type: result.errors.length ? 'warning' : 'info',
  });
  return result;
}

// ── Browser save/load helpers ───────────────────────────────────────────────

export function downloadJsonBundle(bundle: WorkspaceExportBundle, filename?: string): void {
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    filename ??
    `syncrolws-workspace-${bundle.workspaceId.slice(0, 8)}-${bundle.exportedAt.replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function pickJsonBundle(): Promise<WorkspaceExportBundle | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async (): Promise<void> => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;
        resolve(ensureBundle(parsed));
      } catch (err) {
        console.error('[workspace-io] failed to parse bundle:', err);
        resolve(null);
      }
    };
    input.click();
  });
}

// ── Cross-profile workspace transfer ───────────────────────────────────────

export type TransferMode = 'copy' | 'move';

export interface TransferParams {
  sourceWorkspaceId: string;
  workspaceMeta: Pick<Workspace, 'name' | 'description' | 'icon' | 'color'>;
  sourceProfileId: string;
  targetProfileId: string;
  targetProfilePath: string;
  mode: TransferMode;
}

/**
 * Copies (or moves) a workspace to another profile.
 *
 * - "copy": clones the workspace DB + files under a new UUID; source is untouched.
 * - "move": same clone, then soft-deletes the source workspace via the store.
 *
 * The workspace is placed at root level (`parent_id = null`) in the target
 * profile because the source's folder tree may not exist there.
 */
export async function transferWorkspaceToProfile(params: TransferParams): Promise<void> {
  const { sourceWorkspaceId, workspaceMeta, sourceProfileId, targetProfileId, targetProfilePath, mode } = params;

  const destWorkspaceId = mode === 'copy' ? crypto.randomUUID() : sourceWorkspaceId;

  // 1. Rust copies the raw SQLite + files on disk
  await invoke('copy_workspace_data', {
    srcProfileUuid: sourceProfileId,
    srcWorkspaceUuid: sourceWorkspaceId,
    dstProfileUuid: targetProfileId,
    dstWorkspaceUuid: destWorkspaceId,
  });

  // 2. Open the target profile DB and insert the workspace row
  const targetDb = await Database.load(`sqlite:${targetProfilePath}/data.sqlite`);
  try {
    const sortRows = await targetDb.select<{ next: number }[]>(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM workspaces WHERE deleted_at IS NULL`,
    );
    const sortOrder = sortRows[0]?.next ?? 0;
    const now = new Date().toISOString();

    await targetDb.execute(
      `INSERT INTO workspaces (id, name, description, icon, color, parent_id, sort_order, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL)`,
      [
        destWorkspaceId,
        workspaceMeta.name,
        workspaceMeta.description,
        workspaceMeta.icon,
        workspaceMeta.color,
        sortOrder,
        now,
        now,
      ],
    );
  } finally {
    // Don't hold on to the foreign DB connection
    await targetDb.close().catch(() => {});
  }

  // 3. For a move, soft-delete the source using the store (handles active-workspace switch)
  if (mode === 'move') {
    // Lazy import to avoid circular deps — store imports nothing from workspaceIO
    const { useWorkspaceStore } = await import('@/store/workspaceStore');
    await useWorkspaceStore.getState().deleteWorkspace(sourceWorkspaceId);
  }

  eventBus.emit('notification:show', {
    title: mode === 'copy' ? 'Workspace copied' : 'Workspace moved',
    body: `"${workspaceMeta.name}" was ${mode === 'copy' ? 'copied to' : 'moved to'} the selected profile.`,
    type: 'info',
  });
}
