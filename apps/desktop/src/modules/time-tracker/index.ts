import { invoke } from '@tauri-apps/api/core';
import { eventBus } from '@/core/events';
import type { HybridEntity } from '@syncrohws/shared-types';

export { TimeTrackerView } from './TimeTrackerView';
export type { TimeLogItem } from './TimeTrackerView';
export { formatDuration } from './TimeTrackerView';
export { ManualEntryForm } from './ManualEntryForm';
export { TimeTrackerReports } from './TimeTrackerReports';

function timeLogData(entity: HybridEntity): Record<string, unknown> {
  return (entity.aspects.find((a) => a.aspect_type === 'time_log')?.data ?? {}) as Record<string, unknown>;
}

/** Extract display title from a time-log hybrid entity. */
export function getEntityTitle(entity: HybridEntity): string {
  if (entity.core.title) return entity.core.title;
  const data = timeLogData(entity);
  return (typeof data['description'] === 'string' && data['description']) || 'Time Log';
}

/** Extract subtitle from a time-log hybrid entity. */
export function getEntitySubtitle(entity: HybridEntity): string | undefined {
  const data = timeLogData(entity);
  const parts: string[] = [];
  if (typeof data['duration_seconds'] === 'number' && data['duration_seconds'] > 0) {
    const mins = Math.round(data['duration_seconds'] / 60);
    parts.push(mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`);
  }
  if (typeof data['project'] === 'string' && data['project']) parts.push(data['project']);
  if (data['billable'] === true) parts.push('billable');
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

