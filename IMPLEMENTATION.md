# IMPLEMENTATION.md

## 1. Project Context & Architecture

* **Goal:** Build a robust, offline-first Tokenized Preprocessing Engine and Dynamic Expression Formula Parser for the Analytics Suite. This system intercepts unstructured data fields (e.g., `"1h 30min"` or `"12v"`) from raw CSV datasets, utilizes capturing regex patterns to extract key variables, and evaluates mathematical formulas (e.g., `hour + (minutes / 60)`) to generate clean numerical charts via local JavaScript pre-aggregation pipelines before rendering.
* **Tech Stack & Dependencies:**
* **Core Infrastructure:** Tauri 2.0, React, Vite, TypeScript, Tailwind CSS, Recharts.
* **Ecosystem Libraries:** Existing workspace dependencies (`lucide-react`, `recharts`, `drizzle-orm`).
* **Commands:** No new package installations required. Employs native JavaScript `RegExp` engines and sandboxed token arithmetic parsing.


* **File Structure:**
```text
└── apps/
    └── desktop/
        └── src/
            └── modules/
                └── analytics/
                    ├── AnalyticsDashboard.tsx # Modified: Integrated pre-aggregation workflow
                    ├── components/
                    │   └── AxisConfigurator.tsx # Modified: Dynamic token extraction setup controls
                    └── utils/
                        └── aggregationEngine.ts # Modified: Regex evaluator and JS aggregation reducer

```


* **Attention Points:** - Because core SQLite lacks standard regular expression capture-group capabilities natively, data transformations must occur inside a highly optimized JavaScript pre-aggregation engine when preprocessing rules are active.
* The expression evaluator must use a secure mathematical tokenizer to isolate operations, explicitly banning arbitrary string executions (`eval`, `Function`) to preserve application safety.


* **DSGVO:** Preprocessing rule strings, custom regular expressions, extracted string tokens, and computed results are completely contained within the local UI thread memory and workspace databases. No telemetry blocks, configuration sync parameters, or payload samples may be logged to cloud analytics nodes.

---

## 2. Execution Phases

#### Phase 1: Preprocessing Configuration Schema Expansion

* [x] **Step 1.1:** In `apps/desktop/src/modules/analytics/components/AxisConfigurator.tsx`, define and export a `PreprocessConfig` TypeScript interface:
```typescript
export interface PreprocessConfig {
  enabled: boolean;
  regexPattern: string;      // e.g. "(?<hour>\\d+)h\\s*(?<minutes>\\d+)min"
  formulaExpression: string; // e.g. "hour + (minutes / 60)"
}

```


* [x] **Step 1.2:** Update the `AxisConfig` interface to include optional preprocessing configuration properties for all dimensions: `xPreprocess?: PreprocessConfig;`, `y1Preprocess?: PreprocessConfig;`, and `y2Preprocess?: PreprocessConfig;`.
* [x] **Step 1.3:** Update the `DEFAULT_AXIS_CONFIG` object to populate these fields with default unconfigured values (`enabled: false`, `regexPattern: ""`, `formulaExpression: ""`).
* [x] **Verification:** Run `npm run tauri dev` inside `apps/desktop` and confirm that type compilation passes with zero configuration interface mismatch exceptions.

#### Phase 2: Axis Configurator Dropdown & UI Controls

* [x] **Step 2.1:** In `apps/desktop/src/modules/analytics/components/AxisConfigurator.tsx`, build a collapsible subcomponent `<PreprocessModal />` or `<PreprocessPanel />` styled using local `shadcn` and Tailwind container primitives.
* [x] **Step 2.2:** Add an interactive inline button label (e.g., `"f(x) Clean Data"`) directly adjacent to the X Axis, Y1 Primary, and Y2 Secondary dropdown column selection elements.
* [x] **Step 2.3:** Map input fields inside this interface to update the `regexPattern` string and `formulaExpression` validation fields on the active column configurations via the existing lifted `onChange` handler. Include clear placeholder help descriptions showing sample regex parameters (`(?<val>\d+)`) and arithmetic examples.
* [x] **Verification:** Open the Analytics Dashboard in the application UI view. Click the preprocessing toggle links and verify the inputs reveal layout inputs cleanly, updating the configuration states successfully.

#### Phase 3: Sandboxed Mathematical Expression Evaluator

* [ ] **Step 3.1:** In `apps/desktop/src/modules/analytics/utils/aggregationEngine.ts`, create a secure helper function `evaluateSafeFormula(formula: string, tokens: Record<string, number>): number`.
* [ ] **Step 3.2:** Implement a localized scanning parser within `evaluateSafeFormula`. Replace string match variables corresponding to the extracted token naming definitions with their concrete floating-point numbers.
* [ ] **Step 3.3:** Parse the basic arithmetic string operators strictly by separating inputs sequentially against addition, subtraction, multiplication, and division characters (`+`, `-`, `*`, `/`). Block any script block injection vectors by refusing to route evaluations through runtime string executes (`eval`). Return `0` if fields are invalid or formatting parameters fail.
* [ ] **Verification:** Open a temporary debug log file or add a console check trace. Pass formula statement strings such as `"h + (m / 60)"` paired with values `{ h: 1, m: 30 }` and confirm the calculation engine correctly registers a numeric value output of `1.5`.

#### Phase 4: JavaScript In-Memory Aggregation Pipeline

* [ ] **Step 4.1:** In `apps/desktop/src/modules/analytics/utils/aggregationEngine.ts`, adjust `buildAggregationQuery` behavior. If no preprocessing flags are toggled active, return the existing query format. If any preprocessing configuration is set to true, alter the query compilation to pull the unaggregated text contents (`json_extract(cells, '$[N]')`) directly from the table database blocks up to a strict window limit of 10,000 records.
* [ ] **Step 4.2:** Build an internal row transformation worker function named `applyLocalPreprocessing(rawRows: any[], config: AxisConfig, headers: string[])`.
* [ ] **Step 4.3:** Inside this mapping loop, apply the configured regular expressions using native JavaScript matching routines (`new RegExp()`). Extract capturing group parameters, feed them to `evaluateSafeFormula`, and compute calculated numeric numbers for each coordinate index row.
* [ ] **Step 4.4:** Process the resulting preprocessed arrays using in-memory JavaScript array reductions to perform the active aggregation routines (`AVG`, `SUM`, `COUNT`) grouped uniformly by the computed X value strings, sorting data points to feed directly into the chart display loops.
* [ ] **Verification:** Load a testing file dataset containing raw un-formatted time intervals. Configure preprocessor filters on the active columns. Verify that the application prints properly grouped clean dataset points to the terminal stream.

#### Phase 5: Dashboard Processing Pipeline Integration

* [ ] **Step 5.1:** Open `apps/desktop/src/modules/analytics/AnalyticsDashboard.tsx`. Locate the internal callback trigger function `runQuery`.
* [ ] **Step 5.2:** Intercept the execution path where `db.select` fetches data points. Check if any preprocessing rules are checked active inside the `axisConfig` object.
* [ ] **Step 5.3:** If processing rules apply, map the raw input array records directly through `applyLocalPreprocessing` before passing the computed points to `setChartPoints()`, updating application error display windows gracefully if bad regex boundaries throw syntax errors.
* [ ] **Verification:** Run a workspace-wide type verification sweep using `npx tsc --noEmit` from the workspace root to confirm all layout components connect with type safety.

---

## 3. Global Testing Strategy

* **Complex Regex Extraction Verification:**
* *Action:* Import an operational logs list dataset holding text attributes patterned as `"Duration: 4h 15m"`. Apply a capturing string expression `Duration:\s*(?<hours>\d+)h\s*(?<mins>\d+)m` matched to formula `hours + (mins / 60)`.
* *Expected:* The rendering container parses text cells cleanly, computing coordinate positions precisely matching float outputs equal to `4.25`.


* **Malicious Formula Injection Rejection:**
* *Action:* Input a malicious tracking string expression inside the application configuration UI formula input box designed to steal local records or execute arbitrary logic (e.g., `window.alert(1)` or `alert(document.cookie)`).
* *Expected:* The tokenized formula parsing utility safely catches the invalid parameter layout format, drops processing execution instantly, and reports a clear query format alert to the dashboard notification window.


* **Airgapped Calculation Boundary Check:**
* *Action:* Completely disconnect all networking options from the desktop testing machine. Enter data cleaning filters across a 5,000 row analytics report layer.
* *Expected:* In-memory calculations and statistical chart layers render instantly without crashing the interface or attempting external script downloads.