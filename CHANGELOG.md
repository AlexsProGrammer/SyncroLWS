# Changelog

## [0.3.0] — 2026-05-29

### Added — Categorical Encoder & String Enum Mapping Engine

- **`CategoryMapping` type & `YSeriesItem` extensions** (`AxisConfigurator.tsx`) — exported `CategoryMapping = Record<string, number>` type; `YSeriesItem` extended with required `mode: 'numeric' | 'categorical'` and `mappingRules: CategoryMapping`; new series defaults initialised with `mode: 'numeric'` and `mappingRules: {}`.
- **`CategoryMappingEditor` component** (`CategoryMappingEditor.tsx`) — new fully-controlled inline dictionary editor; renders paired string-key / numeric-weight input rows; "Add Dynamic Key Value Pair" button appends blank draft rows without triggering parent resets; JSON-equality sync guard prevents spurious row wipes on reference-identical parent re-renders; all processing is local — no network calls (DSGVO compliant).
- **Polymorphic CASE-statement SQL compiler** (`aggregationEngine.ts`) — `compileCategoricalExpr(colIndex, mapping)` builds a parameterised SQLite `CASE json_extract(cells, '$[N]') WHEN ... ELSE 0.0 END` expression; keys are SQL-escaped (`'` → `''`); weights are always safe `.toFixed(1)` floats; empty mapping safely returns `0.0` literal to avoid invalid SQL; `aggExpr` updated to branch on `mode === 'categorical'` and wrap the CASE expression inside the configured aggregate function.
- **Mode selector dropdown** (`AxisConfigurator.tsx`) — compact inline `<select>` per Y-series row toggling between "Numeric Data" and "Categorical Data Encoders"; `<CategoryMappingEditor />` rendered conditionally below each row when mode is categorical; header label resolves to the selected column name.
- **Dashboard normalization & error messaging** (`AnalyticsDashboard.tsx`) — `normalizeAxisConfig` helper back-fills `mode` and `mappingRules` defaults on configs persisted before this feature; generic error message updated to not mislead users in categorical mode.


### Added — Tokenized Preprocessing Engine & Dynamic Expression Formula Parser

- **`PreprocessConfig` schema** (`AxisConfigurator.tsx`) — new exported interface with `enabled`, `regexPattern`, and `formulaExpression` fields; `AxisConfig` extended with optional `xPreprocess`, `y1Preprocess`, `y2Preprocess`; `DEFAULT_AXIS_CONFIG` populated with safe disabled defaults.
- **Axis Configurator UI** (`AxisConfigurator.tsx`) — collapsible `<PreprocessPanel />` revealed per-axis via a compact `f(x)` toggle button; panel includes an enable `Switch`, a monospace regex input (with named-group placeholder), and a monospace formula input (with arithmetic example); panel button highlights when preprocessing is active.
- **Sandboxed formula evaluator** (`aggregationEngine.ts`) — `evaluateSafeFormula(formula, tokens)` performs named-token substitution (longest-first) then parses arithmetic with a hand-written recursive-descent parser (`ArithParser`); supports `+ − * / ( )` and unary minus; blocks all `eval`/`Function` code execution; returns `0` on any invalid input or injection attempt.
- **JS in-memory aggregation pipeline** (`aggregationEngine.ts`) — `buildAggregationQuery` returns a `QueryDescriptor` discriminated union (`mode: 'aggregated' | 'raw'`); when any preprocess config is enabled it emits a raw `LIMIT 10000` select; `applyLocalPreprocessing(rawRows, config, headers)` applies `new RegExp()` extraction, feeds named groups to `evaluateSafeFormula`, groups results with a `Map`, and reduces with in-memory `AVG`/`SUM`/`COUNT` — fully offline, no network calls.
- **Dashboard pipeline integration** (`AnalyticsDashboard.tsx`) — `runQuery` branches on `built.mode`; raw rows are routed through `applyLocalPreprocessing`; regex syntax errors surface as a user-visible `queryError` message without crashing the chart view.
