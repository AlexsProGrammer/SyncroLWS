# IMPLEMENTATION.md for SyncroLWS Part 4

## 1. Project Context & Architecture

* **Goal:** Build the Premium Time Intelligence & Life-Bucket Automation Studio module for SyncroLWS. This module elevates basic time logs into structured data through an automated regex tokenization pipeline, computes multi-scale sliding/tumbling statistical windows locally, and delivers predictive text entry suggestions and active billing milestones without cloud-based computation platforms.
* **Tech Stack & Dependencies:**
* **Core Frameworks:** Tauri 2.0, React, Vite, Drizzle ORM, Zod.
* **Libraries:** `lucide-react` (Local icons), `recharts` (Metric graphs), `@tauri-apps/api` (Native notifications).
* **Package Commands:** - `cd apps/desktop && npm install recharts`


* **File Structure:**
```text
├── packages/
│   └── shared-types/
│       └── src/
│           └── base-entity.ts    # Modified: Verify time_log aspect data compatibility
└── apps/
    └── desktop/
        └── src/
            ├── ui/
            │   └── CommandPalette.tsx # Modified: Inject custom analytical search syntax
            └── modules/
                ├── time-tracker/
                │   └── TimeTrackerView.tsx # Modified: Wire automated tokenization hooks
                └── time-intelligence/    # Created: New intelligence analytics root
                    ├── manifest.json     # Created: Tool registry declaration
                    ├── index.ts          # Created: Module initialization entrypoint
                    ├── IntelligenceDashboard.tsx # Created: Premium reporting container
                    ├── components/
                    │   ├── LiveRegexTerminal.tsx  # Created: Dynamic pattern validator
                    │   └── ForecastPredictor.tsx  # Created: Predictive modeling interface
                    └── utils/
                        ├── logParser.ts          # Created: Tokenizer execution engine
                        └── metricsCalculator.ts  # Created: Advanced SQLite aggregate windows

```


* **Attention Points:** - Automated category parsing must write macro life buckets directly into the core entity `tags` array field using strict prefixes (`"bucket:work"`, `"bucket:life"`, `"bucket:school_uni"`) to remain fully searchable by the global FTS5 indexing engine.
* Statistical summaries must be calculated natively using raw window function strings compiled across local SQLite datasets.


* **DSGVO:** All regular expression configurations, raw description strings, hours tracked, financial earnings metrics, and academic study schedules must reside safely within the isolated profile SQLite container. No parsing steps, tracking telemetry, or computed summaries may be uploaded to third-party endpoints.

---

## 2. Execution Phases

#### Phase 1: Regex Tokenization & Bucket Classification Pipeline

* [x] **Step 1.1:** Create `apps/desktop/src/modules/time-intelligence/utils/logParser.ts`. Implement a tokenization function `parseTimeLogDescription(rawStr: string)` that extracts project anchors enclosed in brackets `^\[(.*?)\]` and trailing label sequences marked by `#(\w+)`.
* [x] **Step 1.2:** Implement a classification scoring routine inside `logParser.ts`. If the token string matches configurable array keywords (e.g., `"lecture"`, `"study"`, `"assignment"`), map it to the `school_uni` bucket; if it hits tracking values containing billable client codes, map it to `work`; otherwise, route to `life`.
* [x] **Step 1.3:** Modify `apps/desktop/src/modules/time-tracker/TimeTrackerView.tsx`. Intercept text input submission hooks. Run incoming descriptions through `parseTimeLogDescription`, extract the mapped project field metadata, and append the appropriate classification labels (`bucket:work`, `bucket:life`, `bucket:school_uni`) directly onto the core entity `tags` payload before saving. And fix in TimeTrackerView currently only uses the bottom half of screen, insteaf of the full height.
* [x] **Step 1.4:** Create `apps/desktop/src/modules/time-intelligence/components/LiveRegexTerminal.tsx`. Build an interactive administration settings control container using `shadcn` inputs to let users test custom regex criteria patterns with matching colors against sample text arrays.
* [ ] **Verification:** Open the browser developer tools console inside the Tauri runtime. Submit a mock entry text `"[CompanyAlpha] Implemented api schema #refactor"`. Verify the logged save payload automatically populates `project: "CompanyAlpha"`, isolates clean text, and attaches tags `["bucket:work", "refactor"]`.

#### Phase 2: Sliding/Tumbling Window Statistical Aggregators

* [x] **Step 2.1:** Create `apps/desktop/src/modules/time-intelligence/utils/metricsCalculator.ts`. Implement advanced metrics computation methods that consume raw database client references via `getWorkspaceDB()`.
* [x] **Step 2.2:** Build a multi-scale analytical tracking query utilizing native SQLite window functions (`avg(daily) OVER (ORDER BY day ROWS BETWEEN 30 PRECEDING AND CURRENT ROW)`) to extract true sliding/tumbling tracking behaviors (daily profiles, rolling weekly velocities, monthly bounds, and yearly variances).
* [x] **Step 2.3:** Integrate custom SQL operators inside the query strings to evaluate string searches against descriptions, calculating precise project-level time totals, billable ratios, and tag concentrations across targeted date ranges.
* [ ] **Verification:** Write a basic automated unit test harness or trigger a data retrieval execution directly within `metricsCalculator.ts`. Confirm it outputs structural statistical arrays in under 50ms without blocking UI interactions.

#### Phase 3: Dynamic Module Infrastructure & Premium Interface

* [x] **Step 3.1:** Create `apps/desktop/src/modules/time-intelligence/manifest.json`. Configure module discovery specifications with structural properties (id: `"time-intelligence"`, name: `"Time Intelligence Suite"`, icon mapping pointer: `"timer"`).
* [x] **Step 3.2:** Create `apps/desktop/src/modules/time-intelligence/index.ts` to register tool entrypoints and connect view routers cleanly into the system module lookup loop.
* [x] **Step 3.3:** Create `apps/desktop/src/modules/time-intelligence/IntelligenceDashboard.tsx`. Build a modern visual analytics reporting dashboard layout featuring grid metric indicators, split bucket summaries, and interactive chart panels utilizing Recharts components.
* [ ] **Verification:** Start the runtime client environment package via `npm run tauri dev`. Confirm the new "Time Intelligence" module acts as a valid sidebar target, routing cleanly to an empty metrics dashboard view.

#### Phase 4: Predictive Inference Engine & Milestone Alerts

* [x] **Step 4.1:** Create `apps/desktop/src/modules/time-intelligence/components/ForecastPredictor.tsx`. Implement a predictive text input change controller designed to wrap basic description input boxes.
* [x] **Step 4.2:** Build an analytical lookup hook `useTimePredictor(inputVal: string)`. As a user types, match partial inputs against historical descriptions. If standard text pairings exist, auto-suggest the historical baseline project and suggest expected time allocations using calculated average deviations.
* [x] **Step 4.3:** Implement a local threshold calculation daemon thread loop inside `IntelligenceDashboard.tsx`. Compute the accumulated unbilled value totals (`duration_seconds * hourly_rate_cents`) grouped per unique client identifier.
* [x] **Step 4.4:** Check active billable totals against target milestone settings. When metrics exceed configuration limits, invoke Tauri's native platform notification system (`@tauri-apps/api/notification`) to fire immediate on-device desktop alert frames.
* [ ] **Verification:** Type an initial sequence matching past input tracking strings (e.g., `"Dev"`) inside the input layout. Confirm the interface responds by displaying expected duration suggestion tags underneath the layout container.

#### Phase 5: Global Command Palette Analytics Overlay

* [x] **Step 5.1:** Open `apps/desktop/src/ui/CommandPalette.tsx`. Locate input string change listener blocks.
* [x] **Step 5.2:** Add a custom analytical token router block. When input fields are populated with targeted prefix arguments (such as typing `:time` or `:stats`), intercept standard FTS database lookups.
* [x] **Step 5.3:** Direct execution flows to run immediate queries against the custom statistical window methods inside `metricsCalculator.ts`. Display real-time hour counters and category tags as active search card options right inside the launcher layout area.
* [ ] **Verification:** Press `Ctrl+K`/`Cmd+K` to toggle the global search view layout container open. Enter the analytical syntax string `:time`. Verify the search modal presents running category counters instead of standard record results.

---

## 3. Global Testing Strategy

* **Polymorphic Search Accuracy Verification:**
* *Action:* Log an engineering track item with the string description value `"[ProjectX] Core Refactoring #uni-exam"`. Execute a global command menu lookup search query targeting the token text `"exam"`.
* *Expected:* The record must appear instantly in search results, demonstrating that automated tag tokenization maps correctly to the FTS5 virtual shadow table.


* **Airgapped Mathematical Boundary Consistency:**
* *Action:* Disconnect all network adapter endpoints entirely. Log multiple hours of performance tracker records spread unevenly across historical logging intervals.
* *Expected:* Metric calculations, window trends, and Dual-Y Recharts aggregations compute accurately on-device. No outbound network requests may exit the sandbox environment.


* **High-Frequency Suggester Lag Mitigation:**
* *Action:* Input text entries inside the description container at high characters-per-second typing speeds to simulate high-frequency baseline data access requests.
* *Expected:* Auto-suggestion loops must debounce lookups gracefully, rendering prediction results with less than 16ms of UI rendering frame delay.