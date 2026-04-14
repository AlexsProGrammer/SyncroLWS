import Database from '@tauri-apps/plugin-sql';

let _db: Database | null = null;

/**
 * Returns the singleton SQLite database connection.
 * Call once at app startup via initDB().
 */
export async function getDB(): Promise<Database> {
  if (_db) return _db;
  _db = await Database.load('sqlite:syncrohws.db');
  return _db;
}

/**
 * Run once at application startup.
 * Creates the base_entities table and its FTS5 virtual table for full-text search.
 * Also creates the local files reference table.
 */
export async function initDB(): Promise<void> {
  const db = await getDB();

  // ── base_entities ──────────────────────────────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS base_entities (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      payload     TEXT NOT NULL DEFAULT '{}',
      metadata    TEXT NOT NULL DEFAULT '{}',
      tags        TEXT NOT NULL DEFAULT '[]',
      parent_id   TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      deleted_at  TEXT
    );
  `);

  // ── FTS5 virtual table (mirrors text columns for fast full-text search) ────
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

  // ── local_files ────────────────────────────────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS local_files (
      hash            TEXT PRIMARY KEY,
      local_path      TEXT NOT NULL,
      mime_type       TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes      INTEGER NOT NULL,
      reference_count INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL
    );
  `);

  console.log('[db] SQLite initialised');
}

/**
 * Perform an FTS5 full-text search across all base_entities.
 * Returns matching entity IDs ordered by rank.
 */
export async function ftsSearch(query: string): Promise<string[]> {
  const db = await getDB();
  // Sanitise: escape double-quotes, wrap in FTS5 phrase
  const safe = query.replace(/"/g, '""');
  const rows = await db.select<{ id: string }[]>(
    `SELECT id FROM base_entities_fts WHERE base_entities_fts MATCH ? ORDER BY rank LIMIT 50`,
    [`"${safe}"`],
  );
  return rows.map((r) => r.id);
}
