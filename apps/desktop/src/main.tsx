// DSGVO: Local font imports — NO external CDN
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';

import { initDB, getDB, ftsSearch } from './core/db';

// Initialise modules after DB is ready (registers Event Bus listeners)
import { init as initNotes } from './modules/notes';
import { init as initTasks } from './modules/tasks';
import { init as initCalendar } from './modules/calendar';
import { init as initTimeTracker } from './modules/time-tracker';

async function bootstrap(): Promise<void> {
  // ── 1. Initialise SQLite (creates tables + FTS5 triggers if needed) ────────
  await initDB();

  // ── 2. Expose db helpers on window in dev mode for console verification ────
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)['__db'] = {
      getDB,
      ftsSearch,
      /** Quick helper: insert a test entity and return its id */
      async insertTest(type = 'note', payload: Record<string, unknown> = { title: 'Test' }) {
        const db = await getDB();
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        await db.execute(
          `INSERT OR REPLACE INTO base_entities
             (id, type, payload, metadata, tags, parent_id, created_at, updated_at)
           VALUES (?, ?, ?, '{}', '[]', NULL, ?, ?)`,
          [id, type, JSON.stringify(payload), now, now],
        );
        console.log('[db] inserted entity:', id);
        return id;
      },
      /** Quick helper: select all non-deleted entities */
      async listAll() {
        const db = await getDB();
        return db.select<{ id: string; type: string; payload: string }[]>(
          `SELECT id, type, payload FROM base_entities WHERE deleted_at IS NULL ORDER BY updated_at DESC`,
        );
      },
    };
    console.info('[dev] window.__db exposed — use __db.insertTest() / __db.listAll() / __db.ftsSearch()');
  }

  // ── 3. Register module Event Bus listeners ──────────────────────────────────
  initNotes();
  initTasks();
  initCalendar();
  initTimeTracker();

  // ── 4. Mount React ──────────────────────────────────────────────────────────
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

bootstrap().catch((err: unknown) => {
  console.error('[bootstrap] Fatal error during startup:', err);
});
