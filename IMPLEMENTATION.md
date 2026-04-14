
# IMPLEMENTATION.md

## 1. Project Context & Architecture
- **Goal:** A highly modular, offline-first, enterprise-grade business management system (time tracking, notes, tasks, calendar) built for privacy and cross-platform use. It utilizes a central SQLite database with a "Base Entity" architecture, local file storage with server-side deduplication, and a robust Event Bus for decoupled tool modules, optionally syncing to a Single Source of Truth (SSOT) via PowerSync.
- **Tech Stack & Dependencies:**
  - **Monorepo:** Turborepo (`npm i -g turbo`) or npm workspaces.
  - **Frontend (Desktop/Mobile App):** Tauri 2.0, React, Vite, Tailwind CSS, `shadcn/ui` (bundled locally), `mitt` (Event Bus), `dnd-kit` (Kanban), `cmdk` (Command Palette), `@tiptap/react` (Markdown/Editor), `diff-match-patch` (Diffing).
  - **Backend (API & Sync):** Node.js, Express, `trpc/server`, PowerSync (Server-side configuration), `multer` (File handling).
  - **Database & ORM:** PostgreSQL (Server), SQLite (Tauri Local via `tauri-plugin-sql`), Drizzle ORM (`drizzle-orm`, `drizzle-kit`), `sqlite-vec` or FTS5 extensions for search.
  - **File Storage:** MinIO (S3-compatible) for server, Tauri File System API for local.
- **File Structure:**
  ```text
  ├── packages/
  │   └── shared-types/       # tRPC routers, Base Entity schemas, Event Bus types
  ├── apps/
  │   ├── backend/            # Express, tRPC API, MinIO file processing
  │   │   ├── src/
  │   │   │   ├── db/         # Drizzle Postgres schema
  │   │   │   ├── routes/     # tRPC endpoints, Upload handlers
  │   │   │   └── web/        # Client-Portal web views (Next.js or minimal React)
  │   │   └── docker-compose.yml # Postgres, PowerSync, MinIO
  │   └── desktop/            # Tauri 2.0 + React
  │       ├── src-tauri/      # Rust logic, OS Hooks (Window Tracker), Deep Linking
  │       ├── src/
  │       │   ├── core/       # DB Manager, PowerSync Client, Event Bus init
  │       │   ├── ui/         # Base Layout, cmdk, shadcn (LOCAL FONTS ONLY)
  │       │   └── modules/    # Toolkit (tasks, notes, calendar, time-tracker)
  ```
- **Attention Points:** Strict modularity (modules communicate only via Event Bus). File hashing for deduplication requires Reference Counting in the DB. Ensure robust SQLite FTS5 integration for the command palette. Base Entities must share common fields (ID, type, created_at, tags, parent_id).
- **DSGVO (GDPR):** Zero external CDN calls. All fonts (`@fontsource`), icons, and CSS must be bundled locally in `apps/desktop`. Telemetry is strictly prohibited. Client data must support a "hard wipe" cascading deletion.

---

## 2. Execution Phases (Backend / Server)

#### Phase 1: [Backend Infrastructure & Database State]
- [ ] **Step 1.1:** Initialize a Node.js project in `apps/backend` and install `drizzle-orm`, `pg`, `express`, and `@trpc/server`.
- [ ] **Step 1.2:** In `apps/backend/src/db/schema.ts`, define the PostgreSQL schema. Create a `base_entities` table (id, type, payload JSONB, metadata, timestamps) and a `files` table (hash, path, reference_count, size).
- [ ] **Step 1.3:** Configure `drizzle-kit` to output migrations. Create a `docker-compose.yml` defining PostgreSQL and MinIO services.
- [ ] **Verification:** Run `docker-compose up -d` and `npx drizzle-kit push:pg`. Verify the tables exist in the Postgres container using a database viewer.

#### Phase 2: [API, tRPC, & File Hashing Logic]
- [ ] **Step 2.1:** In `apps/backend/src/routes/trpc.ts`, establish the base tRPC router exporting types to `packages/shared-types`.
- [ ] **Step 2.2:** In `apps/backend/src/routes/upload.ts`, create a POST endpoint using `multer` that accepts a file, calculates its SHA-256 hash, and checks the `files` table.
- [ ] **Step 2.3:** Implement Reference Counting logic: If hash exists, increment `reference_count` and return existing MinIO path. If not, upload to MinIO, insert to DB with count 1.
- [ ] **Verification:** Run `curl -X POST -F "file=@test.jpg" http://localhost:3000/upload`. Verify the file is in MinIO and DB. Run it again with the same file and verify `reference_count` increments instead of creating a duplicate.

#### Phase 3: [Client Portal Web View]
- [ ] **Step 3.1:** In `apps/backend/src/web/`, initialize a minimal React or Next.js build configured to be served via Express static routing at `/portal/:projectId`.
- [ ] **Step 3.2:** Build a read-only view that fetches `base_entities` associated with a specific project ID via tRPC, displaying modular data based on the entity `type`.
- [ ] **Verification:** Run the backend server, navigate to `http://localhost:3000/portal/test-id` in a browser, and verify the mock project data renders.

---

## 2. Execution Phases (Frontend / Tauri Desktop)

#### Phase 4: [Tauri Scaffold & Local SQLite Setup]
- [ ] **Step 4.1:** Initialize the Tauri app in `apps/desktop` using `npm create tauri-app@latest` (select React, Vite, TypeScript).
- [ ] **Step 4.2:** In `src-tauri/Cargo.toml`, add `tauri-plugin-sql`, `tauri-plugin-fs`, and `tauri-plugin-deep-link`.
- [ ] **Step 4.3:** In `apps/desktop/src/core/db.ts`, setup the local SQLite connection using Drizzle ORM. Ensure the `base_entities` table includes an FTS5 virtual table for high-speed searching.
- [ ] **Verification:** Run `npm run tauri dev`. Open the devtools console, execute a raw insert into SQLite via the frontend DB manager, and verify it persists upon app restart.

#### Phase 5: [Event Bus & Core UI Toolkit]
- [ ] **Step 5.1:** In `apps/desktop/src/core/events.ts`, initialize the `mitt` Event Bus instance (`export const eventBus = mitt<AppEvents>();`).
- [ ] **Step 5.2:** Install Tailwind CSS, download all required `@fontsource` packages locally, and integrate `shadcn/ui` components (buttons, dialogs, inputs) into `apps/desktop/src/ui/`.
- [ ] **Step 5.3:** Implement the Global Command Palette using `cmdk` in `src/ui/CommandPalette.tsx`. Bind it to `Ctrl+K`/`Cmd+K` and wire it to query the SQLite FTS5 table.
- [ ] **Verification:** Run the app, press `Ctrl+K`, type a query, and verify the console logs the matching SQLite FTS5 results. Disconnect internet and verify UI fonts/icons load perfectly.

#### Phase 6: [Module Architecture & Diff Editor]
- [ ] **Step 6.1:** Create `apps/desktop/src/modules/notes/` and `apps/desktop/src/modules/tasks/`. Each module must export an `init()` function that registers listeners on the `eventBus` (e.g., `eventBus.on('sync:conflict', handleDiff)`).
- [ ] **Step 6.2:** Build the Diff Editor component in `src/ui/DiffEditor.tsx` using `diff-match-patch`. It must accept `localData` and `serverData` and output a combined `resolvedData` JSON object.
- [ ] **Step 6.3:** Implement TipTap in the Notes module, ensuring Markdown is saved as a raw string inside the `payload` column of the `base_entities` SQLite table. Bi-directional links (`[[Name]]`) should be parsed via a custom TipTap extension.
- [ ] **Verification:** Trigger a mock sync conflict event. Verify the Diff Editor popup appears, highlights textual differences, and allows the user to select the preferred version.

#### Phase 7: [Power Features & OS Integration]
- [ ] **Step 7.1:** In `src-tauri/src/lib.rs`, configure the Deep Link plugin to register the custom URI scheme `meinapp://`. Emit a Tauri event to React when a link is opened.
- [ ] **Step 7.2:** Implement an OS Window hook in Rust to poll the currently active window title every 60 seconds. Expose this to React via a Tauri command `get_active_window()`.
- [ ] **Step 7.3:** In `src/modules/time-tracker`, listen for window changes and auto-suggest time logs.
- [ ] **Step 7.4:** Implement a backup scheduler in `src/core/backup.ts` using `setInterval` to dump the local SQLite `.db` file to a configured backup directory on the hard drive.
- [ ] **Verification:** Run the compiled Tauri app. Type `meinapp://test/123` in a web browser address bar; verify the Tauri app comes to focus and logs `/test/123` in the console.

---

## 3. Global Testing Strategy

- **Offline-to-Online Sync Conflict:** - *Action:* Disconnect internet. Modify Note A locally. Modify Note A in the Postgres Database directly (simulating another device). Reconnect internet. 
  - *Expected:* Sync pauses. Global event triggers Diff Editor UI. User resolves. SSOT updates.
- **Reference Count Deletion:**
  - *Action:* Upload `image.png` to two different Tasks. Delete Task 1. 
  - *Expected:* Task 1 is removed, file remains on disk/MinIO. Delete Task 2. `reference_count` hits 0. File is physically deleted from the local disk and MinIO.
- **DSGVO Airgap Test:**
  - *Action:* Route app traffic through a network monitor (e.g., Wireshark or Proxyman). Navigate all modules.
  - *Expected:* ZERO network requests to `fonts.googleapis.com`, CDN providers, or telemetry endpoints. All traffic strictly goes to localhost or the predefined Sync server URL.
- **Event Bus Decoupling:**
  - *Action:* Delete or comment out the `init()` function for the Calendar module.
  - *Expected:* The app compiles and runs. Creating a Task with a due date does not crash the app, the event simply safely drops.
