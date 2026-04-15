
# IMPLEMENTATION.md

## 1. Project Context & Architecture
- **Goal:** Refactor and upgrade the "SyncroLWS" boilerplate into a fully modular, profile-isolated enterprise tool. Core upgrades include migrating local Raw SQL to Drizzle ORM, implementing UUID-based profile isolation (each profile gets its own folder and SQLite database), building a dynamic Tool Registry (no hardcoded switches), and adding optional backend sync configuration via UI and `.env`.
- **Tech Stack & Dependencies:**
  - **Monorepo:** Turborepo or npm workspaces.
  - **Frontend:** Tauri 2.0, React, Vite, Tailwind CSS, Zustand (State Management), `shadcn/ui`, `dnd-kit` (Kanban), `@tiptap/react` (Notes).
  - **Backend:** Node.js, Express, `trpc/server`, Drizzle ORM, `zod` (Env validation), PowerSync.
  - **Database & Storage:** PostgreSQL (Server), SQLite (Local via Drizzle + `tauri-plugin-sql`), local file system via Tauri APIs.
- **File Structure Additions:**
  ```text
  ├── apps/
  │   ├── backend/
  │   │   ├── src/config/     # Zod strict env validation
  │   └── desktop/
  │       ├── src/
  │       │   ├── store/      # Zustand stores (ProfileStore, SyncStore)
  │       │   ├── registry/   # Tool Registry (dynamic module loader)
  │       │   ├── modules/    # Unchanged, but decoupled via registry
  ```
- **Attention Points:** - **Database Isolation:** Tools must NOT have their own database. Instead, **Profiles** have their own database and file folder using UUIDs (e.g., `~/.local/share/syncrolws/profiles/<UUID>/data.sqlite` and `/files/`). This ensures Global Search (FTS5) across all tools within a profile still works instantly.
  - **Migration:** Replace all `db.execute('CREATE TABLE...')` in the desktop app with Drizzle ORM migrations.
- **DSGVO (GDPR):** Zero external CDN calls. Local fonts only. Profiles are strictly isolated on the hard drive via UUID folders. Optional sync must be explicit opt-in via Settings UI.

---

## 2. Execution Phases

#### Phase 1: [Backend Strict Config & Sync Prep]
- [x] **Step 1.1:** In `apps/backend/src/config/env.ts`, implement a strict environment validator using `zod`. Require `DATABASE_URL`, `MINIO_URL`, `JWT_SECRET`, and `POWERSYNC_URL`.
- [x] **Step 1.2:** Update `apps/backend/src/index.ts` to fail fast on startup if `env.ts` validation fails.
- [x] **Step 1.3:** In `apps/backend/docker-compose.yml`, update the `postgres` service to include `command: postgres -c wal_level=logical` (required for PowerSync).
- [ ] **Verification:** Run `cd apps/backend && npm run start`. It should crash with a Zod error if `.env` is missing variables. Add `.env`, restart, and ensure it boots successfully.

#### Phase 2: [Tauri Profile Isolation & UUID Folders]
- [x] **Step 2.1:** In `apps/desktop/src-tauri/src/main.rs`, create a Tauri command `create_profile_folder(uuid: String)`. It must use `tauri::api::path::app_data_dir` to create the path: `profiles/<uuid>/files/`.
- [x] **Step 2.2:** In `apps/desktop/src/store/profileStore.ts`, create a Zustand store to manage `activeProfileId` (UUID) and `profiles` (list of {id, name}).
- [x] **Step 2.3:** Refactor `apps/desktop/src/core/db.ts`. Remove raw SQL table creation. Set the DB path dynamically based on the Zustand `activeProfileId`: `sqlite://profiles/${activeProfileId}/data.sqlite`.
- [x] **Step 2.4:** Set up `drizzle-kit` for the desktop app. Generate SQLite migrations for the `base_entities` table and run them using `migrate()` from `drizzle-orm/sqlite-proxy` on profile load.
- [ ] **Verification:** Run the desktop app. Use the Redux/React devtools to set an `activeProfileId` UUID. Check the OS AppData folder and verify a `profiles/<UUID>/data.sqlite` file and `files/` folder were physically created.

#### Phase 3: [Dynamic Tool Registry & Settings UI]
- [ ] **Step 3.1:** Create `apps/desktop/src/registry/ToolRegistry.ts`. Define `interface Tool { id: string; name: string; icon: React.FC; component: React.FC; }`. Register the existing tools (Notes, Tasks, Calendar, TimeTracker) here.
- [ ] **Step 3.2:** In the Profile SQLite DB, add a table `active_tools (profile_id, tool_id, is_enabled)`.
- [ ] **Step 3.3:** Create `apps/desktop/src/ui/SettingsView.tsx`. Fetch registered tools and render `shadcn` toggle switches. Save toggle state to the `active_tools` DB table.
- [ ] **Step 3.4:** Refactor `apps/desktop/src/ui/Sidebar.tsx` and `ModuleViews.tsx`. Remove the hardcoded `switch` statements. Query the `active_tools` table and dynamically `.map()` over the `ToolRegistry` to render the sidebar icons and routes.
- [ ] **Verification:** Open the Settings view. Toggle the "Calendar" off. Verify the Calendar icon immediately disappears from the Sidebar and the route becomes inaccessible. 

#### Phase 4: [Frontend Sync Configuration]
- [ ] **Step 4.1:** Create `apps/desktop/src/store/syncStore.ts` using Zustand to hold `syncUrl`, `apiKey`, and `isSyncActive`. Persist this state using Zustand's `persist` middleware (local storage).
- [ ] **Step 4.2:** In `SettingsView.tsx`, add a "Sync Configuration" tab. Add input fields for URL and API Key, and a "Test Connection" button.
- [ ] **Step 4.3:** Create a tRPC health-check query in the backend. On "Test Connection", trigger this query using the provided URL.
- [ ] **Verification:** Enter a dummy URL in the UI, click "Test Connection". Verify it fails. Start the backend, enter `http://localhost:3000`, click Test, and verify it shows a "Connection Successful" toast.

#### Phase 5: [Tool "Muscle" Implementation]
- [ ] **Step 5.1:** *Tasks:* In `apps/desktop/src/modules/tasks/index.tsx`, install `@dnd-kit/core`. Fetch `base_entities` where `type = 'task'`. Render them in standard Kanban columns (Todo, In Progress, Done). Dragging a card must update the `payload.status` JSON property in SQLite.
- [ ] **Step 5.2:** *Notes:* In `NoteEditor.tsx`, implement a `useEffect` with a 1000ms debounce. Automatically `db.update` the `base_entities` `payload.content` field when the TipTap editor content changes. No manual "Save" button allowed.
- [ ] **Step 5.3:** *Search:* In `CommandPalette.tsx`, bind the input query to a Drizzle query utilizing the SQLite `MATCH` operator against the FTS5 virtual table of `base_entities`.
- [ ] **Verification:** Create a Note, type text, wait 1 second. Close the app completely. Reopen the app, go to Notes, and verify the text is still there (Auto-save verification). Press `Ctrl+K`, search a word from that note, and verify it appears instantly.

---

## 3. Global Testing Strategy
- **UUID Data Bleed Test:**
  - Create Profile A. Create Note "Secret A".
  - Switch to Profile B. 
  - Verify Note "Secret A" does not exist in the UI or Search. Verify Profile B's SQLite file does not contain the data.
- **Dynamic Routing Fallback:**
  - Deactivate "Tasks" in Settings. 
  - Attempt to navigate to `/tasks` manually via Deep Link or modified State. Verify the app redirects to a safe fallback (e.g., `/settings` or `/notes`).
- **Sync Airgap:**
  - Ensure `syncEnabled` is set to `false`. Trigger file uploads and note saves. Monitor network traffic via devtools. Verify absolutely zero outbound network requests are made.
