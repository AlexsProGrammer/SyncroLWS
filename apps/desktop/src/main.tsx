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
import { useProfileStore } from './store/profileStore';
import { useWorkspaceStore } from './store/workspaceStore';

// Import the ToolRegistry — triggers manifest-based discovery
import { getAllTools, discoverAndRegisterTools } from './registry/ToolRegistry';

import { eventBus } from './core/events';

async function bootstrap(): Promise<void> {
  // ── 1. Load or create the active profile's SQLite database ─────────────────
  const { activeProfileId, profiles, createProfile } = useProfileStore.getState();

  let profileId = activeProfileId;
  if (!profileId || !profiles.some((p) => p.id === profileId)) {
    // First launch — create a default profile
    const defaultProfile = await createProfile('Default');
    profileId = defaultProfile.id;
  }

  await loadProfileDB(profileId);

  // ── 1b. Discover tools from manifests ──────────────────────────────────────
  discoverAndRegisterTools();

  // ── 1c. Load or create the default workspace ──────────────────────────────
  const wsStore = useWorkspaceStore.getState();
  await wsStore.loadWorkspaces();

  const workspaces = useWorkspaceStore.getState().workspaces;
  if (workspaces.length === 0) {
    await wsStore.createWorkspace({ name: 'Personal', icon: 'folder', color: '#6366f1' });
  } else {
    await wsStore.switchWorkspace(workspaces[0]!.id);
  }

  // ── 2. Expose helpers on window in dev mode for console verification ───────
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)['__db'] = {
      getDB,
      getWorkspaceDB,
      ftsSearch,
      /** Quick helper: insert a test entity and return its id */
      async insertTest(type = 'note', payload: Record<string, unknown> = { title: 'Test' }) {
        const db = getWorkspaceDB();
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
        const db = getWorkspaceDB();
        return db.select<{ id: string; type: string; payload: string }[]>(
          `SELECT id, type, payload FROM base_entities WHERE deleted_at IS NULL ORDER BY updated_at DESC`,
        );
      },
    };

    /** Trigger a mock sync conflict to test the DiffEditor UI */
    (window as unknown as Record<string, unknown>)['__triggerConflict'] = async () => {
      const now = new Date().toISOString();
      const base = {
        id: crypto.randomUUID(),
        type: 'note' as const,
        metadata: {},
        tags: [],
        parent_id: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };
      eventBus.emit('sync:conflict', {
        local: { ...base, payload: { title: 'My Note', content_md: 'Local version of the content.' } },
        server: { ...base, payload: { title: 'My Note', content_md: 'Server version — edit made remotely.' } },
        resolve: (resolved) => {
          console.log('[dev] conflict resolved with:', resolved);
        },
      });
      console.info('[dev] sync:conflict emitted — DiffEditor should now appear');
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
