# IMPLEMENTATION.md

## 1. Project Context & Architecture

* **Goal:** Integrate a fully local-first, infinite canvas notebook system using `tldraw` into the polymorphic architecture of SyncroLWS. This maps drawing coordinates, vectors, and nodes cleanly to shape-level database assets under a granular `canvas_shape` aspect layout, bypassing massive document snapshots and enabling real-time delta sync handling.
* **Tech Stack & Dependencies:**
* **Core Frameworks:** Tauri 2.0, React, Vite, Drizzle ORM, Zod.
* **Libraries:** `@tldraw/tldraw` (Infinite canvas logic).
* **Package Command:** `cd apps/desktop && npm install @tldraw/tldraw`


* **File Structure:**
```text
├── packages/
│   └── shared-types/
│       └── src/
│           └── base-entity.ts    # Modified: Add canvas_shape aspect types and schemas
└── apps/
    └── desktop/
        └── src/
            ├── registry/
            │   └── ToolRegistry.tsx # Modified: Auto-discover canvas tool and icons
            └── modules/
                └── canvas/       # Created: New module package root
                    ├── manifest.json # Created: Tool capability specifications
                    ├── index.ts      # Created: Registry initialization endpoints
                    ├── CanvasView.tsx # Created: Infinite canvas workspace layout
                    └── hooks/
                        ├── useTldrawStore.ts # Created: Granular event listener hook
                        └── useCanvasAssets.ts # Created: Content-addressable file receiver

```


* **Attention Points:** - Do not store the entire canvas state as a single JSON text stream inside a `base_entities` row. Individual shapes must map directly to rows in the `entity_aspects` layout.
* Use Tauri's native filesystem capability to persist local image elements.


* **DSGVO:** The infinite canvas tool must function under a complete network airgap with zero external requests. External CDN resource calls for tldraw canvas assets, standard subcomponents, or rendering utilities are completely forbidden. All assets are managed locally using an offline protocol handler mapping (`tauri://localhost/media/[HASH]`).

---

## 2. Execution Phases

#### Phase 1: Shared Schema Modification & Tool Registry Discovery

* [x] **Step 1.1:** In `packages/shared-types/src/base-entity.ts`, add `'canvas_shape'` to the `ASPECT_TYPES` string array and add it to `AspectTypeSchema`.
* [x] **Step 1.2:** In `packages/shared-types/src/base-entity.ts`, create and export a validated `CanvasShapeAspectDataSchema` using Zod that structures tldraw element definitions (id, type, x, y, rotation, index, props, and parentId). Register this layout within `ASPECT_DATA_SCHEMAS`.
* [x] **Step 1.3:** Create `apps/desktop/src/modules/canvas/manifest.json`. Define the tool identifier (`"canvas"`), associate it with the `canvas_shape` type, add shortcut keys, flag `hasPortalView: true`, and define default schema config structures.
* [x] **Step 1.4:** In `apps/desktop/src/registry/ToolRegistry.tsx`, implement a custom `IconCanvas` inline SVG renderer component. Map the string key `"canvas"` to this custom SVG icon inside the global `iconMap`.
* [x] **Verification:** Run `cd packages/shared-types && npm run build` and ensure the shared models compile. Confirm the layout outputs no type verification anomalies.

#### Phase 2: Canvas Workspace Core View Integration

* [x] **Step 2.1:** Create `apps/desktop/src/modules/canvas/CanvasView.tsx`. Import the primary canvas framework components from `@tldraw/tldraw`. Build a view component that initializes the tldraw rendering envelope.
* [x] **Step 2.2:** Create `apps/desktop/src/modules/canvas/index.ts`. Implement an entrypoint file that exports an `init()` method to add initialization entries to the `ToolRegistry` pipeline. Expose methods for search filtering and command palette results.
* [x] **Step 2.3:** In `apps/desktop/src/modules/canvas/CanvasView.tsx`, configure the viewport element wrapper to leverage a standard full-size layout (`w-full h-full`) styled completely using local Tailwind configuration declarations.
* [x] **Verification:** Launch the system build via `npm run tauri dev`. Confirm the new "Canvas" tool appears within the dynamic workspace layout and the component initializes.

#### Phase 3: Shape-Level Granular Event Interception

* [x] **Step 3.1:** Create `apps/desktop/src/modules/canvas/hooks/useTldrawStore.ts`. Implement a custom React hook that accepts the active canvas session context handle.
* [x] **Step 3.2:** Wire a tldraw change notification handler using `store.listen()`. Intercept individual node changes and break the payload mutations down into discrete operation classes (`added`, `updated`, `removed`).
* [x] **Step 3.3:** Map canvas mutations directly into local storage statements using Drizzle ORM. Writes must run queries against the local `entity_aspects` workspace structure, mapping shape payloads into the `data` json column and toggling database state flags to `dirty = 1`.
* [x] **Step 3.4:** For node deletion operations, convert the execution trace into an insert statement running against the `sync_tombstones` tracking schema to preserve delete tracking across synchronized devices.
* [x] **Verification:** Open the newly created infinite canvas view. Draw several basic shapes on the board view area. Query the database directly via terminal console and check that rows matching `aspect_type = 'canvas_shape'` are populated.

#### Phase 4: Offline Content-Addressable Asset Layer

* [ ] **Step 4.1:** Create `apps/desktop/src/modules/canvas/hooks/useCanvasAssets.ts`. Build an on-disk binary interception routine targeting the canvas resource management pipeline (`onAssetUpload`).
* [ ] **Step 4.2:** When an image drop event is captured on the active viewport area, intercept the raw stream bytes, hash the signature via SHA-256, and duplicate the file asset cleanly into the secure workspace folder using `tauri-plugin-fs`.
* [ ] **Step 4.3:** If the calculated file signature match is missing from the local layout registry, execute an insert statement against `local_files` with `reference_count = 1`. Otherwise, execute an entry increment against the reference column.
* [ ] **Step 4.4:** Replace the canvas resource asset locator reference directly inside the tldraw state context with a safe local address protocol mapping pointer (`tauri://localhost/media/[HASH]`), guaranteeing complete offline file lookups.
* [ ] **Verification:** Turn off the active internet connection network links entirely. Drop a local image file onto the infinite canvas workspace area. Confirm that the image loads and is stored successfully within the active workspace.

---

## 3. Global Testing Strategy

* **Granular Shape Delta Sync Verification:**
* *Action:* Construct a canvas workspace populated with 50 distinct vector drawing layers. Modify a single vector item's outline path or positioning coordinates on the view panel surface.
* *Expected:* Check the background update pipeline log. Confirm that the system submits only the single modified shape row chunk during the sync synchronization pass rather than the entire canvas document block.


* **Airgapped Protocol Resolution Verification:**
* *Action:* Restart the Tauri compilation client with an airgapped internet link configuration. Launch a network traffic inspector alongside the application instance process.
* *Expected:* Navigate into the notebook module workspace. Ensure the trace logs capture absolutely zero requests targeting unlisted remote subdomains or external tracking services.


* **Concurrent Local Storage Write Serialization Verification:**
* *Action:* Generate complex drawing paths across multiple visual boundaries to produce high-frequency parallel write events directed at the workspace database.
* *Expected:* Ensure the local SQLite database file handles concurrent transaction entries gracefully without throwing database lock exceptions or dropping asset items.