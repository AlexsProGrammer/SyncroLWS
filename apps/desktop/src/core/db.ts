import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';

// ═══════════════════════════════════════════════════════════════════════════════
// Two-level database architecture:
//   Profile DB  → profiles/<uuid>/data.sqlite    (workspaces, active_tools)
//   Workspace DB → profiles/<uuid>/workspaces/<uuid>/data.sqlite (entities, files)
// ═══════════════════════════════════════════════════════════════════════════════

let _profileDb: Database | null = null;
let _currentProfileId: string | null = null;

let _workspaceDb: Database | null = null;
let _currentWorkspaceId: string | null = null;

// ── Profile DB ────────────────────────────────────────────────────────────────

/**
 * Returns the active profile-level SQLite database connection.
 * Throws if no profile has been loaded yet.
 */
export function getDB(): Database {
  if (!_profileDb) {
    throw new Error(
      '[db] No profile database loaded. Call loadProfileDB(profileId) before accessing the DB.',
    );
  }
  return _profileDb;
}

/**
 * Load (or switch to) the SQLite database for a specific profile.
 * This DB holds workspace metadata and profile-level settings.
 */
export async function loadProfileDB(profileId: string): Promise<Database> {
  if (_profileDb && _currentProfileId === profileId) return _profileDb;

  // Close previous workspace DB first
  await closeWorkspaceDB();

  // Close previous profile DB
  if (_profileDb) {
    try {
      await _profileDb.close();
    } catch {
      // Ignore close errors on stale handles
    }
    _profileDb = null;
    _currentProfileId = null;
  }

  const profilePath = await invoke<string>('create_profile_folder', { uuid: profileId });

  _profileDb = await Database.load(`sqlite:${profilePath}/data.sqlite`);
  _currentProfileId = profileId;

  await runProfileMigrations(_profileDb);

  console.log(`[db] Profile DB loaded: ${profileId}`);
  return _profileDb;
}

/**
 * Close the current profile database (and workspace DB if open).
 */
export async function closeProfileDB(): Promise<void> {
  await closeWorkspaceDB();
  if (_profileDb) {
    await _profileDb.close();
    _profileDb = null;
    _currentProfileId = null;
  }
}

export function getCurrentProfileId(): string | null {
  return _currentProfileId;
}

// ── Profile Settings Helpers ──────────────────────────────────────────────────

export async function getProfileSetting(key: string): Promise<string | null> {
  const db = getDB();
  const rows = await db.select<{ value: string }[]>(
    `SELECT value FROM profile_settings WHERE key = ?`,
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setProfileSetting(key: string, value: string): Promise<void> {
  const db = getDB();
  await db.execute(
    `INSERT OR REPLACE INTO profile_settings (key, value) VALUES (?, ?)`,
    [key, value],
  );
}

// ── Workspace DB ──────────────────────────────────────────────────────────────

/**
 * Returns the active workspace-level SQLite database connection.
 * Throws if no workspace has been loaded yet.
 */
export function getWorkspaceDB(): Database {
  if (!_workspaceDb) {
    throw new Error(
      '[db] No workspace database loaded. Call loadWorkspaceDB(workspaceId) before accessing.',
    );
  }
  return _workspaceDb;
}

/**
 * Load (or switch to) the SQLite database for a specific workspace.
 * Requires the profile DB to be loaded first.
 */
export async function loadWorkspaceDB(workspaceId: string): Promise<Database> {
  if (!_currentProfileId) {
    throw new Error('[db] Cannot load workspace DB — no profile loaded.');
  }

  if (_workspaceDb && _currentWorkspaceId === workspaceId) return _workspaceDb;

  // Close previous workspace DB
  await closeWorkspaceDB();

  const workspacePath = await invoke<string>('create_workspace_folder', {
    profileUuid: _currentProfileId,
    workspaceUuid: workspaceId,
  });

  _workspaceDb = await Database.load(`sqlite:${workspacePath}/data.sqlite`);
  _currentWorkspaceId = workspaceId;

  await runWorkspaceMigrations(_workspaceDb);

  console.log(`[db] Workspace DB loaded: ${workspaceId}`);
  return _workspaceDb;
}

/**
 * Close the current workspace database.
 */
export async function closeWorkspaceDB(): Promise<void> {
  if (_workspaceDb) {
    try {
      await _workspaceDb.close();
    } catch {
      // Ignore close errors on stale handles
    }
    _workspaceDb = null;
    _currentWorkspaceId = null;
  }
}

export function getCurrentWorkspaceId(): string | null {
  return _currentWorkspaceId;
}

// ── Profile Migrations ────────────────────────────────────────────────────────

const PROFILE_MIGRATION = `
CREATE TABLE IF NOT EXISTS \`workspaces\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`name\` text NOT NULL,
  \`description\` text DEFAULT '' NOT NULL,
  \`icon\` text DEFAULT 'folder' NOT NULL,
  \`color\` text DEFAULT '#6366f1' NOT NULL,
  \`parent_id\` text,
  \`sort_order\` integer DEFAULT 0 NOT NULL,
  \`created_at\` text NOT NULL,
  \`updated_at\` text NOT NULL,
  \`deleted_at\` text
);
CREATE TABLE IF NOT EXISTS \`active_tools\` (
  \`profile_id\` text NOT NULL,
  \`tool_id\` text NOT NULL,
  \`is_enabled\` integer DEFAULT 1 NOT NULL
);
CREATE TABLE IF NOT EXISTS \`profile_settings\` (
  \`key\` text PRIMARY KEY NOT NULL,
  \`value\` text NOT NULL
);
`;

async function runProfileMigrations(db: Database): Promise<void> {
  const statements = PROFILE_MIGRATION
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    await db.execute(stmt);
  }

  await db.execute(`CREATE INDEX IF NOT EXISTS idx_workspaces_parent ON workspaces(parent_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_workspaces_deleted ON workspaces(deleted_at);`);

  console.log('[db] Profile migrations complete');
}

// ── Workspace Migrations ──────────────────────────────────────────────────────

const WORKSPACE_MIGRATION = `
CREATE TABLE IF NOT EXISTS \`base_entities\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`type\` text NOT NULL,
  \`payload\` text DEFAULT '{}' NOT NULL,
  \`metadata\` text DEFAULT '{}' NOT NULL,
  \`tags\` text DEFAULT '[]' NOT NULL,
  \`parent_id\` text,
  \`created_at\` text NOT NULL,
  \`updated_at\` text NOT NULL,
  \`deleted_at\` text
);
CREATE TABLE IF NOT EXISTS \`workspace_tools\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`tool_id\` text NOT NULL,
  \`name\` text NOT NULL,
  \`description\` text DEFAULT '' NOT NULL,
  \`config\` text DEFAULT '{}' NOT NULL,
  \`sort_order\` integer DEFAULT 0 NOT NULL,
  \`created_at\` text NOT NULL
);
CREATE TABLE IF NOT EXISTS \`local_files\` (
  \`hash\` text PRIMARY KEY NOT NULL,
  \`local_path\` text NOT NULL,
  \`mime_type\` text DEFAULT 'application/octet-stream' NOT NULL,
  \`size_bytes\` integer NOT NULL,
  \`reference_count\` integer DEFAULT 1 NOT NULL,
  \`created_at\` text NOT NULL
);
`;

async function runWorkspaceMigrations(db: Database): Promise<void> {
  const statements = WORKSPACE_MIGRATION
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    await db.execute(stmt);
  }

  // Indexes
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_base_entities_type ON base_entities(type);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_base_entities_parent ON base_entities(parent_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_base_entities_deleted ON base_entities(deleted_at);`);

  // FTS5 virtual table
  await db.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS base_entities_fts
    USING fts5(
      id UNINDEXED,
      type,
      payload,
      tags,
      content='base_entities',
      content_rowid='rowid'
    );
  `);

  // Triggers to keep FTS in sync with the main table
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS base_entities_ai
    AFTER INSERT ON base_entities BEGIN
      INSERT INTO base_entities_fts(rowid, id, type, payload, tags)
      VALUES (new.rowid, new.id, new.type, new.payload, new.tags);
    END;
  `);

  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS base_entities_ad
    AFTER DELETE ON base_entities BEGIN
      INSERT INTO base_entities_fts(base_entities_fts, rowid, id, type, payload, tags)
      VALUES ('delete', old.rowid, old.id, old.type, old.payload, old.tags);
    END;
  `);

  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS base_entities_au
    AFTER UPDATE ON base_entities BEGIN
      INSERT INTO base_entities_fts(base_entities_fts, rowid, id, type, payload, tags)
      VALUES ('delete', old.rowid, old.id, old.type, old.payload, old.tags);
      INSERT INTO base_entities_fts(rowid, id, type, payload, tags)
      VALUES (new.rowid, new.id, new.type, new.payload, new.tags);
    END;
  `);

  console.log('[db] Workspace migrations complete');
}

// ── FTS Search (workspace-scoped) ─────────────────────────────────────────────

/**
 * Perform an FTS5 full-text search across all base_entities in the current workspace.
 * Returns matching entity IDs ordered by rank.
 */
export async function ftsSearch(query: string): Promise<string[]> {
  const db = getWorkspaceDB();
  const safe = query.replace(/"/g, '""');
  const rows = await db.select<{ id: string }[]>(
    `SELECT id FROM base_entities_fts WHERE base_entities_fts MATCH ? ORDER BY rank LIMIT 50`,
    [`"${safe}"`],
  );
  return rows.map((r) => r.id);
}
