import type { AggFn, AxisConfig, PreprocessConfig } from '../components/AxisConfigurator';

// ── Types ──────────────────────────────────────────────────────────────────────

/** Raw row returned by the aggregation SQL query. */
export interface AggRow {
  x_val: string;
  y1_val: number | null;
  y2_val: number | null;
}

/**
 * Un-aggregated row fetched when any preprocessing config is active.
 * Cell values arrive as raw strings so JavaScript can apply regex transforms.
 */
export interface RawRow {
  x_val:  string | null;
  y1_raw: string | null;
  y2_raw: string | null;
}

/**
 * Discriminated union returned by `buildAggregationQuery`.
 * Callers branch on `mode` to choose between the fast SQL-aggregate path
 * and the JS preprocessing pipeline.
 */
export type QueryDescriptor =
  | { mode: 'aggregated'; sql: string; params: [string] }
  | { mode: 'raw';        sql: string; params: [string] };

/**
 * Unified data point consumed by recharts `ComposedChart`.
 * `y2` is absent when no secondary axis column is configured.
 */
export interface ChartPoint {
  x: string;
  y1: number;
  y2?: number;
}

// ── SQL builder ────────────────────────────────────────────────────────────────

/**
 * Produces the SQLite aggregate expression for a single Y column.
 *
 * `json_extract(cells, '$[N]')` dereferences the Nth element of the JSON
 * array stored in the `cells` TEXT column. For AVG and SUM the extracted
 * string is cast to REAL; COUNT needs no cast because it counts non-NULL
 * occurrences rather than summing raw values.
 */
function aggExpr(fn: AggFn, colIndex: number): string {
  if (fn === 'COUNT') {
    return `CAST(COUNT(json_extract(cells, '$[${colIndex}]')) AS REAL)`;
  }
  return `CAST(${fn}(CAST(json_extract(cells, '$[${colIndex}]') AS REAL)) AS REAL)`;
}

/**
 * Builds a parameterised SQLite query that groups `analytics_raw_records` rows
 * by the selected X column and computes one or two Y aggregates.
 *
 * When any preprocessing config is enabled the query instead fetches raw
 * unaggregated text cells (up to 10 000 rows) so the JS pipeline can apply
 * regex extraction and formula evaluation before grouping.
 *
 * Column indices are non-negative integers bounded by the dataset header
 * count, so embedding them directly in the SQL template is safe — they are
 * never user-supplied strings.
 *
 * Results are capped at 500 groups (aggregated) or 10 000 rows (raw) to keep
 * chart rendering snappy.
 *
 * Returns `null` when X or Y1 have not been selected yet.
 */
export function buildAggregationQuery(
  datasetId: string,
  config: AxisConfig,
): QueryDescriptor | null {
  if (config.xCol === null || config.y1Col === null) return null;

  const needsPreprocess =
    config.xPreprocess?.enabled ||
    config.y1Preprocess?.enabled ||
    config.y2Preprocess?.enabled;

  if (needsPreprocess) {
    // Raw path: fetch unaggregated text cells for JS-side preprocessing.
    const xRaw  = `json_extract(cells, '$[${config.xCol}]')`;
    const y1Raw = `json_extract(cells, '$[${config.y1Col}]')`;
    const y2Raw = config.y2Col !== null
      ? `json_extract(cells, '$[${config.y2Col}]')`
      : 'NULL';

    const sql = [
      'SELECT',
      `  ${xRaw}  AS x_val,`,
      `  ${y1Raw} AS y1_raw,`,
      `  ${y2Raw} AS y2_raw`,
      'FROM analytics_raw_records',
      'WHERE dataset_id = ?',
      `  AND ${xRaw} IS NOT NULL`,
      `  AND ${xRaw} != ''`,
      'LIMIT 10000',
    ].join('\n');

    return { mode: 'raw', sql, params: [datasetId] };
  }

  // Aggregated path: let SQLite do the heavy lifting.
  const xExpr  = `json_extract(cells, '$[${config.xCol}]')`;
  const y1Expr = aggExpr(config.y1Agg, config.y1Col);
  const y2Expr = config.y2Col !== null ? aggExpr(config.y2Agg, config.y2Col) : 'NULL';

  const sql = [
    'SELECT',
    `  ${xExpr}  AS x_val,`,
    `  ${y1Expr} AS y1_val,`,
    `  ${y2Expr} AS y2_val`,
    'FROM analytics_raw_records',
    'WHERE dataset_id = ?',
    `  AND ${xExpr} IS NOT NULL`,
    `  AND ${xExpr} != ''`,
    `GROUP BY ${xExpr}`,
    `ORDER BY ${xExpr}`,
    'LIMIT 500',
  ].join('\n');

  return { mode: 'aggregated', sql, params: [datasetId] };
}

// ── Data mapping ───────────────────────────────────────────────────────────────

/**
 * Maps raw DB rows returned by `buildAggregationQuery` (aggregated mode) into
 * the unified data point format expected by recharts `ComposedChart`.
 */
export function mapToChartPoints(rows: AggRow[]): ChartPoint[] {
  return rows.map((r) => {
    const pt: ChartPoint = { x: r.x_val, y1: r.y1_val ?? 0 };
    if (r.y2_val !== null) pt.y2 = r.y2_val;
    return pt;
  });
}

// ── JS preprocessing pipeline ─────────────────────────────────────────────────

/**
 * Applies a PreprocessConfig's regex and formula to a raw string cell.
 * Returns the computed float, or `null` to signal that the row should be skipped.
 */
function transformCell(
  raw: string | null | undefined,
  preprocess: PreprocessConfig | undefined,
): number | null {
  const cell = raw ?? '';

  if (!preprocess?.enabled || !preprocess.regexPattern) {
    const n = parseFloat(cell);
    return isNaN(n) ? null : n;
  }

  let re: RegExp;
  try { re = new RegExp(preprocess.regexPattern); } catch { return null; }

  const match = re.exec(cell);
  if (!match?.groups) return null;

  const groups: Record<string, number> = {};
  for (const [k, v] of Object.entries(match.groups)) {
    const n = parseFloat(v ?? '');
    if (!isNaN(n)) groups[k] = n;
  }

  const result = evaluateSafeFormula(preprocess.formulaExpression, groups);
  return isFinite(result) ? result : null;
}

/**
 * In-memory aggregation helper — mirrors the SQL AVG / SUM / COUNT semantics.
 */
function aggregateValues(fn: AggFn, sum: number, count: number): number {
  if (count === 0) return 0;
  if (fn === 'SUM')   return sum;
  if (fn === 'COUNT') return count;
  return sum / count; // AVG
}

/**
 * Applies regex-based token extraction and formula evaluation to raw
 * un-aggregated rows, then performs in-memory grouping and aggregation to
 * produce chart points.
 *
 * Called instead of `mapToChartPoints` when any preprocessing config is active.
 *
 * @param rawRows  Un-aggregated rows from the DB (shape matches `RawRow`).
 * @param config   Active axis configuration including preprocess rules.
 * @param headers  Dataset column header labels (available for display; not
 *                 needed for index-based cell access).
 */
export function applyLocalPreprocessing(
  rawRows: RawRow[],
  config: AxisConfig,
  _headers: string[],
): ChartPoint[] {
  // ── Step 1: transform each raw row ────────────────────────────────────────

  interface ProcessedRow { x: string; y1: number; y2: number | null; }
  const processed: ProcessedRow[] = [];

  for (const r of rawRows) {
    // X: if xPreprocess is active, derive numeric key; otherwise use raw string.
    let xKey: string;
    if (config.xPreprocess?.enabled) {
      const n = transformCell(r.x_val, config.xPreprocess);
      if (n === null) continue;
      xKey = String(n);
    } else {
      xKey = r.x_val ?? '';
      if (xKey === '') continue;
    }

    // Y1 is required.
    const y1 = transformCell(r.y1_raw, config.y1Preprocess);
    if (y1 === null) continue;

    // Y2 is optional.
    const y2 = config.y2Col !== null
      ? transformCell(r.y2_raw, config.y2Preprocess)
      : null;

    processed.push({ x: xKey, y1, y2 });
  }

  // ── Step 2: group by X and accumulate sums / counts ───────────────────────

  interface Acc { y1Sum: number; y1Count: number; y2Sum: number; y2Count: number; hasY2: boolean; }
  const groups = new Map<string, Acc>();

  for (const row of processed) {
    const acc: Acc = groups.get(row.x) ?? { y1Sum: 0, y1Count: 0, y2Sum: 0, y2Count: 0, hasY2: false };
    acc.y1Sum   += row.y1;
    acc.y1Count += 1;
    if (row.y2 !== null) { acc.y2Sum += row.y2; acc.y2Count += 1; acc.hasY2 = true; }
    groups.set(row.x, acc);
  }

  // ── Step 3: reduce to ChartPoints, sort by X ──────────────────────────────

  const points: ChartPoint[] = [];

  for (const [x, acc] of groups) {
    const pt: ChartPoint = {
      x,
      y1: aggregateValues(config.y1Agg, acc.y1Sum, acc.y1Count),
    };
    if (acc.hasY2) {
      pt.y2 = aggregateValues(config.y2Agg, acc.y2Sum, acc.y2Count);
    }
    points.push(pt);
  }

  points.sort((a, b) => a.x.localeCompare(b.x));

  return points;
}

// ── Safe formula evaluator ─────────────────────────────────────────────────────

type ArithToken =
  | { kind: 'num'; val: number }
  | { kind: 'op'; ch: '+' | '-' | '*' | '/' | '(' | ')' }
  | { kind: 'eof' };

/**
 * Converts an arithmetic string into a flat token array.
 * Returns `null` when any character is not a digit, dot, operator, paren, or
 * whitespace — this signals an invalid / injected expression to the caller.
 */
function tokenizeArith(expr: string): ArithToken[] | null {
  const out: ArithToken[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr.charAt(i); // charAt always returns a string, never undefined
    if (ch === ' ' || ch === '\t') { i++; continue; }
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let raw = '';
      while (i < expr.length) {
        const c = expr.charAt(i);
        if ((c >= '0' && c <= '9') || c === '.') { raw += c; i++; } else break;
      }
      const v = Number(raw);
      if (!isFinite(v)) return null;
      out.push({ kind: 'num', val: v });
    } else if (
      ch === '+' || ch === '-' || ch === '*' || ch === '/' ||
      ch === '(' || ch === ')'
    ) {
      out.push({ kind: 'op', ch });
      i++;
    } else {
      return null; // unrecognised character — reject the expression
    }
  }
  out.push({ kind: 'eof' });
  return out;
}

/**
 * Recursive-descent parser for basic arithmetic: `+  −  *  /  ( )  unary −`
 *
 * Operator precedence (standard):
 *   lowest  → addition / subtraction      (expr)
 *   higher  → multiplication / division   (term)
 *   highest → unary sign, parens, literal (factor)
 *
 * Never calls `eval`, `Function`, or any dynamic code execution path.
 * Division by zero safely yields 0 instead of throwing.
 * Throws `Error` on malformed input so the caller can return 0.
 */
class ArithParser {
  private pos = 0;
  constructor(private readonly toks: ArithToken[]) {}

  /** Returns the token at the current position, throwing on out-of-bounds. */
  private current(): ArithToken {
    const t = this.toks[this.pos];
    if (t === undefined) throw new Error('Unexpected end of token stream');
    return t;
  }

  parse(): number {
    const v = this.expr();
    if (this.current().kind !== 'eof') throw new Error('Unexpected token after expression');
    return v;
  }

  // addition / subtraction — left-associative, lowest precedence
  private expr(): number {
    let v = this.term();
    for (;;) {
      const t = this.current();
      if (t.kind === 'op' && (t.ch === '+' || t.ch === '-')) {
        this.pos++;
        const r = this.term();
        v = t.ch === '+' ? v + r : v - r;
      } else break;
    }
    return v;
  }

  // multiplication / division — left-associative, higher precedence
  private term(): number {
    let v = this.factor();
    for (;;) {
      const t = this.current();
      if (t.kind === 'op' && (t.ch === '*' || t.ch === '/')) {
        this.pos++;
        const r = this.factor();
        v = t.ch === '*' ? v * r : r === 0 ? 0 : v / r;
      } else break;
    }
    return v;
  }

  // unary sign, parenthesised sub-expression, numeric literal
  private factor(): number {
    const t = this.current();
    if (t.kind === 'op' && t.ch === '-') { this.pos++; return -this.factor(); }
    if (t.kind === 'op' && t.ch === '+') { this.pos++; return  this.factor(); }
    if (t.kind === 'op' && t.ch === '(') {
      this.pos++;
      const v = this.expr();
      const close = this.current();
      this.pos++;
      if (close.kind !== 'op' || close.ch !== ')') throw new Error('Expected closing )');
      return v;
    }
    if (t.kind === 'num') { this.pos++; return t.val; }
    throw new Error('Unexpected token in factor');
  }
}

/**
 * Evaluates a simple arithmetic formula string with named token substitution.
 *
 * Steps:
 *  1. Token names are substituted with their concrete float values (longest
 *     name first to prevent partial clobbering, e.g. "minutes" before "min").
 *  2. After substitution the expression must consist solely of digits, dots,
 *     arithmetic operators, parentheses, and whitespace — any remaining letter
 *     or foreign character returns 0 immediately (injection guard).
 *  3. The numeric expression is parsed by `ArithParser`, a hand-written
 *     recursive-descent parser. No `eval` or `Function` constructor is used.
 *  4. Non-finite results (Infinity, NaN) are clamped to 0.
 *
 * Returns `0` on any parse error, invalid character, or division by zero.
 *
 * @example
 *   evaluateSafeFormula("h + (m / 60)", { h: 1, m: 30 }) // → 1.5
 */
export function evaluateSafeFormula(
  formula: string,
  tokens: Record<string, number>,
): number {
  if (!formula.trim()) return 0;

  // Substitute named tokens longest-first to avoid partial replacements.
  let expr = formula;
  const keys = Object.keys(tokens).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expr = expr.replace(new RegExp(`\\b${escaped}\\b`, 'g'), String(tokens[key]));
  }

  // Injection guard: after substitution only arithmetic primitives may remain.
  if (/[^0-9.\s+\-*/()]/.test(expr)) return 0;

  const toks = tokenizeArith(expr);
  if (!toks || toks.length <= 1) return 0; // empty or tokenizer rejected input

  try {
    const result = new ArithParser(toks).parse();
    return isFinite(result) ? result : 0;
  } catch {
    return 0;
  }
}
