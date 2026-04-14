import { invoke } from '@tauri-apps/api/core';
import { eventBus } from '@/core/events';
import type { TimeLogPayload } from '@syncrohws/shared-types';

const POLL_INTERVAL_MS = 60_000; // 60 seconds — as specified in IMPLEMENTATION.md

let _lastWindowTitle = '';
let _pollHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Time Tracker module — registers all Event Bus listeners.
 * Call init() once at app startup.
 */
export function init(): void {
  _startWindowPoller();

  eventBus.on('tracker:window-changed', ({ window_title, timestamp }) => {
    // Auto-suggest a time log entry based on the active window
    const suggestedDescription = `Working on: ${window_title}`;
    console.log(`[module:time-tracker] window changed → "${window_title}" at ${timestamp}`);
    // Emit a notification so the user can confirm the time log
    eventBus.emit('notification:show', {
      title: 'Time tracker suggestion',
      body: suggestedDescription,
      type: 'info',
    });
  });

  eventBus.on('tracker:start', ({ description }) => {
    console.log('[module:time-tracker] tracking started:', description);
  });

  eventBus.on('tracker:stop', ({ time_log_id }) => {
    console.log('[module:time-tracker] tracking stopped, log id:', time_log_id);
  });

  console.log('[module:time-tracker] initialised');
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
  };
}
