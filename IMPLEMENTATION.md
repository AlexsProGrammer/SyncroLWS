
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

#### Phase 1: [Backend Infrastructure & Database State] ✅
- [x] **Step 1.1:** Initialize a Node.js project in `apps/backend` and install `drizzle-orm`, `pg`, `express`, and `@trpc/server`.
- [x] **Step 1.2:** In `apps/backend/src/db/schema.ts`, define the PostgreSQL schema. Create a `base_entities` table (id, type, payload JSONB, metadata, timestamps) and a `files` table (hash, path, reference_count, size).
- [x] **Step 1.3:** Configure `drizzle-kit` to output migrations. Create a `docker-compose.yml` defining PostgreSQL and MinIO services.
- [x] **Verification:** Run `docker-compose up -d` and `npx drizzle-kit push`. Verified `base_entities` + `files` tables with all indexes in Postgres container. Backend health endpoint responding on `http://localhost:3000/health`.

#### Phase 2: [API, tRPC, & File Hashing Logic] ✅
- [x] **Step 2.1:** In `apps/backend/src/routes/trpc.ts`, establish the base tRPC router exporting types to `packages/shared-types`.
- [x] **Step 2.2:** In `apps/backend/src/routes/upload.ts`, create a POST endpoint using `multer` that accepts a file, calculates its SHA-256 hash, and checks the `files` table.
- [x] **Step 2.3:** Implement Reference Counting logic: If hash exists, increment `reference_count` and return existing MinIO path. If not, upload to MinIO, insert to DB with count 1.
- [x] **Verification:** Verified via curl: same file uploaded twice → `deduplicated: true`, `reference_count` increments on second upload. MinIO path consistent across uploads.

#### Phase 3: [Client Portal Web View] ✅
- [x] **Step 3.1:** In `apps/backend/src/web/`, initialized a minimal React + Vite build. Express serves it at `/portal` (static) and `/portal/:projectId` (SPA fallback).
- [x] **Step 3.2:** Built a read-only view (`portal.tsx`) that fetches `base_entities` via `GET /trpc/entities.list` filtered by `parent_id`, displaying entities grouped by `type` (notes, tasks, calendar events, time logs) with inline styles (zero CDN — GDPR compliant).
- [x] **Verification:** `GET /portal/11111111-1111-1111-1111-111111111111` → HTTP 200, serves React SPA. tRPC list confirmed returning 6 seeded entities (note ×2, task ×2, calendar_event ×2) grouped by type. `npm run build:web` bundles in 1.06s, 147 kB gzipped to 48 kB.

---

## 2. Execution Phases (Frontend / Tauri Desktop)

#### Phase 4: [Tauri Scaffold & Local SQLite Setup] ✅
- [x] **Step 4.1:** Initialize the Tauri app in `apps/desktop` using `npm create tauri-app@latest` (select React, Vite, TypeScript).
- [x] **Step 4.2:** In `src-tauri/Cargo.toml`, add `tauri-plugin-sql`, `tauri-plugin-fs`, and `tauri-plugin-deep-link`.
- [x] **Step 4.3:** In `apps/desktop/src/core/db.ts`, setup the local SQLite connection using `@tauri-apps/plugin-sql`. `base_entities` table + FTS5 virtual table with INSERT/UPDATE/DELETE sync triggers. `initDB()` called at bootstrap in `main.tsx` before React mounts.
- [x] **Verification:** `npm run tauri dev` compiles (539 crates, 1m 24s first-time) and launches. TypeScript clean (EXIT:0). `cargo check` passes (EXIT:0). `window.__db` exposed in devtools for `insertTest()` / `listAll()` / `ftsSearch()` verification.

#### Phase 5: [Event Bus & Core UI Toolkit] ✅
- [x] **Step 5.1:** `apps/desktop/src/core/events.ts` — `export const eventBus = mitt<AppEvents>()` singleton, used by all modules and `App.tsx`.
- [x] **Step 5.2:** Tailwind CSS v3 + `postcss`/`autoprefixer` configured. `@fontsource/inter` (400/500/600/700) + `@fontsource/jetbrains-mono` imported locally in `main.tsx` (GDPR-compliant, zero CDN). shadcn/ui primitives created as local source files in `src/ui/components/`: `button.tsx` (CVA variants), `input.tsx`, `dialog.tsx` (controlled, portal-less), `badge.tsx`. `src/lib/utils.ts` provides `cn()` via `clsx` + `tailwind-merge`. Barrel export in `src/ui/index.ts`.
- [x] **Step 5.3:** `src/ui/CommandPalette.tsx` — `cmdk` `<Command>` with live FTS5 query via `ftsSearch()`. `Ctrl+K`/`Cmd+K` handler wired in `App.tsx` via `eventBus.emit('nav:open-command-palette')`. Results mapped with type badge + title; selecting emits `nav:open-entity`.
- [x] **Verification:** TypeScript check passes (EXIT:0). All UI CSS variables defined (light/dark). Fonts served locally — zero external network requests.

#### Phase 6: [Module Architecture & Diff Editor] ✅
- [x] **Step 6.1:** All four modules (`notes`, `tasks`, `calendar`, `time-tracker`) export `init()` — each registers typed `eventBus` listeners. Notes: `sync:conflict` → notification + bi-directional link indexing. Tasks: `entity:created` → due-date notification, `sync:conflict` handler. Calendar: CRUD event logging (decoupling-safe). Time-tracker: 60 s window poll via `invoke('get_active_window')` → `tracker:window-changed`.
- [x] **Step 6.2:** `src/ui/DiffEditor.tsx` — side-by-side character-level diff using `diff-match-patch`. Accepts `local`/`server` `BaseEntity`, renders colour-coded INSERT/DELETE/EQUAL spans. Three resolution modes: keep Local, keep Server, or 3-way auto-merge via `patch_apply`. Wired into `App.tsx` via `eventBus.on('sync:conflict')` — calls back through the event's `resolve()` callback on confirm.
- [x] **Step 6.3:** `src/modules/notes/NoteEditor.tsx` — TipTap editor (`StarterKit`, `Highlight`, `Link`, `Placeholder`). Markdown saved as raw string in `payload.content_md` via debounced autosave (800 ms) + save-on-unmount. `src/modules/notes/WikiLinkExtension.ts` — custom ProseMirror plugin: decorates `[[Name]]` spans with `wiki-link` CSS class; click handler resolves link text against SQLite → emits `nav:open-entity`.
- [x] **Verification:** TypeScript EXIT:0. `window.__triggerConflict()` exposed in dev mode — call it in devtools to emit `sync:conflict` and verify the DiffEditor overlay appears with highlighted differences and Local/Server/Merged resolution buttons.

#### Phase 7: [Power Features & OS Integration]
- [ ] **Step 7.1:** In `src-tauri/src/lib.rs`, configure the Deep Link plugin to register the custom URI scheme `syncrolws://`. Emit a Tauri event to React when a link is opened.
- [ ] **Step 7.2:** Implement an OS Window hook in Rust to poll the currently active window title every 60 seconds. Expose this to React via a Tauri command `get_active_window()`.
- [ ] **Step 7.3:** In `src/modules/time-tracker`, listen for window changes and auto-suggest time logs.
- [ ] **Step 7.4:** Implement a backup scheduler in `src/core/backup.ts` using `setInterval` to dump the local SQLite `.db` file to a configured backup directory on the hard drive.
- [ ] **Verification:** Run the compiled Tauri app. Type `syncrolws://test/123` in a web browser address bar; verify the Tauri app comes to focus and logs `/test/123` in the console.

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
