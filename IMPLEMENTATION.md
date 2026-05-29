# IMPLEMENTATION.md

## 1. Project Context & Architecture
- **Goal:** Build a user-defined Categorical Encoder and String Enum Mapping Engine for the Analytics Suite. This system allows users to translate discrete qualitative text codes (e.g., `"H"` for Home, `"W"` for Workplace) from unstructured CSV files into continuous numeric scores directly inside the parameterized SQLite aggregation compiler via polymorphic `CASE` statement evaluation logic.
- **Tech Stack & Dependencies:**
  - **Core Frameworks:** Tauri 2.0, React, Vite, TypeScript, Drizzle ORM, Tailwind CSS.
  - **Dependencies:** Existing charting libraries (`recharts`) and state stores (`useWorkspaceStore`).
  - **Commands:** No new package manager installations are required. Uses native SQL optimization layers and React state lifting.
- **File Structure:**
  ```text
  └── apps/
      └── desktop/
          └── src/
              └── modules/
                  └── analytics/
                      ├── AnalyticsDashboard.tsx # Modified: Update reporting layout data binding
                      ├── components/
                      │   ├── AxisConfigurator.tsx       # Modified: Integrate enum selector triggers into series items
                      │   └── CategoryMappingEditor.tsx # Created: New inline dynamic dictionary mapping interface
                      └── utils/
                          └── aggregationEngine.ts       # Modified: Inject polymorphic CASE statement injection logic

```

* **Attention Points:** - The column encoder must generate safe SQL templates by restricting string-enum matching keys to validated lookups, guarding against injection profiles during `CASE WHEN` compilation blocks.
* Ensure compatibility with the multi-series structure (`ySeries: YSeriesItem[]`) introduced in Part 3.2.


* **DSGVO:** String dictionary translations, encoding weights, text tokens, and relative frequencies are processed entirely inside the local SQLite database context and front-end state parameters. No data blocks or qualitative codebooks may be transmitted to cloud services.

---

## 2. Execution Phases

#### Phase 1: Configuration Schema & TypeScript Extensions

* [x] **Step 1.1:** In `apps/desktop/src/modules/analytics/components/AxisConfigurator.tsx`, define and export a `CategoryMapping` dictionary interface type: `export type CategoryMapping = Record<string, number>;`.
* [x] **Step 1.2:** Update the `YSeriesItem` configuration interface structure to accommodate categorical mapping features. Add an option string selector `mode: 'numeric' | 'categorical';` along with an indexable container: `mappingRules: CategoryMapping;`.
* [x] **Step 1.3:** Modify `DEFAULT_AXIS_CONFIG` within the configurator module to initialize the upgraded parameter boundaries inside default arrays safely (`mode: 'numeric'`, `mappingRules: {}`).
* [x] **Verification:** Run type-checking suite `cd apps/desktop && npx tsc --noEmit` and verify the expanded type definition properties align with zero compile-time signature errors.

#### Phase 2: Category Mapping Interface Component

* [x] **Step 2.1:** Create `apps/desktop/src/modules/analytics/components/CategoryMappingEditor.tsx` to handle dictionary matching values.
* [x] **Step 2.2:** Build a configuration row interface matching the target selection schema. This component accepts a header token string name, displays a list layout tracking entries, and features an "Add Dynamic Key Value Pair" actionable trigger button.
* [x] **Step 2.3:** Implement entry rows containing two paired inputs: a string input tracking matching text keys (e.g., target placeholder `"H"`) and a secondary numeric input tracking structural numeric destination weights (e.g., placeholder `1.0`).
* [x] **Step 2.4:** Wire save events to immediately trigger lifted configuration callbacks up into the primary `AxisConfigurator` panel scope, updating the parent series item array rules index mapping context cleanly.
* [x] **Verification:** Mount `<CategoryMappingEditor headers={['WorkLoc']} value={{}} onChange={console.log} />` inside a temporary view and confirm adding/removing key-value parameters works.

#### Phase 3: Polymorphic CASE-Statement SQL Compiler

* [x] **Step 3.1:** In `apps/desktop/src/modules/analytics/utils/aggregationEngine.ts`, write a dedicated macro generator helper method named `compileCategoricalExpr(colIndex: number, mapping: CategoryMapping): string`.
* [x] **Step 3.2:** Inside `compileCategoricalExpr`, map across user-defined dictionary pairs. Convert individual properties cleanly into sequential text condition parameters formatting string outputs using explicit query matching constraints: `WHEN '${key}' THEN ${weight}`.
* [x] **Step 3.3:** Construct the final inline conditional block string architecture, closing statements with explicit defaults: `CASE json_extract(cells, '$[${colIndex}]') [WHEN CLUSTER] ELSE 0.0 END`.
* [x] **Step 3.4:** Rework the core method `aggExpr` inside the aggregation engine file. Check if the series item configuration parameter `mode === 'categorical'` evaluates to true. If active, wrap the generated conditional block string container inside the designated mathematical function parameter wrapper (`AVG`, `SUM`, `COUNT`), casting variables directly to `REAL`.
* [x] **Verification:** Open a local test file context. Pass configuration parameters containing mapping definitions `{ 'H': 1, 'W': 0 }` into `buildAggregationQuery` and ensure the generated statement matches: `AVG(CASE json_extract(cells, '$[1]') WHEN 'H' THEN 1.0 WHEN 'W' THEN 0.0 ELSE 0.0 END)`.

#### Phase 4: Axis Configurator Integration Panel

* [x] **Step 4.1:** Open `apps/desktop/src/modules/analytics/components/AxisConfigurator.tsx`. Navigate to the rendering loop block that maps out individual `ySeries` form rows.
* [x] **Step 4.2:** Insert a selection choice dropdown picker element directly into the card rows layout allowing quick toggling options between `"Numeric Data"` and `"Categorical Data Encoders"`.
* [x] **Step 4.3:** Use conditional rendering logic to display the new `<CategoryMappingEditor />` component below the selected column select dropdown box only when the `mode` parameter is explicitly configured to `"categorical"`.
* [x] **Verification:** Open the Analytics Suite Dashboard workspace inside the application window layout. Add a new metric item, switch the tracking selection field to "Categorical Data Encoders", and confirm the encoder card panel elements expand on the interface smoothly.

#### Phase 5: Dashboard Chart Aggregation Verification

* [ ] **Step 5.1:** Open `apps/desktop/src/modules/analytics/AnalyticsDashboard.tsx`. Locate the background execution callback routine `runQuery`.
* [ ] **Step 5.2:** Ensure that when a column configuration features dynamic data enum configurations, queries run cleanly through the updated `buildAggregationQuery` flow to pass matching query statement string builders onto the SQLite execution pipeline proxy.
* [ ] **Step 5.3:** Validate that if the returned dataset contains non-numeric inputs originally, the runtime query maps strings smoothly into quantitative points to populate chart timelines without breaking layout layers or generating chart errors.
* [ ] **Verification:** Run a final full workspace compilation step using `npm run build` or `npx tsc --noEmit` from the root repository workspace directories to confirm complete integration type compliance.

---

## 3. Global Testing Strategy

* **Polymorphic Code Mapping Ingestion Verification:**
* *Action:* Import a performance tracking timesheet dataset containing qualitative location entries categorized under string attributes `"H"` and `"W"`. Configure an explicit code encoder assigning `"H" -> 100.0` and `"W" -> 20.0`, computing a running metric average over the collection timeline.
* *Expected:* The rendering graph container handles raw non-numeric rows natively, outputting statistical value curves displaying performance metrics precisely matching mapped calculations.


* **SQL Protection Boundary Sanity Test:**
* *Action:* Type string injection strings inside the code matching key field boxes on the editor component area to mimic malicious validation inputs (e.g., `' OR 1=1; --`).
* *Expected:* The SQL compiler sanitizes configuration keys or formats variables cleanly inside literal parameter wrappers, dropping compile errors safely to the error panel without running bad query profiles.


* **Airgapped Relative Frequency Tracking Validation:**
* *Action:* Disconnect all active internet adapters entirely from the local machine runtime environment. Input mapping configs and calculate a running tracking total distribution chart.
* *Expected:* String tracking configurations and numerical chart vectors process on-device with zero interface lag and complete airgap security.
