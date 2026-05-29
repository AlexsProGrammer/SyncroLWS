import React, { useState, useEffect, useCallback } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
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
import type { AxisConfig } from './components/AxisConfigurator';
import { buildAggregationQuery, mapToChartPoints } from './utils/aggregationEngine';
import type { AggRow, ChartPoint } from './utils/aggregationEngine';
import type { ToolViewProps } from '@/registry/ToolRegistry';

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

// ── Component ─────────────────────────────────────────────────────────────────

export function AnalyticsDashboardView({ toolInstanceId: _toolInstanceId }: ToolViewProps): React.ReactElement {
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [axisConfig, setAxisConfig] = useState<AxisConfig>(DEFAULT_AXIS_CONFIG);
  const [chartPoints, setChartPoints] = useState<ChartPoint[]>([]);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [isQuerying, setIsQuerying] = useState(false);

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
      const rows = await db.select<AggRow[]>(built.sql, [...built.params]);
      setChartPoints(mapToChartPoints(rows));
    } catch (err) {
      console.error('[module:analytics] Aggregation query failed:', err);
      setQueryError(
        'Query failed — ensure Y columns contain numeric values for AVG / SUM.',
      );
    } finally {
      setIsQuerying(false);
    }
  }, [selectedId, axisConfig]);

  // Reset axis state when the active dataset changes
  useEffect(() => {
    setAxisConfig(DEFAULT_AXIS_CONFIG);
    setChartPoints([]);
    setQueryError(null);
  }, [selectedId]);

  // Fire aggregation whenever runQuery reference updates (dataset or config changed)
  useEffect(() => {
    void runQuery();
  }, [runQuery]);

  const selected = datasets.find((d) => d.id === selectedId) ?? null;
  const selectedHeaders = selected ? parseHeaders(selected.headers) : [];

  return (
    <div className="flex h-full overflow-hidden bg-background">
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
              ) : axisConfig.xCol === null || axisConfig.y1Col === null ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-sm text-muted-foreground">
                    Select X and Y1 columns above to render a chart.
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
                    margin={{
                      top: 20,
                      right: axisConfig.y2Col !== null ? 60 : 24,
                      bottom: 28,
                      left: 8,
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.2)" />
                    <XAxis dataKey="x" tick={{ fontSize: 11 }} />
                    <YAxis
                      yAxisId="primary"
                      orientation="left"
                      tick={{ fontSize: 11 }}
                    />
                    {axisConfig.y2Col !== null && (
                      <YAxis
                        yAxisId="secondary"
                        orientation="right"
                        tick={{ fontSize: 11 }}
                      />
                    )}
                    <Tooltip />
                    <Legend />
                    <Bar
                      yAxisId="primary"
                      dataKey="y1"
                      name={`${axisConfig.y1Agg}(${selectedHeaders[axisConfig.y1Col] ?? 'Y1'})`}
                      fill="#6366f1"
                      maxBarSize={60}
                    />
                    {axisConfig.y2Col !== null && (
                      <Line
                        yAxisId="secondary"
                        type="monotone"
                        dataKey="y2"
                        name={`${axisConfig.y2Agg}(${selectedHeaders[axisConfig.y2Col] ?? 'Y2'})`}
                        stroke="#f59e0b"
                        strokeWidth={2}
                        dot={false}
                      />
                    )}
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
