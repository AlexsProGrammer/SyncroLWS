/**
 * metricsCalculator — Native SQLite statistical aggregation engine for the
 * Time Intelligence module.
 *
 * Computes multi-scale sliding/tumbling window metrics entirely within the
 * local workspace SQLite database using native window functions. No data leaves
 * the device (DSGVO compliant).
 *
 * All queries target the hybrid entity schema:
 *   base_entities  (id, title, tags, …)
 *   entity_aspects (entity_id, aspect_type, data JSON, …)
 *
 * Time-log aspect data shape (JSON):
 *   { start, end, duration_seconds, billable, hourly_rate_cents, project, window_title, manual }
 */

import { getWorkspaceDB } from '@/core/db';

// ── Shared query fragments ────────────────────────────────────────────────────

/** JOIN and WHERE clauses shared by every time-log query. */
const TL_JOIN = `
  FROM base_entities be
  JOIN entity_aspects ea ON ea.entity_id = be.id
  WHERE ea.aspect_type = 'time_log'
    AND be.deleted_at IS NULL
    AND ea.deleted_at IS NULL
    AND json_extract(ea.data, '$.duration_seconds') IS NOT NULL
`;

// ── Output types ──────────────────────────────────────────────────────────────

/** Per-day total with a 30-day sliding-window average. */
export interface DailyProfile {
  day: string;                      // 'YYYY-MM-DD'
  total_seconds: number;
  billable_seconds: number;
  entry_count: number;
  rolling_30d_avg_seconds: number;  // avg(total_seconds) OVER 30 preceding days
}

/** Per-week total with a 4-week rolling average (velocity tracking). */
export interface WeeklyVelocity {
  week: string;                     // 'YYYY-WNN'
  total_seconds: number;
  billable_seconds: number;
  entry_count: number;
  rolling_4w_avg_seconds: number;   // avg(total_seconds) OVER 4 preceding weeks
}

/** Per-month aggregate with intra-month daily min/max (tumbling window bounds). */
export interface MonthlyBound {
  month: string;                    // 'YYYY-MM'
  total_seconds: number;
  billable_seconds: number;
  entry_count: number;
  min_day_seconds: number;          // lightest single day in the month
  max_day_seconds: number;          // heaviest single day in the month
}

/** Per-year totals with average daily time (yearly variance view). */
export interface YearlyVariance {
  year: string;                     // 'YYYY'
  total_seconds: number;
  billable_seconds: number;
  entry_count: number;
  avg_daily_seconds: number;
}

/** Per-project totals, billable ratios, and earned income estimates. */
export interface ProjectTotal {
  project: string;
  entry_count: number;
  total_seconds: number;
  billable_seconds: number;
  billable_ratio: number;           // 0.0 – 1.0
  earned_cents: number;             // Σ(duration_h × hourly_rate_cents)
}

/** Life-bucket distribution (bucket:work | bucket:life | bucket:school_uni). */
export interface BucketSummary {
  bucket: string;                   // e.g. 'bucket:work'
  entry_count: number;
  total_seconds: number;
}

/** #tag frequency and cumulative duration across matched entries. */
export interface TagConcentration {
  tag: string;
  count: number;
  total_seconds: number;
}

/** Aggregated result returned by `getTimeWindowStats()`. */
export interface TimeWindowStats {
  dailyProfiles: DailyProfile[];
  weeklyVelocities: WeeklyVelocity[];
  monthlyBounds: MonthlyBound[];
  yearlyVariances: YearlyVariance[];
  projectTotals: ProjectTotal[];
  bucketSummary: BucketSummary[];
  tagConcentration: TagConcentration[];
  computedMs: number;
}

// ── Raw row types (SQLite returns everything as string | number | null) ────────

interface RawDailyRow {
  day: string;
  total_seconds: number | string | null;
  billable_seconds: number | string | null;
  entry_count: number | string | null;
  rolling_30d_avg_seconds: number | string | null;
}

interface RawWeeklyRow {
  week: string;
  total_seconds: number | string | null;
  billable_seconds: number | string | null;
  entry_count: number | string | null;
  rolling_4w_avg_seconds: number | string | null;
}

interface RawMonthlyRow {
  month: string;
  total_seconds: number | string | null;
  billable_seconds: number | string | null;
  entry_count: number | string | null;
  min_day_seconds: number | string | null;
  max_day_seconds: number | string | null;
}

interface RawYearlyRow {
  year: string;
  total_seconds: number | string | null;
  billable_seconds: number | string | null;
  entry_count: number | string | null;
  avg_daily_seconds: number | string | null;
}

interface RawProjectRow {
  project: string;
  entry_count: number | string | null;
  total_seconds: number | string | null;
  billable_seconds: number | string | null;
  billable_ratio: number | string | null;
  earned_cents: number | string | null;
}

interface RawTagRow {
  tag: string;
  count: number | string | null;
  total_seconds: number | string | null;
}

const n = (v: number | string | null | undefined): number =>
  v == null ? 0 : typeof v === 'number' ? v : parseFloat(v) || 0;

// ── Step 2.2 — Daily profiles with 30-day sliding window average ──────────────

/**
 * Fetches per-day time totals for the last `days` days, plus a 30-day
 * sliding-window average using a native SQLite window function.
 */
export async function getDailyProfiles(days = 90): Promise<DailyProfile[]> {
  const db = getWorkspaceDB();
  const fromDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const sql = `
    WITH daily AS (
      SELECT
        DATE(json_extract(ea.data, '$.start'))                                        AS day,
        SUM(CAST(json_extract(ea.data, '$.duration_seconds') AS INTEGER))             AS total_seconds,
        SUM(CASE WHEN json_extract(ea.data, '$.billable') = 1
              THEN CAST(json_extract(ea.data, '$.duration_seconds') AS INTEGER)
              ELSE 0 END)                                                              AS billable_seconds,
        COUNT(*)                                                                       AS entry_count
      ${TL_JOIN}
        AND json_extract(ea.data, '$.start') >= ?
      GROUP BY day
    )
    SELECT
      day,
      total_seconds,
      billable_seconds,
      entry_count,
      CAST(AVG(total_seconds) OVER (
        ORDER BY day
        ROWS BETWEEN 29 PRECEDING AND CURRENT ROW
      ) AS REAL) AS rolling_30d_avg_seconds
    FROM daily
    ORDER BY day DESC
    LIMIT ?
  `;

  const rows = await db.select<RawDailyRow[]>(sql, [fromDate, days]);
  return rows.map((r) => ({
    day: r.day,
    total_seconds: n(r.total_seconds),
    billable_seconds: n(r.billable_seconds),
    entry_count: n(r.entry_count),
    rolling_30d_avg_seconds: n(r.rolling_30d_avg_seconds),
  }));
}

// ── Step 2.2 — Weekly velocity with 4-week rolling average ───────────────────

/**
 * Fetches per-week totals for the last `weeks` ISO weeks, plus a 4-week
 * rolling average (tumbling velocity tracking).
 */
export async function getWeeklyVelocities(weeks = 52): Promise<WeeklyVelocity[]> {
  const db = getWorkspaceDB();
  const fromDate = new Date(Date.now() - weeks * 7 * 86_400_000).toISOString().slice(0, 10);

  const sql = `
    WITH weekly AS (
      SELECT
        STRFTIME('%Y-W%W', json_extract(ea.data, '$.start'))                          AS week,
        SUM(CAST(json_extract(ea.data, '$.duration_seconds') AS INTEGER))             AS total_seconds,
        SUM(CASE WHEN json_extract(ea.data, '$.billable') = 1
              THEN CAST(json_extract(ea.data, '$.duration_seconds') AS INTEGER)
              ELSE 0 END)                                                              AS billable_seconds,
        COUNT(*)                                                                       AS entry_count
      ${TL_JOIN}
        AND json_extract(ea.data, '$.start') >= ?
      GROUP BY week
    )
    SELECT
      week,
      total_seconds,
      billable_seconds,
      entry_count,
      CAST(AVG(total_seconds) OVER (
        ORDER BY week
        ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
      ) AS REAL) AS rolling_4w_avg_seconds
    FROM weekly
    ORDER BY week DESC
    LIMIT ?
  `;

  const rows = await db.select<RawWeeklyRow[]>(sql, [fromDate, weeks]);
  return rows.map((r) => ({
    week: r.week,
    total_seconds: n(r.total_seconds),
    billable_seconds: n(r.billable_seconds),
    entry_count: n(r.entry_count),
    rolling_4w_avg_seconds: n(r.rolling_4w_avg_seconds),
  }));
}

// ── Step 2.2 — Monthly bounds (intra-month min/max daily totals) ─────────────

/**
 * Fetches per-month aggregates for the last `months` months including the
 * lightest and heaviest single tracked day within each month (tumbling bounds).
 */
export async function getMonthlyBounds(months = 24): Promise<MonthlyBound[]> {
  const db = getWorkspaceDB();
  const fromDate = new Date(Date.now() - months * 30 * 86_400_000).toISOString().slice(0, 10);

  const sql = `
    WITH by_day AS (
      SELECT
        DATE(json_extract(ea.data, '$.start'))                                        AS day,
        STRFTIME('%Y-%m', json_extract(ea.data, '$.start'))                           AS month,
        SUM(CAST(json_extract(ea.data, '$.duration_seconds') AS INTEGER))             AS day_seconds,
        SUM(CASE WHEN json_extract(ea.data, '$.billable') = 1
              THEN CAST(json_extract(ea.data, '$.duration_seconds') AS INTEGER)
              ELSE 0 END)                                                              AS day_billable,
        COUNT(*)                                                                       AS day_count
      ${TL_JOIN}
        AND json_extract(ea.data, '$.start') >= ?
      GROUP BY day
    )
    SELECT
      month,
      SUM(day_seconds)    AS total_seconds,
      SUM(day_billable)   AS billable_seconds,
      SUM(day_count)      AS entry_count,
      MIN(day_seconds)    AS min_day_seconds,
      MAX(day_seconds)    AS max_day_seconds
    FROM by_day
    GROUP BY month
    ORDER BY month DESC
    LIMIT ?
  `;

  const rows = await db.select<RawMonthlyRow[]>(sql, [fromDate, months]);
  return rows.map((r) => ({
    month: r.month,
    total_seconds: n(r.total_seconds),
    billable_seconds: n(r.billable_seconds),
    entry_count: n(r.entry_count),
    min_day_seconds: n(r.min_day_seconds),
    max_day_seconds: n(r.max_day_seconds),
  }));
}

// ── Step 2.2 — Yearly variance view ──────────────────────────────────────────

/** Fetches per-year totals and average daily time for all logged years. */
export async function getYearlyVariances(): Promise<YearlyVariance[]> {
  const db = getWorkspaceDB();

  const sql = `
    WITH by_day AS (
      SELECT
        DATE(json_extract(ea.data, '$.start'))                                        AS day,
        STRFTIME('%Y', json_extract(ea.data, '$.start'))                              AS year,
        SUM(CAST(json_extract(ea.data, '$.duration_seconds') AS INTEGER))             AS day_seconds,
        SUM(CASE WHEN json_extract(ea.data, '$.billable') = 1
              THEN CAST(json_extract(ea.data, '$.duration_seconds') AS INTEGER)
              ELSE 0 END)                                                              AS day_billable,
        COUNT(*)                                                                       AS day_count
      ${TL_JOIN}
      GROUP BY day
    )
    SELECT
      year,
      SUM(day_seconds)          AS total_seconds,
      SUM(day_billable)         AS billable_seconds,
      SUM(day_count)            AS entry_count,
      CAST(AVG(day_seconds) AS REAL) AS avg_daily_seconds
    FROM by_day
    GROUP BY year
    ORDER BY year DESC
    LIMIT 10
  `;

  const rows = await db.select<RawYearlyRow[]>(sql, []);
  return rows.map((r) => ({
    year: r.year,
    total_seconds: n(r.total_seconds),
    billable_seconds: n(r.billable_seconds),
    entry_count: n(r.entry_count),
    avg_daily_seconds: n(r.avg_daily_seconds),
  }));
}

// ── Step 2.3 — Project-level totals, billable ratios, earned income ───────────

/**
 * Computes per-project time totals, billable ratios, and estimated income
 * within the specified date range. Uses `json_extract` on the aspect data JSON
 * to derive per-project breakdowns without a separate schema migration.
 */
export async function getProjectTotals(fromISO: string, toISO?: string): Promise<ProjectTotal[]> {
  const db = getWorkspaceDB();
  const to = toISO ?? new Date().toISOString();

  const sql = `
    SELECT
      COALESCE(NULLIF(TRIM(json_extract(ea.data, '$.project')), ''), '(no project)') AS project,
      COUNT(*)                                                                         AS entry_count,
      SUM(CAST(json_extract(ea.data, '$.duration_seconds') AS INTEGER))               AS total_seconds,
      SUM(CASE WHEN json_extract(ea.data, '$.billable') = 1
            THEN CAST(json_extract(ea.data, '$.duration_seconds') AS INTEGER)
            ELSE 0 END)                                                                AS billable_seconds,
      CAST(
        SUM(CASE WHEN json_extract(ea.data, '$.billable') = 1
              THEN CAST(json_extract(ea.data, '$.duration_seconds') AS INTEGER)
              ELSE 0 END)
        AS REAL
      ) / NULLIF(SUM(CAST(json_extract(ea.data, '$.duration_seconds') AS INTEGER)), 0) AS billable_ratio,
      CAST(
        SUM(
          CASE WHEN json_extract(ea.data, '$.billable') = 1
          THEN CAST(json_extract(ea.data, '$.duration_seconds') AS INTEGER)
             * CAST(COALESCE(json_extract(ea.data, '$.hourly_rate_cents'), 0) AS INTEGER)
             / 3600
          ELSE 0 END
        ) AS INTEGER
      )                                                                                AS earned_cents
    ${TL_JOIN}
      AND json_extract(ea.data, '$.start') >= ?
      AND json_extract(ea.data, '$.start') <= ?
    GROUP BY project
    ORDER BY total_seconds DESC
    LIMIT 100
  `;

  const rows = await db.select<RawProjectRow[]>(sql, [fromISO, to]);
  return rows.map((r) => ({
    project: r.project,
    entry_count: n(r.entry_count),
    total_seconds: n(r.total_seconds),
    billable_seconds: n(r.billable_seconds),
    billable_ratio: n(r.billable_ratio),
    earned_cents: n(r.earned_cents),
  }));
}

// ── Step 2.3 — Life-bucket distribution ──────────────────────────────────────

/**
 * Aggregates time by life-bucket using the `bucket:*` tags written by
 * `parseTimeLogDescription`. Expands the JSON tags array via `json_each`.
 */
export async function getBucketSummary(fromISO: string, toISO?: string): Promise<BucketSummary[]> {
  const db = getWorkspaceDB();
  const to = toISO ?? new Date().toISOString();

  const sql = `
    SELECT
      t.value                                                                          AS bucket,
      COUNT(*)                                                                         AS entry_count,
      SUM(CAST(json_extract(ea.data, '$.duration_seconds') AS INTEGER))               AS total_seconds
    FROM base_entities be
    JOIN entity_aspects ea ON ea.entity_id = be.id
    JOIN json_each(be.tags) t
    WHERE ea.aspect_type = 'time_log'
      AND be.deleted_at IS NULL
      AND ea.deleted_at IS NULL
      AND json_extract(ea.data, '$.duration_seconds') IS NOT NULL
      AND json_extract(ea.data, '$.start') >= ?
      AND json_extract(ea.data, '$.start') <= ?
      AND t.value LIKE 'bucket:%'
    GROUP BY t.value
    ORDER BY total_seconds DESC
  `;

  const rows = await db.select<RawTagRow[]>(sql, [fromISO, to]);
  return rows.map((r) => ({
    bucket: r.tag,
    entry_count: n(r.count),
    total_seconds: n(r.total_seconds),
  }));
}

// ── Step 2.3 — Tag concentration ─────────────────────────────────────────────

/**
 * Computes tag frequency and cumulative tracked time for non-bucket tags.
 * Uses `json_each` to expand the `base_entities.tags` JSON array and
 * filters out `bucket:*` labels so only user-defined hashtags are returned.
 */
export async function getTagConcentration(fromISO: string, toISO?: string): Promise<TagConcentration[]> {
  const db = getWorkspaceDB();
  const to = toISO ?? new Date().toISOString();

  const sql = `
    SELECT
      t.value                                                                          AS tag,
      COUNT(*)                                                                         AS count,
      SUM(CAST(json_extract(ea.data, '$.duration_seconds') AS INTEGER))               AS total_seconds
    FROM base_entities be
    JOIN entity_aspects ea ON ea.entity_id = be.id
    JOIN json_each(be.tags) t
    WHERE ea.aspect_type = 'time_log'
      AND be.deleted_at IS NULL
      AND ea.deleted_at IS NULL
      AND json_extract(ea.data, '$.duration_seconds') IS NOT NULL
      AND json_extract(ea.data, '$.start') >= ?
      AND json_extract(ea.data, '$.start') <= ?
      AND t.value NOT LIKE 'bucket:%'
    GROUP BY t.value
    ORDER BY total_seconds DESC
    LIMIT 30
  `;

  const rows = await db.select<RawTagRow[]>(sql, [fromISO, to]);
  return rows.map((r) => ({
    tag: r.tag,
    count: n(r.count),
    total_seconds: n(r.total_seconds),
  }));
}

// ── Main composite query ──────────────────────────────────────────────────────

/**
 * Runs all multi-scale metric computations in parallel and returns a unified
 * `TimeWindowStats` object. All queries execute locally against the workspace
 * SQLite database — no network calls (DSGVO compliant).
 *
 * @param fromISO  ISO timestamp lower bound (default: 90 days ago)
 * @param toISO    ISO timestamp upper bound (default: now)
 */
export async function getTimeWindowStats(fromISO?: string, toISO?: string): Promise<TimeWindowStats> {
  const from = fromISO ?? new Date(Date.now() - 90 * 86_400_000).toISOString();
  const to = toISO ?? new Date().toISOString();

  const t0 = performance.now();

  const [
    dailyProfiles,
    weeklyVelocities,
    monthlyBounds,
    yearlyVariances,
    projectTotals,
    bucketSummary,
    tagConcentration,
  ] = await Promise.all([
    getDailyProfiles(90),
    getWeeklyVelocities(52),
    getMonthlyBounds(24),
    getYearlyVariances(),
    getProjectTotals(from, to),
    getBucketSummary(from, to),
    getTagConcentration(from, to),
  ]);

  const computedMs = performance.now() - t0;
  console.log(`[time-intelligence] metrics computed in ${computedMs.toFixed(1)}ms`);

  return {
    dailyProfiles,
    weeklyVelocities,
    monthlyBounds,
    yearlyVariances,
    projectTotals,
    bucketSummary,
    tagConcentration,
    computedMs,
  };
}

// ── Verification helper ───────────────────────────────────────────────────────

/**
 * Self-test: runs `getTimeWindowStats()` and logs the structural output to the
 * console. Confirms queries execute in under 50 ms without blocking the UI
 * (all I/O is async).
 *
 * Call from the browser console inside the Tauri runtime:
 *   import('@/modules/time-intelligence/utils/metricsCalculator').then(m => m.runSelfTest())
 */
export async function runSelfTest(): Promise<void> {
  console.log('[time-intelligence] running self-test…');
  const start = performance.now();
  try {
    const stats = await getTimeWindowStats();
    const elapsed = performance.now() - start;
    console.log('[time-intelligence] self-test PASSED', {
      dailyProfileRows: stats.dailyProfiles.length,
      weeklyVelocityRows: stats.weeklyVelocities.length,
      monthlyBoundRows: stats.monthlyBounds.length,
      yearlyVarianceRows: stats.yearlyVariances.length,
      projectRows: stats.projectTotals.length,
      bucketRows: stats.bucketSummary.length,
      tagRows: stats.tagConcentration.length,
      computedMs: stats.computedMs.toFixed(1),
      totalElapsedMs: elapsed.toFixed(1),
    });
    if (elapsed > 50) {
      console.warn(`[time-intelligence] ⚠ self-test exceeded 50 ms target (${elapsed.toFixed(1)} ms)`);
    }
  } catch (err) {
    console.error('[time-intelligence] self-test FAILED', err);
  }
}

// ── Step 4.3 — Client milestone aggregator ────────────────────────────────────

/** Accumulated billable income per client used by the milestone daemon. */
export interface ClientMilestone {
  /** Client/project name extracted from [ProjectName] bracket notation. */
  project: string;
  /** Total earned cents: Σ(duration_h × hourly_rate_cents) for billable entries. */
  earned_cents: number;
  /** Number of billable entries contributing to this total. */
  entry_count: number;
}

/**
 * Computes per-client accumulated billable income over the last `days` days.
 * Only entries where `billable = 1` AND `hourly_rate_cents > 0` are included.
 * Called periodically by the threshold daemon in IntelligenceDashboard.
 */
export async function getClientMilestones(days = 365): Promise<ClientMilestone[]> {
  const db = getWorkspaceDB();
  const fromDate = new Date(Date.now() - days * 86_400_000).toISOString();

  const sql = `
    SELECT
      COALESCE(NULLIF(TRIM(json_extract(ea.data, '$.project')), ''), '(no project)') AS project,
      COUNT(*)                                                                         AS entry_count,
      CAST(
        SUM(
          CAST(json_extract(ea.data, '$.duration_seconds') AS REAL) *
          CAST(COALESCE(json_extract(ea.data, '$.hourly_rate_cents'), 0) AS REAL) / 3600.0
        ) AS INTEGER
      )                                                                                AS earned_cents
    FROM base_entities be
    JOIN entity_aspects ea ON ea.entity_id = be.id
    WHERE ea.aspect_type = 'time_log'
      AND be.deleted_at IS NULL
      AND ea.deleted_at IS NULL
      AND json_extract(ea.data, '$.billable') = 1
      AND CAST(COALESCE(json_extract(ea.data, '$.hourly_rate_cents'), 0) AS REAL) > 0
      AND json_extract(ea.data, '$.duration_seconds') IS NOT NULL
      AND json_extract(ea.data, '$.start') >= ?
    GROUP BY LOWER(json_extract(ea.data, '$.project'))
    HAVING earned_cents > 0
    ORDER BY earned_cents DESC
  `;

  const rows = await db.select<{
    project: string;
    entry_count: number | string | null;
    earned_cents: number | string | null;
  }[]>(sql, [fromDate]);

  return rows.map((r) => ({
    project: r.project,
    earned_cents: n(r.earned_cents),
    entry_count: n(r.entry_count),
  }));
}
