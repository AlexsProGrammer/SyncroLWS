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

import { loadProfileDB, getDB, getWorkspaceDB, ftsSearch } from './core/db';
import { initDeepLink } from './core/deep-link';

// Import the ToolRegistry — triggers manifest-based discovery
import { getAllTools, discoverAndRegisterTools } from './registry/ToolRegistry';

import { eventBus } from './core/events';

async function bootstrap(): Promise<void> {
  // ── Phase T: idle/lock watcher ────────────────────────────────────────────
  const { startIdleWatcher } = await import('./core/lock');
  startIdleWatcher();

  // ── Phase S: expiry watcher (no-op until a user token exists) ────────────
  const { startTokenExpiryWatcher } = await import('./core/auth');
  startTokenExpiryWatcher();

  // ── 1. Discover tools from manifests (always, before React mounts) ────────
  // ProfileGate (rendered by App.tsx) handles DB loading, workspace loading,
  // and profile config restoration via setActiveProfile().
  discoverAndRegisterTools();

  // ── 2. Expose helpers on window in dev mode for console verification ───────
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)['__db'] = {
      getDB,
      getWorkspaceDB,
      ftsSearch,
      /** Quick helper: insert a test entity (Phase F hybrid shape) and return its id */
      async insertTest(title = 'Test', _aspectType = 'note') {
        const db = getWorkspaceDB();
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        await db.execute(
          `INSERT OR REPLACE INTO base_entities
             (id, title, description, color, icon, tags, parent_id, created_at, updated_at)
           VALUES (?, ?, '', '#6366f1', 'box', '[]', NULL, ?, ?)`,
          [id, title, now, now],
        );
        console.log('[db] inserted entity:', id);
        return id;
      },
      /** Quick helper: select all non-deleted entities */
      async listAll() {
        const db = getWorkspaceDB();
        return db.select<{ id: string; title: string; description: string }[]>(
          `SELECT id, title, description FROM base_entities WHERE deleted_at IS NULL ORDER BY updated_at DESC`,
        );
      },
    };

    /** Trigger a mock sync conflict to test the engine's `sync:conflict` event flow. */
    (window as unknown as Record<string, unknown>)['__triggerConflict'] = () => {
      eventBus.emit('sync:conflict', {
        kind: 'core',
        id: crypto.randomUUID(),
        server_revision: 42,
      });
      console.info('[dev] sync:conflict emitted (Phase I shape — UI lands in Phase N)');
    };

    /** Simulate a deep-link open for verification: __deepLink('/test/123') */
    (window as unknown as Record<string, unknown>)['__deepLink'] = (path: string, params: Record<string, string> = {}) => {
      eventBus.emit('deeplink:received', { path, params });
      console.info('[dev] deeplink:received emitted:', path, params);
    };

    console.info('[dev] window.__db + window.__triggerConflict() + window.__deepLink() exposed');
  }

  // ── 3. Register module Event Bus listeners (dynamic from ToolRegistry) ──────
  for (const tool of getAllTools()) {
    if (tool.init) tool.init();
  }

  // ── 3b. Phase I: start the sync engine. It no-ops until a workspace is
  // loaded AND the device is paired (deviceToken + syncUrl + isSyncActive).
  const { syncEngine } = await import('./core/sync');
  syncEngine.start();

  // ── 4. Register OS deep-link listener (bridges Tauri event → eventBus) ──────
  await initDeepLink();

  // ── 5. Mount React ──────────────────────────────────────────────────────────
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

bootstrap().catch((err: unknown) => {
  console.error('[bootstrap] Fatal error during startup:', err);

  // Render a visible error so developers aren't left with a blank white screen.
  const root = document.getElementById('root');
  if (root) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    root.style.cssText =
      'display:flex;align-items:center;justify-content:center;height:100vh;' +
      'font-family:monospace;background:#0f172a;color:#f87171;padding:2rem;box-sizing:border-box';
    root.innerHTML = `
      <div style="max-width:640px;width:100%">
        <h2 style="color:#fb923c;margin:0 0 .75rem">SyncroLWS — startup error</h2>
        <pre style="white-space:pre-wrap;word-break:break-all;background:#1e293b;padding:1rem;
                    border-radius:.5rem;font-size:.8rem;color:#e2e8f0">${message}</pre>
        <p style="margin:.75rem 0 0;font-size:.75rem;color:#94a3b8">
          Open DevTools (F12) for the full stack trace.
        </p>
      </div>`;
  }
});
