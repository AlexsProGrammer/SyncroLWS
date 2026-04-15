/**
 * TimeTrackerView — Full time tracking panel with tabs.
 *
 * Tab 1 – Timer: prominent start/stop, active window, live elapsed, recent logs with edit/delete
 * Tab 2 – Manual: manual time entry form
 * Tab 3 – Reports: daily/weekly/monthly charts + CSV/PDF export
 */
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { eventBus } from '@/core/events';
import { getWorkspaceDB } from '@/core/db';
import { Button } from '@/ui/components/button';
import { Badge } from '@/ui/components/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/ui/components/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/tooltip';
import type { BaseEntity, TimeLogPayload } from '@syncrohws/shared-types';
import { ManualEntryForm } from './ManualEntryForm';
import { TimeTrackerReports } from './TimeTrackerReports';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TimeLogItem {
  id: string;
  payload: TimeLogPayload;
  created_at: string;
  updated_at: string;
}

interface DBRow {
  id: string;
  type: string;
  payload: string;
  created_at: string;
  updated_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TimeTrackerView(): React.ReactElement {
  const [currentWindow, setCurrentWindow] = useState<string>('—');
  const [isTracking, setIsTracking] = useState(false);
  const [activeLogId, setActiveLogId] = useState<string | null>(null);
  const [activeStart, setActiveStart] = useState<Date | null>(null);
  const [activeDesc, setActiveDesc] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [logs, setLogs] = useState<TimeLogItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load logs ─────────────────────────────────────────────────────────────

  const loadLogs = useCallback(async (): Promise<void> => {
    try {
      const db = getWorkspaceDB();
      const rows = await db.select<DBRow[]>(
        `SELECT id, type, payload, created_at, updated_at FROM base_entities
         WHERE type = 'time_log' AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 50`,
      );
      const items: TimeLogItem[] = rows.map((r) => {
        const p = JSON.parse(r.payload) as TimeLogPayload;
        return {
          id: r.id,
          payload: {
            description: p.description ?? '',
            start: p.start,
            end: p.end ?? null,
            duration_seconds: p.duration_seconds ?? null,
            window_title: p.window_title ?? '',
            billable: p.billable ?? false,
            hourly_rate_cents: p.hourly_rate_cents ?? 0,
            project: p.project ?? '',
            manual: p.manual ?? false,
          },
          created_at: r.created_at,
          updated_at: r.updated_at,
        };
      });
      setLogs(items);
    } catch (err) {
      console.error('[time-tracker] load failed:', err);
    }
  }, []);

  // ── Window change listener ────────────────────────────────────────────────

  useEffect(() => {
    const handler = ({ window_title }: { window_title: string }): void => {
      setCurrentWindow(window_title);
    };
    eventBus.on('tracker:window-changed', handler);
    void loadLogs();
    return () => {
      eventBus.off('tracker:window-changed', handler);
    };
  }, [loadLogs]);

  // Entity event reload
  useEffect(() => {
    const handler = (): void => {
      void loadLogs();
    };
    eventBus.on('entity:created', handler);
    eventBus.on('entity:updated', handler);
    eventBus.on('entity:deleted', handler);
    return () => {
      eventBus.off('entity:created', handler);
      eventBus.off('entity:updated', handler);
      eventBus.off('entity:deleted', handler);
    };
  }, [loadLogs]);

  // ── Elapsed timer ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (isTracking && activeStart) {
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - activeStart.getTime()) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setElapsed(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isTracking, activeStart]);

  // ── Start tracking ────────────────────────────────────────────────────────

  const startTracking = useCallback(async (): Promise<void> => {
    const id = crypto.randomUUID();
    const now = new Date();
    const desc = activeDesc.trim() || `Working on: ${currentWindow}`;
    const payload: TimeLogPayload = {
      description: desc,
      start: now.toISOString(),
      end: null,
      duration_seconds: null,
      window_title: currentWindow,
      billable: false,
      hourly_rate_cents: 0,
      project: '',
      manual: false,
    };

    try {
      const db = getWorkspaceDB();
      await db.execute(
        `INSERT INTO base_entities
           (id, type, payload, metadata, tags, parent_id, created_at, updated_at)
         VALUES (?, 'time_log', ?, '{}', '[]', NULL, ?, ?)`,
        [id, JSON.stringify(payload), now.toISOString(), now.toISOString()],
      );
      setActiveLogId(id);
      setActiveStart(now);
      setIsTracking(true);
      eventBus.emit('tracker:start', { description: desc });
      eventBus.emit('entity:created', {
        entity: {
          id,
          type: 'time_log',
          payload,
          metadata: {},
          tags: [],
          parent_id: null,
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
          deleted_at: null,
        },
      });
    } catch (err) {
      console.error('[time-tracker] start failed:', err);
    }
  }, [currentWindow, activeDesc]);

  // ── Stop tracking ─────────────────────────────────────────────────────────

  const stopTracking = useCallback(async (): Promise<void> => {
    if (!activeLogId || !activeStart) return;

    const now = new Date();
    const duration = Math.floor((now.getTime() - activeStart.getTime()) / 1000);

    try {
      const db = getWorkspaceDB();
      const row = await db.select<{ payload: string }[]>(
        `SELECT payload FROM base_entities WHERE id = ?`,
        [activeLogId],
      );
      if (row[0]) {
        const existing = JSON.parse(row[0].payload) as TimeLogPayload;
        const updated: TimeLogPayload = {
          ...existing,
          end: now.toISOString(),
          duration_seconds: duration,
        };
        await db.execute(
          `UPDATE base_entities SET payload = ?, updated_at = ? WHERE id = ?`,
          [JSON.stringify(updated), now.toISOString(), activeLogId],
        );

        eventBus.emit('entity:updated', {
          entity: {
            id: activeLogId,
            type: 'time_log',
            payload: updated,
            metadata: {},
            tags: [],
            parent_id: null,
            created_at: activeStart.toISOString(),
            updated_at: now.toISOString(),
            deleted_at: null,
          },
        });
        eventBus.emit('tracker:stop', { time_log_id: activeLogId });
      }
    } catch (err) {
      console.error('[time-tracker] stop failed:', err);
    }

    setIsTracking(false);
    setActiveLogId(null);
    setActiveStart(null);
    setActiveDesc('');
    void loadLogs();
  }, [activeLogId, activeStart, loadLogs]);

  // ── Delete log ────────────────────────────────────────────────────────────

  const deleteLog = useCallback(
    async (logId: string) => {
      try {
        const db = getWorkspaceDB();
        await db.execute(
          `UPDATE base_entities SET deleted_at = ? WHERE id = ?`,
          [new Date().toISOString(), logId],
        );
        setLogs((prev) => prev.filter((l) => l.id !== logId));
        eventBus.emit('entity:deleted', { id: logId, type: 'time_log' });
      } catch (err) {
        console.error('[time-tracker] delete failed:', err);
      }
    },
    [],
  );

  // ── Update log (inline edit: billable, project, description) ──────────────

  const updateLog = useCallback(
    async (logId: string, updates: Partial<TimeLogPayload>) => {
      try {
        const db = getWorkspaceDB();
        const row = await db.select<{ payload: string }[]>(
          `SELECT payload FROM base_entities WHERE id = ?`,
          [logId],
        );
        if (!row[0]) return;
        const existing = JSON.parse(row[0].payload) as TimeLogPayload;
        const updated: TimeLogPayload = { ...existing, ...updates };
        const now = new Date().toISOString();
        await db.execute(
          `UPDATE base_entities SET payload = ?, updated_at = ? WHERE id = ?`,
          [JSON.stringify(updated), now, logId],
        );
        setLogs((prev) =>
          prev.map((l) =>
            l.id === logId ? { ...l, payload: updated, updated_at: now } : l,
          ),
        );
        eventBus.emit('entity:updated', {
          entity: {
            id: logId,
            type: 'time_log',
            payload: updated,
            metadata: {},
            tags: [],
            parent_id: null,
            created_at: '',
            updated_at: now,
            deleted_at: null,
          },
        });
        setEditingId(null);
      } catch (err) {
        console.error('[time-tracker] update failed:', err);
      }
    },
    [],
  );

  // ── Total stats ───────────────────────────────────────────────────────────

  const todayStats = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayLogs = logs.filter((l) => l.payload.start.slice(0, 10) === todayStr);
    const totalSeconds = todayLogs.reduce((acc, l) => acc + (l.payload.duration_seconds ?? 0), 0);
    const billableSeconds = todayLogs
      .filter((l) => l.payload.billable)
      .reduce((acc, l) => acc + (l.payload.duration_seconds ?? 0), 0);
    return { count: todayLogs.length, totalSeconds, billableSeconds };
  }, [logs]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Tabs defaultValue="timer" className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 pt-3 pb-0">
          <TabsList className="h-9">
            <TabsTrigger value="timer" className="text-xs">Timer</TabsTrigger>
            <TabsTrigger value="manual" className="text-xs">Manual Entry</TabsTrigger>
            <TabsTrigger value="reports" className="text-xs">Reports</TabsTrigger>
          </TabsList>

          {/* Today's summary */}
          <div className="flex items-center gap-3 pr-1 text-xs text-muted-foreground">
            <span>Today: <strong className="text-foreground">{formatDuration(todayStats.totalSeconds)}</strong></span>
            {todayStats.billableSeconds > 0 && (
              <span>Billable: <strong className="text-green-500">{formatDuration(todayStats.billableSeconds)}</strong></span>
            )}
            <span>{todayStats.count} entries</span>
          </div>
        </div>

        {/* ── Timer Tab ──────────────────────────────────────────────── */}
        <TabsContent value="timer" className="flex flex-1 flex-col gap-4 overflow-auto p-4">
          {/* Active window */}
          <section className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Active Window
            </p>
            <p className="truncate font-mono text-sm text-foreground">{currentWindow}</p>
          </section>

          {/* Timer control */}
          <section className="rounded-xl border-2 border-border bg-card p-6">
            <div className="flex items-center gap-4">
              {/* Description input */}
              <input
                type="text"
                placeholder="What are you working on?"
                value={activeDesc}
                onChange={(e) => setActiveDesc(e.target.value)}
                disabled={isTracking}
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isTracking) void startTracking();
                }}
              />

              {/* Elapsed display */}
              <div className="min-w-[100px] text-center">
                <p className="font-mono text-2xl font-bold tabular-nums text-foreground">
                  {formatDuration(elapsed)}
                </p>
              </div>

              {/* Start/Stop button */}
              <Button
                onClick={isTracking ? () => void stopTracking() : () => void startTracking()}
                size="lg"
                className={
                  isTracking
                    ? 'min-w-[80px] bg-destructive text-destructive-foreground hover:bg-destructive/90'
                    : 'min-w-[80px] bg-green-600 text-white hover:bg-green-700'
                }
              >
                {isTracking ? (
                  <span className="flex items-center gap-1.5">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                    Stop
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
                    Start
                  </span>
                )}
              </Button>
            </div>

            {isTracking && (
              <p className="mt-2 truncate text-xs text-muted-foreground">
                Tracking: {activeDesc || currentWindow}
              </p>
            )}
          </section>

          {/* Recent logs */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Recent Time Logs
              </p>
            </div>

            {logs.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No time logs yet — start tracking above or add a manual entry
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {logs.map((log) => (
                  <TimeLogRow
                    key={log.id}
                    log={log}
                    isEditing={editingId === log.id}
                    onEdit={() => setEditingId(log.id)}
                    onCancelEdit={() => setEditingId(null)}
                    onUpdate={updateLog}
                    onDelete={deleteLog}
                  />
                ))}
              </div>
            )}
          </section>
        </TabsContent>

        {/* ── Manual Entry Tab ───────────────────────────────────────── */}
        <TabsContent value="manual" className="flex-1 overflow-auto p-4">
          <ManualEntryForm onSaved={loadLogs} />
        </TabsContent>

        {/* ── Reports Tab ────────────────────────────────────────────── */}
        <TabsContent value="reports" className="flex-1 overflow-auto p-4">
          <TimeTrackerReports logs={logs} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── TimeLogRow ────────────────────────────────────────────────────────────────

interface TimeLogRowProps {
  log: TimeLogItem;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onUpdate: (id: string, updates: Partial<TimeLogPayload>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function TimeLogRow({ log, isEditing, onEdit, onCancelEdit, onUpdate, onDelete }: TimeLogRowProps): React.ReactElement {
  const { payload } = log;
  const [desc, setDesc] = useState(payload.description);
  const [project, setProject] = useState(payload.project);
  const [billable, setBillable] = useState(payload.billable);

  if (isEditing) {
    return (
      <div className="rounded-lg border-2 border-primary/30 bg-card p-3">
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Description"
            className="rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="Project / Client"
              className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={billable}
                onChange={(e) => setBillable(e.target.checked)}
                className="rounded"
              />
              Billable
            </label>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={onCancelEdit} className="h-7 text-xs">
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() =>
                void onUpdate(log.id, {
                  description: desc.trim(),
                  project: project.trim(),
                  billable,
                })
              }
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-sm transition-colors hover:border-border/80">
      {/* Billable indicator */}
      <div
        className={`h-8 w-1 shrink-0 rounded-full ${payload.billable ? 'bg-green-500' : 'bg-muted'}`}
        title={payload.billable ? 'Billable' : 'Non-billable'}
      />

      {/* Description + metadata */}
      <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium text-foreground">{payload.description}</p>
          {payload.manual && (
            <Badge variant="outline" className="h-4 text-[10px] px-1">Manual</Badge>
          )}
          {payload.billable && (
            <Badge variant="secondary" className="h-4 text-[10px] px-1 bg-green-500/10 text-green-500">$</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {payload.project && <span className="truncate">{payload.project}</span>}
          {payload.project && payload.window_title && <span>·</span>}
          {payload.window_title && <span className="truncate">{payload.window_title}</span>}
        </div>
      </div>

      {/* Duration + time range */}
      <div className="shrink-0 text-right">
        <p className="font-mono text-xs font-medium text-foreground">
          {payload.duration_seconds != null
            ? formatDuration(payload.duration_seconds)
            : 'in progress'}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {formatDate(payload.start)} {formatTime(payload.start)}
          {payload.end ? ` → ${formatTime(payload.end)}` : ''}
        </p>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onEdit}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top"><p>Edit</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => void onDelete(log.id)}
                className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top"><p>Delete</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
