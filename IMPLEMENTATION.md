```markdown
# IMPLEMENTATION.md

## 1. Project Context & Architecture
- **Goal:** Create an isolated, high-performance local analytics sandbox workspace inside SyncroLWS capable of ingestion and aggregation of large historical CSV datasets. This architecture passes raw flat-file processing onto Tauri's Rust core to run heavy I/O operations asynchronously in transactional batches, bypassing front-end single-threaded rendering bottlenecks.
- **Tech Stack & Dependencies:**
  - **Core Frameworks:** Tauri 2.0, React, Vite, Drizzle ORM, Tailwind CSS.
  - **Rust Crates (src-tauri):** `csv = "1.3"`, `serde_json = "1.0"`, `rusqlite = { version = "*", features = ["bundled"] }` (or corresponding Tauri plugin sql engine driver).
  - **Frontend Libraries:** `lucide-react` (Local icons), `recharts` or local SVG chart primitives for data rendering.
  - **Commands:** - `cd apps/desktop/src-tauri && cargo add csv serde_json`
    - `cd apps/desktop && npm install recharts`
- **File Structure:**
  ```text
  ├── apps/
  │   └── desktop/
  │       ├── src-tauri/
  │       │   └── src/
  │       │       └── commands.rs   # Modified: Register native CSV batch parsing command
  │       └── src/
  │           ├── core/
  │           │   └── db.ts         # Modified: Extend workspace schema migrations
  │           ├── registry/
  │           │   └── ToolRegistry.tsx # Modified: Register analytics tool icon map
  │           └── modules/
  │               └── analytics/    # Created: New business analytics module
  │                   ├── manifest.json # Created: Tool discovery config
  │                   ├── index.ts      # Created: Entrypoint initialization
  │                   ├── AnalyticsDashboard.tsx # Created: High-performance dashboard container
  │                   ├── components/
  │                   │   ├── CSVImportZone.tsx   # Created: File picker & Rust thread invoker
  │                   │   └── AxisConfigurator.tsx # Created: Field mapper selection interface
  │                   └── utils/
  │                       └── aggregationEngine.ts # Created: Dynamic SQL generator

```

* **Attention Points:** - Large tabular records must live exclusively inside the dedicated analytical sandbox tables. Do not mix un-indexed arbitrary datasets into the primary `base_entities` table to protect global search index performance.
* Raw imports must happen via native streaming layers. Front-end memory allocation arrays must never hold raw multi-megabyte CSV strings.


* **DSGVO:** Dataset evaluations, computed statistics, file paths, and column values must reside strictly on the local sandbox instance. Transmitting analytical parameters, tracking values, metric headers, or record content to external calculation or modeling cloud instances is strictly prohibited.

---

## 2. Execution Phases

#### Phase 1: Isolated Sandbox Schema Migrations

* [x] **Step 1.1:** In `apps/desktop/src/core/db.ts`, locate the `WORKSPACE_MIGRATION` constant query string block.
* [x] **Step 1.2:** Append table definition instructions to create `analytics_datasets` (id TEXT PK, name TEXT, row_count INTEGER, headers TEXT, created_at TEXT).
* [x] **Step 1.3:** Append table definition instructions to create `analytics_raw_records` (id INTEGER PK AUTOINCREMENT, dataset_id TEXT, row_index INTEGER, cells TEXT). Ensure the `cells` column accepts stringified raw layout arrays.
* [x] **Step 1.4:** Append explicit indexing commands to create a fast composite index named `idx_raw_records_dataset` tracking the `dataset_id` foreign field key.
* [x] **Verification:** Restart the application environment. Verify using a database client or log query trace that both sandbox tables exist in the underlying active workspace file with indices initialized.

#### Phase 2: Rust-Powered Background CSV Stream Importer

* [x] **Step 2.1:** In `apps/desktop/src-tauri/src/commands.rs`, introduce a new cross-platform command function `stream_csv_to_sqlite(file_path: String, dataset_id: String, db_path: String) -> Result<u64, String>`.
* [x] **Step 2.2:** Inside this function, open a streaming reader pointing to `file_path` using the native Rust `csv::Reader` crate interface. Extract the first row automatically to map collection headers.
* [x] **Step 2.3:** Open a connection directly to the profile workspace database matching `db_path`. Build a chunk collection loop that aggregates parsed entries into discrete vectorized record slots.
* [x] **Step 2.4:** Every 5,000 row intervals, wrap database writes inside an explicit transaction execution block (`BEGIN TRANSACTION` / `COMMIT`). Format individual cell blocks as clean stringified arrays before pushing them to the SQLite statement engine. Update `analytics_datasets` upon stream exhaustion to reflect total rows and headers.
* [x] **Step 2.5:** Ensure the command is correctly bound to the execution harness setup within `apps/desktop/src-tauri/src/main.rs`.
* [x] **Verification:** Run `cd apps/desktop/src-tauri && cargo check` to confirm compiling integrity of your native background workers.

#### Phase 3: Module Assembly & Dynamic Tool Registration

* [x] **Step 3.1:** Create `apps/desktop/src/modules/analytics/manifest.json`. Configure the registry file metadata with id `"analytics"`, name `"Analytics Suite"`, icon key `"analytics"`, and define layout permissions.
* [x] **Step 3.2:** In `apps/desktop/src/registry/ToolRegistry.tsx`, create and export an inline SVG renderer called `IconAnalytics`. Map the key `"analytics"` to this custom asset inside the global configuration block.
* [x] **Step 3.3:** Create `apps/desktop/src/modules/analytics/index.ts` to register the main tool view reference components, linking it directly into the system auto-discovery lookup cycle.
* [x] **Step 3.4:** Create `apps/desktop/src/modules/analytics/AnalyticsDashboard.tsx` to handle the primary view architecture, rendering a stateful framework structure using local workspace contexts.
* [x] **Verification:** Launch the environment suite via `npm run tauri dev`. Navigate onto the workspace dashboard view shell and check if the layout responds with correct routing headers.

#### Phase 4: Stream Ingestion UI Component Interface

* [x] **Step 4.1:** Create `apps/desktop/src/modules/analytics/components/CSVImportZone.tsx`. Integrate Tauri's system-level file picker dialog component (`@tauri-apps/plugin-dialog`).
* [x] **Step 4.2:** On file resolution path selection, generate a deterministic UUID string tracking parameter to identify the newly created tracking asset collection.
* [x] **Step 4.3:** Fetch the absolute file location path strings and invoke the native Rust back-end operation handler via `invoke('stream_csv_to_sqlite', { ... })`, feeding execution updates through custom application tracking states.
* [x] **Verification:** Trigger the file select action dialog box from the front-end interface dashboard. Confirm it correctly identifies standard desktop files and prints path updates to your browser console logs.

#### Phase 5: Dynamic Aggregation Query Generation Setup

* [x] **Step 5.1:** Create `apps/desktop/src/modules/analytics/components/AxisConfigurator.tsx`. Render dropdown fields allowing interactive column selector states mapping parameters into coordinate axis references.
* [x] **Step 5.2:** Create `apps/desktop/src/modules/analytics/utils/aggregationEngine.ts`. Implement a dynamic SQL string compiler utility method that generates native SQLite query definitions.
* [x] **Step 5.3:** Leverage raw `json_extract()` operators inside your generated queries to extract arrays stored in the `cells` text property, computing statistical fields (`AVG`, `SUM`, `COUNT`) grouped exactly by the selected coordinate values.
* [x] **Step 5.4:** Map raw query execution datasets from the local database proxy layer into separate left and right Recharts Y-axis plotting collections (`yAxisId="primary"`, `yAxisId="secondary"`).
* [ ] **Verification:** Run a project-wide type compilation verification step via `npm run build` or `npx tsc --noEmit` and confirm all module integrations complete with zero interface warnings.

---

## 3. Global Testing Strategy

* **UI Thread UI Un-lock Verification:**
* *Action:* Provision a flat mock data file container holding 150,000 dense accounting records. Initiate ingestion via `CSVImportZone.tsx` while clicking high-frequency UI interactions across unrelated sidebar modules.
* *Expected:* Front-end animation framing stays lock-free at 60fps throughout ingestion execution phases. No scripting timeouts may occur.


* **Dynamic Extracted Mapping Correctness:**
* *Action:* Change visual chart configuration selectors to map an integer dataset row to X, a revenue calculation row to Y1 (average compilation), and volume weights to Y2 (sum calculation).
* *Expected:* Ensure the raw query compiles with correct database dialect filters and the dual-axis graph renders without errors.


* **Airgapped Storage Sandbox Check:**
* *Action:* Block outgoing interfaces completely. Load large records containing metric metrics and look up local data directory trace paths.
* *Expected:* The dataset processes flawlessly, writing variables exclusively to the local tracking structures without external network requirements.

