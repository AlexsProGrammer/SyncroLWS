# Changelog

## [0.2.0] — 2026-05-29

### Added — Tokenized Preprocessing Engine & Dynamic Expression Formula Parser

- **`PreprocessConfig` schema** (`AxisConfigurator.tsx`) — new exported interface with `enabled`, `regexPattern`, and `formulaExpression` fields; `AxisConfig` extended with optional `xPreprocess`, `y1Preprocess`, `y2Preprocess`; `DEFAULT_AXIS_CONFIG` populated with safe disabled defaults.
- **Axis Configurator UI** (`AxisConfigurator.tsx`) — collapsible `<PreprocessPanel />` revealed per-axis via a compact `f(x)` toggle button; panel includes an enable `Switch`, a monospace regex input (with named-group placeholder), and a monospace formula input (with arithmetic example); panel button highlights when preprocessing is active.
- **Sandboxed formula evaluator** (`aggregationEngine.ts`) — `evaluateSafeFormula(formula, tokens)` performs named-token substitution (longest-first) then parses arithmetic with a hand-written recursive-descent parser (`ArithParser`); supports `+ − * / ( )` and unary minus; blocks all `eval`/`Function` code execution; returns `0` on any invalid input or injection attempt.
- **JS in-memory aggregation pipeline** (`aggregationEngine.ts`) — `buildAggregationQuery` returns a `QueryDescriptor` discriminated union (`mode: 'aggregated' | 'raw'`); when any preprocess config is enabled it emits a raw `LIMIT 10000` select; `applyLocalPreprocessing(rawRows, config, headers)` applies `new RegExp()` extraction, feeds named groups to `evaluateSafeFormula`, groups results with a `Map`, and reduces with in-memory `AVG`/`SUM`/`COUNT` — fully offline, no network calls.
- **Dashboard pipeline integration** (`AnalyticsDashboard.tsx`) — `runQuery` branches on `built.mode`; raw rows are routed through `applyLocalPreprocessing`; regex syntax errors surface as a user-visible `queryError` message without crashing the chart view.
