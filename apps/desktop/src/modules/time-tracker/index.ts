import { invoke } from '@tauri-apps/api/core';
import { eventBus } from '@/core/events';
import type { TimeLogPayload } from '@syncrohws/shared-types';

export { TimeTrackerView } from './TimeTrackerView';
export type { TimeLogItem } from './TimeTrackerView';
export { formatDuration } from './TimeTrackerView';
export { ManualEntryForm } from './ManualEntryForm';
export { TimeTrackerReports } from './TimeTrackerReports';

/** Extract display title from a time log payload. */
export function getEntityTitle(payload: Record<string, unknown>): string {
  return (typeof payload['description'] === 'string' && payload['description']) || 'Time Log';
}

/** Extract subtitle from a time log payload (duration + project). */
export function getEntitySubtitle(payload: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  if (typeof payload['duration_seconds'] === 'number' && payload['duration_seconds'] > 0) {
    const mins = Math.round(payload['duration_seconds'] / 60);
    parts.push(mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`);
  }
  if (typeof payload['project'] === 'string' && payload['project']) parts.push(payload['project']);
  if (payload['billable'] === true) parts.push('billable');
  return parts.length ? parts.join(' · ') : undefined;
}

const POLL_INTERVAL_MS = 60_000; // 60 seconds — as specified in IMPLEMENTATION.md

let _lastWindowTitle = '';
let _pollHandle: ReturnType<typeof setInterval> | null = null;
const _eventHandlers: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];

/**
 * Time Tracker module — registers all Event Bus listeners.
 * Call init() once at app startup.
 */
export function init(): void {
  _startWindowPoller();

  const onWindowChanged = ({ window_title, timestamp }: { window_title: string; timestamp: string }): void => {
    console.log(`[module:time-tracker] window changed → "${window_title}" at ${timestamp}`);
    // Log only — no notification spam. UI shows suggestions in TimeTrackerView.
  };
  eventBus.on('tracker:window-changed', onWindowChanged);
  _eventHandlers.push({ event: 'tracker:window-changed', handler: onWindowChanged as (...args: unknown[]) => void });

  const onStart = ({ description }: { description: string }): void => {
    console.log('[module:time-tracker] tracking started:', description);
  };
  eventBus.on('tracker:start', onStart);
  _eventHandlers.push({ event: 'tracker:start', handler: onStart as (...args: unknown[]) => void });

  const onStop = ({ time_log_id }: { time_log_id: string }): void => {
    console.log('[module:time-tracker] tracking stopped, log id:', time_log_id);
  };
  eventBus.on('tracker:stop', onStop);
  _eventHandlers.push({ event: 'tracker:stop', handler: onStop as (...args: unknown[]) => void });

  console.log('[module:time-tracker] initialised');
}

/** Clean up poller and event listeners. Call on shutdown / profile switch. */
export function destroy(): void {
  _stopWindowPoller();
  for (const { event, handler } of _eventHandlers) {
    eventBus.off(event as Parameters<typeof eventBus.off>[0], handler as never);
  }
  _eventHandlers.length = 0;
  console.log('[module:time-tracker] destroyed');
}

function _startWindowPoller(): void {
  if (_pollHandle !== null) return;

  _pollHandle = setInterval(async () => {
    try {
      const title = await invoke<string>('get_active_window');
      if (title && title !== _lastWindowTitle) {
        _lastWindowTitle = title;
        eventBus.emit('tracker:window-changed', {
          window_title: title,
          timestamp: new Date().toISOString(),
        });
      }
    } catch {
      // get_active_window may not be available on all platforms — fail silently
    }
  }, POLL_INTERVAL_MS);
}

function _stopWindowPoller(): void {
  if (_pollHandle !== null) {
    clearInterval(_pollHandle);
    _pollHandle = null;
  }
}

export function createTimeLog(
  description: string,
  windowTitle: string,
  billable = false,
): TimeLogPayload {
  return {
    description,
    start: new Date().toISOString(),
    end: null,
    duration_seconds: null,
    window_title: windowTitle,
    billable,
    hourly_rate_cents: 0,
    project: '',
    manual: false,
  };
}
