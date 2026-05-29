import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { getWorkspaceDB } from '@/core/db';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { CSVImportZone } from './components/CSVImportZone';
import { AxisConfigurator, DEFAULT_AXIS_CONFIG } from './components/AxisConfigurator';
import type { AxisConfig, YSeriesItem } from './components/AxisConfigurator';
import { buildAggregationQuery, mapToChartPoints, applyLocalPreprocessing } from './utils/aggregationEngine';
import type { AggRow, RawRow, ChartPoint } from './utils/aggregationEngine';
import type { ToolViewProps } from '@/registry/ToolRegistry';
import { eventBus } from '@/core/events';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DatasetRow {
  id: string;
  name: string;
  row_count: number;
  headers: string; // JSON-encoded string[]
  created_at: string;
}

function parseHeaders(raw: string): string[] {
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

/**
 * Ensures configs persisted before the categorical-encoder feature was added
 * always carry the required `mode` and `mappingRules` fields on every series
 * item. Uses runtime-nullable casts so TypeScript does not complain about
 * properties that are guaranteed by the type but may be absent in old JSON.
 */
function normalizeAxisConfig(config: AxisConfig): AxisConfig {
  return {
    ...config,
    ySeries: config.ySeries.map((s): YSeriesItem => {
      const raw = s as Record<string, unknown>;
      return {
        ...s,
        mode: (raw['mode'] as YSeriesItem['mode'] | undefined) ?? 'numeric',
        mappingRules: (raw['mappingRules'] as YSeriesItem['mappingRules'] | undefined) ?? {},
      };
    }),
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AnalyticsDashboardView({ toolInstanceId }: ToolViewProps): React.ReactElement {
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [axisConfig, setAxisConfig] = useState<AxisConfig>(DEFAULT_AXIS_CONFIG);
  const [chartPoints, setChartPoints] = useState<ChartPoint[]>([]);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [isQuerying, setIsQuerying] = useState(false);

  // null = currently loading (block saves); string = JSON of last persisted config
  const lastSavedConfigRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  const loadDatasets = useCallback(async () => {
    try {
      const db = getWorkspaceDB();
      const rows = await db.select<DatasetRow[]>(
        `SELECT id, name, row_count, headers, created_at
           FROM analytics_datasets
          ORDER BY created_at DESC`,
        [],
      );
      setDatasets(rows);
      setLoadError(null);
    } catch (err) {
      console.error('[module:analytics] Failed to load datasets:', err);
      setLoadError('Could not load datasets from workspace database.');
    }
  }, []);

  // Reload whenever the active workspace changes
  useEffect(() => {
    void loadDatasets();
  }, [loadDatasets, activeWorkspaceId]);

  // Re-run the aggregation query when the selected dataset or axis config changes
  const runQuery = useCallback(async () => {
    if (!selectedId) {
      setChartPoints([]);
      return;
    }
    const built = buildAggregationQuery(selectedId, axisConfig);
    if (!built) {
      setChartPoints([]);
      return;
    }
    setIsQuerying(true);
    setQueryError(null);
    try {
      const db = getWorkspaceDB();

      if (built.mode === 'raw') {
        // Preprocessing path: fetch raw text cells and run the JS pipeline.
        const rawRows = await db.select<RawRow[]>(built.sql, [...built.params]);
        const ds = datasets.find((d) => d.id === selectedId);
        const headers = ds ? parseHeaders(ds.headers) : [];
        try {
          setChartPoints(applyLocalPreprocessing(rawRows, axisConfig, headers));
        } catch (preprocessErr) {
          console.error('[module:analytics] Preprocessing failed:', preprocessErr);
          setQueryError(
            'Preprocessing failed — check your regex pattern for syntax errors.',
          );
        }
      } else {
        // Standard aggregated path: let SQLite handle grouping.
        const rows = await db.select<AggRow[]>(built.sql, [...built.params]);
        setChartPoints(mapToChartPoints(rows, axisConfig));
      }
    } catch (err) {
      console.error('[module:analytics] Aggregation query failed:', err);
      setQueryError(
        'Query failed — check your column selection and mapping configuration.',
      );
    } finally {
      setIsQuerying(false);
    }
  }, [selectedId, axisConfig, datasets]);

  // Load the persisted axis config from SQLite whenever the selected dataset changes.
  const loadConfig = useCallback(async (datasetId: string) => {
    try {
      const db = getWorkspaceDB();
      // Prefer the entity_aspect row — it may have been synced from another device.
      if (toolInstanceId) {
        const aspects = await db.select<{ data: string }[]>(
          `SELECT data FROM entity_aspects
            WHERE entity_id = ? AND aspect_type = 'analytics_config'
              AND IFNULL(tool_instance_id, '') = ?
              AND deleted_at IS NULL
            LIMIT 1`,
          [datasetId, toolInstanceId],
        );
        if (aspects.length > 0 && aspects[0]) {
          const config = normalizeAxisConfig(JSON.parse(aspects[0].data) as AxisConfig);
          lastSavedConfigRef.current = JSON.stringify(config);
          setAxisConfig(config);
          return;
        }
      }
      // Fall back to the inline axis_config column.
      const rows = await db.select<{ axis_config: string | null }[]>(
        `SELECT axis_config FROM analytics_datasets WHERE id = ? LIMIT 1`,
        [datasetId],
      );
      const raw = rows[0]?.axis_config ?? null;
      const config = raw ? normalizeAxisConfig(JSON.parse(raw) as AxisConfig) : DEFAULT_AXIS_CONFIG;
      lastSavedConfigRef.current = JSON.stringify(config);
      setAxisConfig(config);
    } catch (err) {
      console.error('[module:analytics] Failed to load axis config:', err);
      lastSavedConfigRef.current = JSON.stringify(DEFAULT_AXIS_CONFIG);
      setAxisConfig(DEFAULT_AXIS_CONFIG);
    }
  }, [toolInstanceId]);

  // Persist axis config to SQLite (and queue a server sync) on every change.
  const saveConfig = useCallback(async (datasetId: string, config: AxisConfig) => {
    try {
      const db = getWorkspaceDB();
      const now = new Date().toISOString();
      const configJson = JSON.stringify(config);

      // 1. Fast local cache — analytics_datasets.axis_config
      await db.execute(
        `UPDATE analytics_datasets SET axis_config = ? WHERE id = ?`,
        [configJson, datasetId],
      );

      // 2. entity_aspects row — dirty=1 so the sync engine pushes it to the server
      if (toolInstanceId) {
        const existing = await db.select<{ id: string }[]>(
          `SELECT id FROM entity_aspects
            WHERE entity_id = ? AND aspect_type = 'analytics_config'
              AND IFNULL(tool_instance_id, '') = ?
            LIMIT 1`,
          [datasetId, toolInstanceId],
        );
        if (existing.length > 0 && existing[0]) {
          await db.execute(
            `UPDATE entity_aspects SET data = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
            [configJson, now, existing[0].id],
          );
        } else {
          await db.execute(
            `INSERT INTO entity_aspects
               (id, entity_id, aspect_type, data, tool_instance_id, sort_order,
                created_at, updated_at, deleted_at, dirty, revision)
             VALUES (?, ?, 'analytics_config', ?, ?, 0, ?, ?, NULL, 1, 0)`,
            [crypto.randomUUID(), datasetId, configJson, toolInstanceId, now, now],
          );
        }
        eventBus.emit('sync:dirty', undefined);
      }
    } catch (err) {
      console.error('[module:analytics] Failed to persist axis config:', err);
    }
  }, [toolInstanceId]);

  // Reset chart state and load the saved config when the selected dataset changes.
  useEffect(() => {
    setAxisConfig(DEFAULT_AXIS_CONFIG);
    setChartPoints([]);
    setQueryError(null);
    lastSavedConfigRef.current = null; // block saves until loadConfig resolves
    if (selectedId) {
      void loadConfig(selectedId);
    }
  }, [selectedId, loadConfig]);

  // Debounce-save the axis config whenever the user changes it.
  useEffect(() => {
    if (!selectedId || lastSavedConfigRef.current === null) return;
    const configJson = JSON.stringify(axisConfig);
    if (configJson === lastSavedConfigRef.current) return; // no real change
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      lastSavedConfigRef.current = configJson;
      void saveConfig(selectedId, axisConfig);
    }, 500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [axisConfig, selectedId, saveConfig]);

  // Fire aggregation whenever runQuery reference updates (dataset or config changed)
  useEffect(() => {
    void runQuery();
  }, [runQuery]);

  const selected = datasets.find((d) => d.id === selectedId) ?? null;
  const selectedHeaders = selected ? parseHeaders(selected.headers) : [];

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden bg-background">
      {/* ── Sidebar: dataset list ─────────────────────────────────────────── */}
      <aside className="w-60 flex-shrink-0 border-r border-border flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold text-foreground">Datasets</span>
        </div>

        {loadError ? (
          <p className="px-4 py-4 text-xs text-destructive">{loadError}</p>
        ) : datasets.length === 0 ? (
          <p className="px-4 py-6 text-xs text-muted-foreground text-center leading-relaxed">
            No datasets yet.
            <br />
            Import a CSV file to get started.
          </p>
        ) : (
          <ul className="flex-1 overflow-y-auto py-1">
            {datasets.map((ds) => {
              const colCount = parseHeaders(ds.headers).length;
              return (
                <li key={ds.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(ds.id)}
                    className={cn(
                      'w-full text-left px-4 py-2.5 transition-colors',
                      selectedId === ds.id
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-accent/50 text-foreground',
                    )}
                  >
                    <div className="text-sm font-medium truncate">{ds.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {ds.row_count.toLocaleString()} rows · {colCount} cols
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/*
          Import zone — CSVImportZone triggers native file picker and
          streams the CSV via the Rust command off the UI thread.
        */}
        <div className="border-t border-border p-3">
          <CSVImportZone onComplete={() => void loadDatasets()} />
        </div>
      </aside>

      {/* ── Main panel ───────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {selected ? (
          <>
            {/* Dataset header */}
            <div className="flex items-center gap-4 px-6 py-3 border-b border-border">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground truncate">
                  {selected.name}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {selected.row_count.toLocaleString()} rows ·{' '}
                  {selectedHeaders.length} columns · imported{' '}
                  {selected.created_at.slice(0, 10)}
                </p>
              </div>
            </div>

            {/* Column header chips */}
            <div className="px-6 py-3 border-b border-border overflow-x-auto">
              <div className="flex flex-wrap gap-1.5">
                {selectedHeaders.map((h) => (
                  <span
                    key={h}
                    className="inline-flex items-center px-2 py-0.5 rounded bg-muted text-xs text-muted-foreground font-mono"
                  >
                    {h}
                  </span>
                ))}
              </div>
            </div>

            {/* Axis configuration strip */}
            <AxisConfigurator
              headers={selectedHeaders}
              value={axisConfig}
              onChange={setAxisConfig}
            />

            {/* Chart area */}
            <div className="flex-1 overflow-hidden">
              {isQuerying ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-sm text-muted-foreground">Computing…</p>
                </div>
              ) : queryError !== null ? (
                <div className="h-full flex items-center justify-center px-8">
                  <p className="text-sm text-destructive text-center">{queryError}</p>
                </div>
              ) : axisConfig.xCol === null || !axisConfig.ySeries.some((s) => s.colId !== null) ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-sm text-muted-foreground">
                    Select at least one Y series metric above to render a chart.
                  </p>
                </div>
              ) : chartPoints.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-sm text-muted-foreground">
                    No data returned for the current selection.
                  </p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={chartPoints}
                    margin={{ top: 20, right: 24, bottom: 28, left: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.2)" />
                    <XAxis dataKey="x" tick={{ fontSize: 11 }} />
                    <YAxis
                      yAxisId="primary"
                      orientation="left"
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip />
                    <Legend />
                    {/* Step 4.4 & 4.5 — polymorphic series loop */}
                    {axisConfig.ySeries.map((s, i) => {
                      if (s.colId === null) return null;
                      const dataKey = `y_${i}`;
                      const name = `${s.agg}(${selectedHeaders[s.colId] ?? String(s.colId)})`;
                      if (s.drawType === 'bar') {
                        return (
                          <Bar
                            key={i}
                            yAxisId="primary"
                            dataKey={dataKey}
                            name={name}
                            fill={s.fillHex}
                            maxBarSize={60}
                          />
                        );
                      }
                      if (s.drawType === 'area') {
                        return (
                          <Area
                            key={i}
                            yAxisId="primary"
                            type="monotone"
                            dataKey={dataKey}
                            name={name}
                            fill={s.fillHex}
                            stroke={s.fillHex}
                            strokeWidth={2}
                          />
                        );
                      }
                      return (
                        <Line
                          key={i}
                          yAxisId="primary"
                          type="monotone"
                          dataKey={dataKey}
                          name={name}
                          stroke={s.fillHex}
                          strokeWidth={2}
                          dot={false}
                        />
                      );
                    })}
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-8">
            <p className="text-sm text-muted-foreground">
              {datasets.length === 0
                ? 'Use the import button to load a CSV file.'
                : 'Select a dataset from the sidebar.'}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
