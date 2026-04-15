/**
 * TimeTrackerView — live time-tracking panel.
 *
 * Features:
 *  - Shows currently active OS window (updates via tracker:window-changed)
 *  - Manual Start / Stop controls that persist a time_log entity to SQLite
 *  - Displays the 10 most recent time logs from the local DB
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { eventBus } from '@/core/events';
import { getWorkspaceDB } from '@/core/db';
import type { BaseEntity, TimeLogPayload } from '@syncrohws/shared-types';

interface TimeLog {
  id: string;
  description: string;
  start: string;
  end: string | null;
  duration_seconds: number | null;
  window_title: string;
}

export function TimeTrackerView(): React.ReactElement {
  const [currentWindow, setCurrentWindow] = useState<string>('—');
  const [isTracking, setIsTracking] = useState(false);
  const [activeLogId, setActiveLogId] = useState<string | null>(null);
  const [activeStart, setActiveStart] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState(0); // seconds
  const [recentLogs, setRecentLogs] = useState<TimeLog[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load recent logs ───────────────────────────────────────────────────────
  const loadLogs = useCallback(async (): Promise<void> => {
    try {
      const db = getWorkspaceDB();
      const rows = await db.select<{ id: string; payload: string }[]>(
        `SELECT id, payload FROM base_entities
         WHERE type = 'time_log' AND deleted_at IS NULL
         ORDER BY updated_at DESC LIMIT 10`,
      );
      const logs: TimeLog[] = rows.map((r) => {
        const p = JSON.parse(r.payload) as TimeLogPayload;
        return {
          id: r.id,
          description: p.description,
          start: p.start,
          end: p.end ?? null,
          duration_seconds: p.duration_seconds ?? null,
          window_title: p.window_title ?? '',
        };
      });
      setRecentLogs(logs);
    } catch (err) {
      console.error('[time-tracker] failed to load logs:', err);
    }
  }, []);

  // ── Listen for window changes from the poller in time-tracker/index.ts ─────
  useEffect(() => {
    const handler = ({ window_title }: { window_title: string; timestamp: string }): void => {
      setCurrentWindow(window_title);
    };
    eventBus.on('tracker:window-changed', handler);

    // Load logs on mount
    void loadLogs();

    return () => {
      eventBus.off('tracker:window-changed', handler);
    };
  }, [loadLogs]);

  // ── Elapsed timer while tracking ───────────────────────────────────────────
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

  // ── Start tracking ─────────────────────────────────────────────────────────
  const startTracking = useCallback(async (): Promise<void> => {
    const id = crypto.randomUUID();
    const now = new Date();
    const payload: TimeLogPayload = {
      description: `Working on: ${currentWindow}`,
      start: now.toISOString(),
      end: null,
      duration_seconds: null,
      window_title: currentWindow,
      billable: false,
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
      eventBus.emit('tracker:start', { description: payload.description });
    } catch (err) {
      console.error('[time-tracker] failed to start log:', err);
    }
  }, [currentWindow]);

  // ── Stop tracking ──────────────────────────────────────────────────────────
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
      const firstRow = row[0];
      if (firstRow) {
        const existing = JSON.parse(firstRow.payload) as TimeLogPayload;
        const updated: TimeLogPayload = {
          ...existing,
          end: now.toISOString(),
          duration_seconds: duration,
        };
        await db.execute(
          `UPDATE base_entities SET payload = ?, updated_at = ? WHERE id = ?`,
          [JSON.stringify(updated), now.toISOString(), activeLogId],
        );
      }

      const updatedEntity: BaseEntity = {
        id: activeLogId,
        type: 'time_log',
        payload: {},
        metadata: {},
        tags: [],
        parent_id: null,
        created_at: activeStart.toISOString(),
        updated_at: now.toISOString(),
        deleted_at: null,
      };
      eventBus.emit('entity:updated', { entity: updatedEntity });
      eventBus.emit('tracker:stop', { time_log_id: activeLogId });
    } catch (err) {
      console.error('[time-tracker] failed to stop log:', err);
    }

    setIsTracking(false);
    setActiveLogId(null);
    setActiveStart(null);
    void loadLogs();
  }, [activeLogId, activeStart, loadLogs]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 overflow-auto">

      {/* ── Active window card ──────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-5">
        <p className="mb-1.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Active Window
        </p>
        <p className="truncate font-mono text-sm text-foreground">
          {currentWindow}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Polls every 60 s via OS window hook
        </p>
      </section>

      {/* ── Tracker control card ────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            {isTracking ? (
              <>
                <p className="text-sm font-medium text-foreground">Tracking…</p>
                <p className="font-mono text-2xl font-semibold tabular-nums text-foreground">
                  {formatDuration(elapsed)}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {currentWindow}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground">Not tracking</p>
                <p className="text-xs text-muted-foreground">
                  Press Start to log time against the current window
                </p>
              </>
            )}
          </div>

          <button
            onClick={isTracking ? () => void stopTracking() : () => void startTracking()}
            className={[
              'shrink-0 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors',
              isTracking
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90',
            ].join(' ')}
          >
            {isTracking ? 'Stop' : 'Start'}
          </button>
        </div>
      </section>

      {/* ── Recent logs ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Recent Logs
          </p>
          <button
            onClick={() => void loadLogs()}
            className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Refresh
          </button>
        </div>

        {recentLogs.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No time logs yet — start tracking above
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {recentLogs.map((log) => (
              <li
                key={log.id}
                className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3 text-sm"
              >
                <div className="flex flex-col gap-0.5 overflow-hidden">
                  <p className="truncate font-medium text-foreground">{log.description}</p>
                  <p className="truncate text-xs text-muted-foreground">{log.window_title}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-xs text-foreground">
                    {log.duration_seconds != null
                      ? formatDuration(log.duration_seconds)
                      : 'in progress'}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatTime(log.start)}
                    {log.end ? ` → ${formatTime(log.end)}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
