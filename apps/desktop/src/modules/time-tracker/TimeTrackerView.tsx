/**
 * TimeTrackerView — Hybrid-entity edition.
 * `description` now lives on EntityCore.title; everything else on the time_log aspect.
 * The TimeLogItem shape is preserved for compatibility with reports & manual entry.
 */
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { eventBus } from '@/core/events';
import {
  listByAspect,
  softDeleteEntity,
  updateAspect,
  updateCore,
  type AspectWithCore,
} from '@/core/entityStore';
import { Button } from '@/ui/components/button';
import { Badge } from '@/ui/components/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/ui/components/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/tooltip';
import type { TimeLogAspectData } from '@syncrohws/shared-types';
import { ManualEntryForm } from './ManualEntryForm';
import { TimeTrackerReports } from './TimeTrackerReports';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * TimeLogItem — adapter shape that carries both the entity core id and the
 * time_log aspect id, plus a flat payload merging `core.title` (as description)
 * with the aspect's data fields. Kept for compat with reports & manual entry.
 */
export interface TimeLogPayload {
  description: string;
  start: string;
  end: string | null;
  duration_seconds: number | null;
  window_title: string;
  billable: boolean;
  hourly_rate_cents: number;
  project: string;
  manual: boolean;
}

export interface TimeLogItem {
  id: string;          // core entity id
  aspectId: string;    // aspect id
  payload: TimeLogPayload;
  created_at: string;
  updated_at: string;
}

function toItem(row: AspectWithCore): TimeLogItem {
  const d = row.aspect.data as Partial<TimeLogAspectData>;
  return {
    id: row.core.id,
    aspectId: row.aspect.id,
    payload: {
      description: row.core.title,
      start: d.start ?? row.core.created_at,
      end: d.end ?? null,
      duration_seconds: d.duration_seconds ?? null,
      window_title: d.window_title ?? '',
      billable: d.billable ?? false,
      hourly_rate_cents: d.hourly_rate_cents ?? 0,
      project: d.project ?? '',
      manual: d.manual ?? false,
    },
    created_at: row.core.created_at,
    updated_at: row.core.updated_at,
  };
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
  const [activeCoreId, setActiveCoreId] = useState<string | null>(null);
  const [activeAspectId, setActiveAspectId] = useState<string | null>(null);
  const [activeStart, setActiveStart] = useState<Date | null>(null);
  const [activeDesc, setActiveDesc] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [logs, setLogs] = useState<TimeLogItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load logs ─────────────────────────────────────────────────────────────

  const loadLogs = useCallback(async (): Promise<void> => {
    try {
      const rows = await listByAspect('time_log', { limit: 100 });
      const items = rows.map(toItem);
      // Sort newest first
      items.sort((a, b) => b.payload.start.localeCompare(a.payload.start));
      setLogs(items.slice(0, 50));
    } catch (err) {
      console.error('[time-tracker] load failed:', err);
    }
  }, []);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  // Window change listener
  useEffect(() => {
    const handler = ({ window_title }: { window_title: string }): void => {
      setCurrentWindow(window_title);
    };
    eventBus.on('tracker:window-changed', handler);
    return () => {
      eventBus.off('tracker:window-changed', handler);
    };
  }, []);

  // Reload on entity changes
  useEffect(() => {
    const onChange = (): void => void loadLogs();
    const events = [
      'core:created', 'core:updated', 'core:deleted',
      'aspect:added', 'aspect:updated', 'aspect:removed',
      'entity:created', 'entity:updated', 'entity:deleted',
    ] as const;
    events.forEach((e) => eventBus.on(e, onChange));
    return () => events.forEach((e) => eventBus.off(e, onChange));
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
    const now = new Date();
    const desc = activeDesc.trim() || `Working on: ${currentWindow}`;
    const data: TimeLogAspectData = {
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
      const { createEntity } = await import('@/core/entityStore');
      const created = await createEntity({
        core: { title: desc, tags: [] },
        aspects: [{ aspect_type: 'time_log', data }],
      });
      const aspect = created.aspects.find((a) => a.aspect_type === 'time_log');
      if (!aspect) throw new Error('time_log aspect missing after create');
      setActiveCoreId(created.core.id);
      setActiveAspectId(aspect.id);
      setActiveStart(now);
      setIsTracking(true);
      eventBus.emit('tracker:start', { description: desc });
    } catch (err) {
      console.error('[time-tracker] start failed:', err);
    }
  }, [currentWindow, activeDesc]);

  // ── Stop tracking ─────────────────────────────────────────────────────────

  const stopTracking = useCallback(async (): Promise<void> => {
    if (!activeCoreId || !activeAspectId || !activeStart) return;

    const now = new Date();
    const duration = Math.floor((now.getTime() - activeStart.getTime()) / 1000);

    try {
      await updateAspect(activeAspectId, {
        data: { end: now.toISOString(), duration_seconds: duration },
      });
      eventBus.emit('tracker:stop', { time_log_id: activeCoreId });
    } catch (err) {
      console.error('[time-tracker] stop failed:', err);
    }

    setIsTracking(false);
    setActiveCoreId(null);
    setActiveAspectId(null);
    setActiveStart(null);
    setActiveDesc('');
    void loadLogs();
  }, [activeCoreId, activeAspectId, activeStart, loadLogs]);

  // ── Delete log ────────────────────────────────────────────────────────────

  const deleteLog = useCallback(async (coreId: string) => {
    try {
      await softDeleteEntity(coreId);
      setLogs((prev) => prev.filter((l) => l.id !== coreId));
    } catch (err) {
      console.error('[time-tracker] delete failed:', err);
    }
  }, []);

  // ── Update log (inline edit: billable, project, description) ──────────────

  const updateLog = useCallback(
    async (coreId: string, aspectId: string, updates: Partial<TimeLogPayload>) => {
      try {
        if (updates.description !== undefined) {
          await updateCore(coreId, { title: updates.description });
        }
        const aspectUpdates: Partial<TimeLogAspectData> = {};
        if (updates.project !== undefined) aspectUpdates.project = updates.project;
        if (updates.billable !== undefined) aspectUpdates.billable = updates.billable;
        if (updates.hourly_rate_cents !== undefined) aspectUpdates.hourly_rate_cents = updates.hourly_rate_cents;
        if (updates.window_title !== undefined) aspectUpdates.window_title = updates.window_title;
        if (Object.keys(aspectUpdates).length > 0) {
          await updateAspect(aspectId, { data: aspectUpdates });
        }
        setEditingId(null);
        await loadLogs();
      } catch (err) {
        console.error('[time-tracker] update failed:', err);
      }
    },
    [loadLogs],
  );

  // ── Today stats ───────────────────────────────────────────────────────────

  const todayStats = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayLogs = logs.filter((l) => l.payload.start.slice(0, 10) === todayStr);
    const totalSeconds = todayLogs.reduce((acc, l) => acc + (l.payload.duration_seconds ?? 0), 0);
    const billableSeconds = todayLogs
      .filter((l) => l.payload.billable)
      .reduce((acc, l) => acc + (l.payload.duration_seconds ?? 0), 0);
    return { count: todayLogs.length, totalSeconds, billableSeconds };
  }, [logs]);

  // ── Open in detail sheet ──────────────────────────────────────────────────

  const openDetail = useCallback((coreId: string) => {
    eventBus.emit('nav:open-detail-sheet', { id: coreId, initialAspectType: 'time_log' });
  }, []);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Tabs defaultValue="timer" className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 pt-3 pb-0">
          <TabsList className="h-9">
            <TabsTrigger value="timer" className="text-xs">Timer</TabsTrigger>
            <TabsTrigger value="manual" className="text-xs">Manual Entry</TabsTrigger>
            <TabsTrigger value="reports" className="text-xs">Reports</TabsTrigger>
          </TabsList>

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
          <section className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Active Window
            </p>
            <p className="truncate font-mono text-sm text-foreground">{currentWindow}</p>
          </section>

          <section className="rounded-xl border-2 border-border bg-card p-6">
            <div className="flex items-center gap-4">
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

              <div className="min-w-[100px] text-center">
                <p className="font-mono text-2xl font-bold tabular-nums text-foreground">
                  {formatDuration(elapsed)}
                </p>
              </div>

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
                    onOpen={() => openDetail(log.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="manual" className="flex-1 overflow-auto p-4">
          <ManualEntryForm onSaved={loadLogs} />
        </TabsContent>

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
  onUpdate: (coreId: string, aspectId: string, updates: Partial<TimeLogPayload>) => Promise<void>;
  onDelete: (coreId: string) => Promise<void>;
  onOpen: () => void;
}

function TimeLogRow({ log, isEditing, onEdit, onCancelEdit, onUpdate, onDelete, onOpen }: TimeLogRowProps): React.ReactElement {
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
                void onUpdate(log.id, log.aspectId, {
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
      <div
        className={`h-8 w-1 shrink-0 rounded-full ${payload.billable ? 'bg-green-500' : 'bg-muted'}`}
        title={payload.billable ? 'Billable' : 'Non-billable'}
      />

      <div
        className="flex flex-1 cursor-pointer flex-col gap-0.5 overflow-hidden"
        onClick={onOpen}
      >
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
