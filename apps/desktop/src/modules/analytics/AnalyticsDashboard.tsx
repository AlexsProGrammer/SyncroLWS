import React, { useState, useEffect, useCallback } from 'react';
import { getWorkspaceDB } from '@/core/db';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/store/workspaceStore';
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
          Import zone anchor — CSVImportZone is mounted here in Phase 4.
          The id attr lets Phase 4 render the component without structural
          changes to this file.
        */}
        <div
          id="analytics-import-zone"
          className="border-t border-border p-3"
          data-testid="analytics-import-zone"
        />
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

            {/*
              Chart area — AxisConfigurator + recharts charts are mounted here
              by Phase 5. The id attr allows Phase 5 to augment this region.
            */}
            <div
              id="analytics-chart-area"
              className="flex-1 flex items-center justify-center"
            >
              <p className="text-sm text-muted-foreground">
                Configure axes to render a chart (coming in Phase 5).
              </p>
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
