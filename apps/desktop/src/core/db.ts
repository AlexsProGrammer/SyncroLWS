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

// ── Pool settle helper ────────────────────────────────────────────────────────
// @tauri-apps/plugin-sql caches connection pools by path on the Rust/sqlx side.
// Calling .close() destroys the pool but leaves a dead handle in that cache, so
// the next Database.load(same path) acquires from the closed pool and throws
// "attempted to acquire a connection on a closed pool".
// Fix: never call .close() — just null the JS reference so the pool keeps
// running and is safely reused on next Database.load(). A short settle delay
// guards against any in-flight queries that may still be draining.
function dbSettle(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 80));
}

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

  // Unload the workspace DB first (without closing the underlying pool)
  await closeWorkspaceDB();

  // Drop the JS reference to the old profile DB without calling .close().
  // Closing destroys the sqlx pool on the Rust side but leaves a dead handle
  // cached by path — subsequent Database.load(same path) then throws
  // "attempted to acquire a connection on a closed pool".
  if (_profileDb) {
    _profileDb = null;
    _currentProfileId = null;
    await dbSettle(); // allow any in-flight queries to drain
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
    // Drop reference only — do not call .close() to avoid poisoning the cached pool.
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

  // Drop the previous workspace DB reference (no .close() — see loadProfileDB comment)
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
    // Drop reference only — do not call .close() to avoid poisoning the cached pool.
    _workspaceDb = null;
    _currentWorkspaceId = null;
    await dbSettle(); // allow any in-flight queries to drain
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
  \`title\` text DEFAULT '' NOT NULL,
  \`description\` text DEFAULT '' NOT NULL,
  \`color\` text DEFAULT '#6366f1' NOT NULL,
  \`icon\` text DEFAULT 'box' NOT NULL,
  \`tags\` text DEFAULT '[]' NOT NULL,
  \`parent_id\` text,
  \`created_at\` text NOT NULL,
  \`updated_at\` text NOT NULL,
  \`deleted_at\` text
);
CREATE TABLE IF NOT EXISTS \`entity_aspects\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`entity_id\` text NOT NULL,
  \`aspect_type\` text NOT NULL,
  \`data\` text DEFAULT '{}' NOT NULL,
  \`tool_instance_id\` text,
  \`sort_order\` integer DEFAULT 0 NOT NULL,
  \`created_at\` text NOT NULL,
  \`updated_at\` text NOT NULL,
  \`deleted_at\` text
);
CREATE TABLE IF NOT EXISTS \`entity_relations\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`from_entity_id\` text NOT NULL,
  \`to_entity_id\` text NOT NULL,
  \`kind\` text NOT NULL,
  \`metadata\` text DEFAULT '{}' NOT NULL,
  \`created_at\` text NOT NULL
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

/**
 * Idempotent ALTER TABLE — adds the column only if it isn't already present.
 * Used to upgrade existing dev DBs to the Phase A hybrid schema without
 * requiring a full reset.
 */
async function ensureColumn(
  db: Database,
  table: string,
  column: string,
  ddl: string,
): Promise<void> {
  const rows = await db.select<{ name: string }[]>(
    `SELECT name FROM pragma_table_info(?) WHERE name = ?`,
    [table, column],
  );
  if (rows.length === 0) {
    await db.execute(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl};`);
  }
}

/**
 * Idempotent ALTER TABLE — drops the column if it is still present.
 * Used in Phase F to remove the legacy type/payload/metadata columns.
 */
async function dropColumnIfExists(
  db: Database,
  table: string,
  column: string,
): Promise<void> {
  const rows = await db.select<{ name: string }[]>(
    `SELECT name FROM pragma_table_info(?) WHERE name = ?`,
    [table, column],
  );
  if (rows.length > 0) {
    await db.execute(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\`;`);
  }
}

async function runWorkspaceMigrations(db: Database): Promise<void> {
  const statements = WORKSPACE_MIGRATION
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    await db.execute(stmt);
  }

  // Phase A: backfill new core columns on pre-existing dev DBs.
  await ensureColumn(db, 'base_entities', 'title', `\`title\` text DEFAULT '' NOT NULL`);
  await ensureColumn(db, 'base_entities', 'description', `\`description\` text DEFAULT '' NOT NULL`);
  await ensureColumn(db, 'base_entities', 'color', `\`color\` text DEFAULT '#6366f1' NOT NULL`);
  await ensureColumn(db, 'base_entities', 'icon', `\`icon\` text DEFAULT 'box' NOT NULL`);

  // Phase F: drop legacy columns if any older dev DB still has them.
  // FTS5 tables with content='base_entities' must be torn down first because
  // they reference the dropped columns.
  const legacyCols = await db.select<{ name: string }[]>(
    `SELECT name FROM pragma_table_info('base_entities')
       WHERE name IN ('type', 'payload', 'metadata')`,
  );
  if (legacyCols.length > 0) {
    await db.execute(`DROP TRIGGER IF EXISTS base_entities_ai;`);
    await db.execute(`DROP TRIGGER IF EXISTS base_entities_au;`);
    await db.execute(`DROP TRIGGER IF EXISTS base_entities_ad;`);
    await db.execute(`DROP TABLE IF EXISTS base_entities_fts;`);
    await db.execute(`DROP INDEX IF EXISTS idx_base_entities_type;`);
    await dropColumnIfExists(db, 'base_entities', 'type');
    await dropColumnIfExists(db, 'base_entities', 'payload');
    await dropColumnIfExists(db, 'base_entities', 'metadata');
  }

  // Indexes
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_base_entities_parent ON base_entities(parent_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_base_entities_deleted ON base_entities(deleted_at);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_entity_aspects_entity ON entity_aspects(entity_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_entity_aspects_type ON entity_aspects(aspect_type);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_entity_aspects_tool ON entity_aspects(tool_instance_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_entity_aspects_deleted ON entity_aspects(deleted_at);`);
  await db.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS uniq_entity_aspects_scope
       ON entity_aspects(entity_id, aspect_type, IFNULL(tool_instance_id, ''));`,
  );
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_entity_relations_from ON entity_relations(from_entity_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_entity_relations_to ON entity_relations(to_entity_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_entity_relations_kind ON entity_relations(kind);`);

  // FTS5 virtual table — Phase F: indexes the new core columns.
  await db.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS base_entities_fts
    USING fts5(
      id UNINDEXED,
      title,
      description,
      tags,
      content='base_entities',
      content_rowid='rowid'
    );
  `);

  // Triggers to keep FTS in sync with the main table
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS base_entities_ai
    AFTER INSERT ON base_entities BEGIN
      INSERT INTO base_entities_fts(rowid, id, title, description, tags)
      VALUES (new.rowid, new.id, new.title, new.description, new.tags);
    END;
  `);

  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS base_entities_ad
    AFTER DELETE ON base_entities BEGIN
      INSERT INTO base_entities_fts(base_entities_fts, rowid, id, title, description, tags)
      VALUES ('delete', old.rowid, old.id, old.title, old.description, old.tags);
    END;
  `);

  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS base_entities_au
    AFTER UPDATE ON base_entities BEGIN
      INSERT INTO base_entities_fts(base_entities_fts, rowid, id, title, description, tags)
      VALUES ('delete', old.rowid, old.id, old.title, old.description, old.tags);
      INSERT INTO base_entities_fts(rowid, id, title, description, tags)
      VALUES (new.rowid, new.id, new.title, new.description, new.tags);
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
