# IMPLEMENTATION.md

## 1. Project Context & Architecture
- **Goal:** Refactor the analytics workspace rendering subsystem from a rigid dual-axis configuration into an open, dynamic multi-series array architecture. This allows users to add an arbitrary number of quantitative metrics to a single chart timeline and overlay different polymorphic visual layout configurations (Bar, Line, Area) simultaneously.
- **Tech Stack & Dependencies:**
  - **Core Frameworks:** Tauri 2.0, React, Vite, Drizzle ORM, TypeScript.
  - **Charting Engine:** `recharts` (utilizing `ComposedChart`, `Bar`, `Line`, `Area`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `Legend`).
  - **Commands:** No new packages are required; uses the existing project-wide Recharts charting installation.
- **File Structure:**
  ```text
  └── apps/
      └── desktop/
          └── src/
              └── modules/
                  └── analytics/
                      ├── AnalyticsDashboard.tsx # Modified: Update query execution and render loop
                      ├── components/
                      │   └── AxisConfigurator.tsx # Modified: Redesign multi-series configuration panel
                      └── utils/
                          └── aggregationEngine.ts # Modified: Dynamic SQL generator and chart point mapper

```

* **Attention Points:** - Data mapping keys passed into Recharts elements must align exactly with the dynamic fields produced by the query parser to avoid rendering blank frames.
* Predefined or custom color choices must be tracked safely within individual series objects to prevent index alignment issues when items are removed.


* **DSGVO:** Chart configurations, dynamic series matrices, metric color variables, and visualization layouts live strictly in the on-device interface state memory and profile container, entirely free from third-party tracking pixels or telemetry engines.

---

## 2. Execution Phases

#### Phase 1: Shared Configuration Interfaces & Type Refactoring

* [x] **Step 1.1:** In `apps/desktop/src/modules/analytics/components/AxisConfigurator.tsx`, define and export a new `YSeriesItem` TypeScript interface:
```typescript
export interface YSeriesItem {
  colId: number | null;
  agg: AggFn;
  drawType: 'line' | 'bar' | 'area';
  fillHex: string;
}

```


* [x] **Step 1.2:** Refactor the `AxisConfig` interface to remove `y1Col`, `y1Agg`, `y2Col`, and `y2Agg`, replacing them with a strict array container: `ySeries: YSeriesItem[];`.
* [x] **Step 1.3:** Update `DEFAULT_AXIS_CONFIG` to initialize with an empty `ySeries` array.
* [x] **Step 1.4:** In `apps/desktop/src/modules/analytics/utils/aggregationEngine.ts`, update `AggRow` and `ChartPoint` to support indexable data maps:
```typescript
export interface AggRow {
  x_val: string;
  [key: string]: string | number | null;
}

```


* [x] **Verification:** Run `cd apps/desktop && npx tsc --noEmit` and confirm that type compilation errors are limited strictly to unused references in `AnalyticsDashboard.tsx`.

#### Phase 2: Dynamic SQL Generation & Record Mapping

* [x] **Step 2.1:** In `apps/desktop/src/modules/analytics/utils/aggregationEngine.ts`, modify `buildAggregationQuery` to check if `config.xCol` is null or if `config.ySeries` is empty, returning `null` if true.
* [x] **Step 2.2:** Inside `buildAggregationQuery`, replace the static `y1Expr` and `y2Expr` template strings. Map over the `config.ySeries` array where `colId !== null`, passing the individual metrics to `aggExpr()` and mapping them to dynamic projection aliases matching `y_val_${index}`.
* [x] **Step 2.3:** Update the `SELECT` query statement to inject the dynamic aggregated column array string entries separated by clean comma tokens.
* [x] **Step 2.4:** In `mapToChartPoints`, rewrite the mapping loop to dynamically scan the fields of `AggRow`. For each array entry found in the series template configuration, read `r[`y_val_${index}`]` and assign the numeric values directly into the result object using the charting index key `y_${index}`.
* [x] **Verification:** Execute the type checking command `npx tsc --noEmit` within `apps/desktop` to confirm utility function signature compliance.

#### Phase 3: Dynamic Multi-Series Axis Configurator UI

* [x] **Step 3.1:** Open `apps/desktop/src/modules/analytics/components/AxisConfigurator.tsx`. Retain the top single-column dropdown panel selector matching the coordinate X Axis structure.
* [x] **Step 3.2:** Beneath the X Axis dropdown, build a dynamic vertical form collection panel mapping directly over the `value.ySeries` array list using a `.map()` layout expression.
* [x] **Step 3.3:** For each configured item in the row loop, render a layout row containing:
* A column picker component `<ColSelect />`.
* An aggregation method selector `<AggSelect />`.
* A chart visualization type dropdown selector containing options for `Line`, `Bar`, and `Area`.
* A standard HTML inline hex color picker field `<input type="color" />` styled with a neat border template wrapper.
* A click-action delete button to remove that specific element row index from the active configuration array.


* [x] **Step 3.4:** Add an "Add Series Metric" icon button row component directly at the bottom boundary of the list tracker view. When clicked, append a fresh `YSeriesItem` object to the collection array with default values (`colId: null`, `agg: 'AVG'`, `drawType: 'bar'`, `fillHex: '#6366f1'`).
* [x] **Verification:** Open the Analytics module dashboard workspace in the Tauri application window. Click the "Add Series Metric" selector multiple times and check that the configuration rows spawn independently in the control panel space.

#### Phase 4: Polymorphic Visualization Layer Compilation

* [x] **Step 4.1:** Open `apps/desktop/src/modules/analytics/AnalyticsDashboard.tsx`. Update the view validation conditions to ensure a dataset is selected and `axisConfig.ySeries.some(s => s.colId !== null)` evaluates to true before attempting chart compilation.
* [x] **Step 4.2:** Import the component token item `Area` from the local `recharts` package workspace at the top header area of the file.
* [x] **Step 4.3:** Inside the `<ComposedChart>` node, delete the hardcoded single `<Bar />` and secondary `<Line />` layout components.
* [x] **Step 4.4:** Replace them with a runtime loop mapping directly over `axisConfig.ySeries`. For each item where `colId !== null`, inspect the `drawType` property and conditionally mount the corresponding `<Bar />`, `<Line />`, or `<Area />` component dynamically.
* [x] **Step 4.5:** Bind the Recharts configuration properties for each mapped element: set `dataKey` to `y_${index}`, set the name attribute to match `${s.agg}(${headers[s.colId]})`, and apply `fill={s.fillHex}` or `stroke={s.fillHex}` fields based on the selected drawing style.
* [x] **Verification:** Run a full project-wide code verification trace via `npm run build` or `npx tsc --noEmit` from the desktop repository root to ensure type safety.

---

## 3. Global Testing Strategy

* **Polymorphic Layer Overlay Rendering Verification:**
* *Action:* Import a multi-column numerical dataset. Configure three distinct tracking parameters: add Metric 1 as a `Bar` styled in blue, Metric 2 as a `Line` styled in gold, and Metric 3 as an `Area` chart colored in emerald green.
* *Expected:* The rendering container displays all three statistical layers on the timeline area simultaneously without clipping data points or dropping visualization dimensions.


* **Dynamic Series Element Deletion Safety:**
* *Action:* Configure 4 concurrent data series panels on the interface. Click the remove button row component targeting the middle metric item layout index (Index position 1) while a query is computing.
* *Expected:* The system deletes the selected row, dynamically collapses the tracking index maps smoothly, updates data pointers, and refreshes the chart visualization instantly without throwing layout pointer runtime faults.


* **Empty Array State Fallback Verification:**
* *Action:* Select an active tracking file dataset from the sidebar column, but clear or delete all series rows inside the axis configurator panel layout area.
* *Expected:* The visualization container transitions into a clean fallback display window showing an informative descriptive prompt message: `"Select at least one Y series metric above to render a chart."`
