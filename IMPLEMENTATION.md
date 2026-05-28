# IMPLEMENTATION.md

## 1. Project Context & Architecture
- **Goal:** Harden the core replication engine of SyncroLWS by introducing atomic server-side sync push transactions, enforcing strict transaction-safe write-through policies between Zustand memory stores and local SQLite files, and deploying a resilient chunk-based file upload pipeline for deduplicated content-addressed files.
- **Tech Stack & Dependencies:**
  - **Core Ecosystem:** Tauri 2.0, React, TypeScript, Node.js, Express, tRPC.
  - **Database Management:** PostgreSQL (Backend Engine), SQLite (Local via `tauri-plugin-sql`), Drizzle ORM.
  - **Commands:** - `cd apps/backend && npm install fs-extra crypto`
    - `cd apps/desktop && npm install async-mutex`
- **File Structure:**
  ```text
  ├── apps/
  │   ├── backend/
  │   │   └── src/
  │   │       └── routes/
  │   │           ├── sync.ts       # Modified: Atomic push transactions
  │   │           └── upload.ts     # Modified: Chunked file receiver endpoints
  │   └── desktop/
  │       └── src/
  │           ├── core/
  │           │   ├── db.ts         # Modified: Write-lock Mutex mechanism
  │           │   ├── sync.ts       # Modified: Rollback-resilient loop handlers
  │           │   └── upload.ts     # Created: Binary chunk file slicing engine
  │           └── store/
  │               ├── profileStore.ts # Modified: Direct SQLite write-throughs
  │               └── workspaceStore.ts # Modified: Direct SQLite write-throughs

```

* **Attention Points:** - All database queries executed within a loop during a sync synchronization round must be bound to the identical database transaction lifecycle context.
* Simultaneous operations on the local SQLite file must be serialized to prevent file access lock violations.


* **DSGVO:** No payload, tracking parameter, block data, or hashing information may be transmitted to external telemetry endpoints or third-party cloud hosting providers. Staging files must be swept cleanly upon network lifecycle termination.

---

## 2. Execution Phases

#### Phase 1: Server-Side Atomic Push Transactions

* [x] **Step 1.1:** In `apps/backend/src/routes/sync.ts`, locate the `pushProcedure` mutation block. Wrap the entire internal loop logic (handling cores, aspects, relations, and deletes) inside a Drizzle PostgreSQL transaction block using `await db.transaction(async (tx) => { ... })`.
* [x] **Step 1.2:** Update all query expressions inside the `pushProcedure` loops (such as `db.select`, `db.insert`, `db.delete`) to evaluate exclusively using the transaction context handle `tx`.
* [x] **Step 1.3:** Implement a termination check within the transaction context. If an uncaught application error or constraint validation failure occurs during execution, explicitly throw a `TRPCError` with code `INTERNAL_SERVER_ERROR` to force an immediate transaction rollback on the Postgres engine.
* [x] **Verification:** Execute `cd apps/backend && npx tsc --noEmit` and confirm that the project compiles with no type verification anomalies.

#### Phase 2: Client-Side Push Robustness & Sync Fallback

* [x] **Step 2.1:** In `apps/desktop/src/core/sync.ts`, modify `runSyncCycle()` where `trpcMutation` calls `sync.push`. Wrap the execution call inside an active `try/catch` statement block.
* [x] **Step 2.2:** Update the error handling handler inside `runSyncCycle()`. If the remote endpoint sends an explicit error frame or a network exception occurs, interrupt processing immediately, bypass `applyPushResult`, and preserve the local table rows with their `dirty = 1` status flags intact.
* [x] **Step 2.3:** Add a sliding debounce delay interval to the tracking queue if an explicit synchronization push rejection occurs to avoid continuous request hammering loops.
* [x] **Verification:** Run `cd apps/desktop && npx tsc --noEmit` and confirm that the frontend files compile without type conflicts.

#### Phase 3: Zustand-to-SQLite Write-Through Enforcement

* [x] **Step 3.1:** In `apps/desktop/src/core/db.ts`, import `Mutex` from `async-mutex`. Initialize a global write mutational mutex handle: `const writeMutex = new Mutex();`.
* [x] **Step 3.2:** Add a wrapped execution helper method `export async function executeWriteAtomic(callback: () => Promise<void>)` that runs the underlying query block safely within a `writeMutex.runExclusive` handler.
* [x] **Step 3.3:** In `apps/desktop/src/store/workspaceStore.ts` and `apps/desktop/src/store/profileStore.ts`, identify state actions that modify task, profile, or folder attributes. Force these functions to execute a write through directly into the local SQLite file via `executeWriteAtomic` before committing state updates to active memory.
* [x] **Verification:** Launch the Tauri compilation suite via `npm run tauri dev` and verify that parallel store modifications execute without throwing SQLite file access errors.

#### Phase 4: Backend Chunked File Storage API

* [ ] **Step 4.1:** In `apps/backend/src/routes/upload.ts`, declare three new tRPC procedures: `upload.initChunked`, `upload.pushChunk`, and `upload.finalizeChunked`.
* [ ] **Step 4.2:** Implement `initChunked` to accept file hashes and sizes, then provision a tracking record inside a local temporary file metadata store.
* [ ] **Step 4.3:** Implement `pushChunk` to receive zero-indexed payload chunks and append incoming binary data blocks onto a temporary staging file located inside `/tmp/syncro_staging/[HASH]`.
* [ ] **Step 4.4:** Implement `finalizeChunked` to verify the complete staging file signature using Node's native `crypto` module. If the SHA-256 validation matches, push the binary artifact into the MinIO container bucket, increment the `reference_count` field inside the `files` table, and delete the temporary disk staging file.
* [ ] **Verification:** Send an explicit mock execution sequence payload via `curl` to `upload.initChunked` followed by chunk pushes, and verify the compiled file outputs into the active object store.

#### Phase 5: Client-Side File Chunking Engine

* [ ] **Step 5.1:** Create `apps/desktop/src/core/uploadEngine.ts`. Implement a file parsing loop that reads on-disk storage structures via Tauri's `tauri-plugin-fs` system binary file reading interface.
* [ ] **Step 5.2:** Build an extraction routine that breaks files down into consecutive binary blocks of ` Uint8Array` allocations matching a uniform chunk size configuration value.
* [ ] **Step 5.3:** Connect the output stream of the file picking interfaces to the `uploadEngine.ts` workflow module. Ensure file assets use chunked streaming uploads rather than single-shot HTTP POST requests.
* [ ] **Verification:** Trigger a file upload trace path from the desktop UI layout and ensure large attachments are uploaded successfully as tracked chunks.

---

## 3. Global Testing Strategy

* **Server Crash Mid-Push Recovery:**
* *Action:* Initialize a push synchronization payload sequence. Introduce an explicit execution fault loop inside `apps/backend/src/routes/sync.ts` halfway through processing.
* *Expected:* The backend database logs an absolute transaction rollback. Validate that no partial database attributes or broken relational tables exist on the Postgres server instance.


* **Sudden Window Termination Preservation:**
* *Action:* Trigger a sequence of intense rapid state modifications across task items inside the UI view, then kill the Tauri window thread immediately using a system signal (`kill -9`).
* *Expected:* Reopen the application shell and ensure the local SQLite database file state aligns with the last memory layout changes, verifying the write-through architecture.


* **Network Interruption Chunk Resilience:**
* *Action:* Initiate a file upload, then disconnect the internet network interface card during chunk transmission. Reconnect the network link shortly after.
* *Expected:* The streaming client engine recovers gracefully without restarting the entire file upload workflow from scratch.

