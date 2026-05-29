import type { AggFn, AxisConfig } from '../components/AxisConfigurator';

// ── Types ──────────────────────────────────────────────────────────────────────

/** Raw row returned by the aggregation SQL query. */
export interface AggRow {
  x_val: string;
  y1_val: number | null;
  y2_val: number | null;
}

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
 * Column indices are non-negative integers bounded by the dataset header
 * count, so embedding them directly in the SQL template is safe — they are
 * never user-supplied strings.
 *
 * Results are capped at 500 groups to keep chart rendering snappy.
 *
 * Returns `null` when X or Y1 have not been selected yet.
 */
export function buildAggregationQuery(
  datasetId: string,
  config: AxisConfig,
): { sql: string; params: [string] } | null {
  if (config.xCol === null || config.y1Col === null) return null;

  const xExpr = `json_extract(cells, '$[${config.xCol}]')`;
  const y1Expr = aggExpr(config.y1Agg, config.y1Col);
  const y2Expr =
    config.y2Col !== null ? aggExpr(config.y2Agg, config.y2Col) : 'NULL';

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

  return { sql, params: [datasetId] };
}

// ── Data mapping ───────────────────────────────────────────────────────────────

/**
 * Maps raw DB rows returned by `buildAggregationQuery` into the unified
 * data point format expected by recharts `ComposedChart`.
 */
export function mapToChartPoints(rows: AggRow[]): ChartPoint[] {
  return rows.map((r) => {
    const pt: ChartPoint = { x: r.x_val, y1: r.y1_val ?? 0 };
    if (r.y2_val !== null) pt.y2 = r.y2_val;
    return pt;
  });
}
