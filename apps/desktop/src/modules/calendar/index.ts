import { eventBus } from '@/core/events';

export { CalendarView } from './CalendarView';
export { EventDetailModal } from './EventDetailModal';
export type { CalendarEventItem } from './EventDetailModal';

/** Extract display title from a calendar event payload. */
export function getEntityTitle(payload: Record<string, unknown>): string {
  return (typeof payload['title'] === 'string' && payload['title']) || 'Untitled Event';
}

/** Extract subtitle from a calendar event payload (date + location). */
export function getEntitySubtitle(payload: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  if (typeof payload['start'] === 'string') {
    const d = new Date(payload['start']);
    parts.push(d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  }
  if (typeof payload['location'] === 'string' && payload['location']) parts.push(payload['location']);
  return parts.length ? parts.join(' · ') : undefined;
}

/**
 * Calendar module — registers all Event Bus listeners.
 * Call init() once at app startup.
 * DECOUPLING TEST: deleting or commenting out this init() must NOT crash the app.
 */
export function init(): void {
  eventBus.on('entity:created', ({ entity }) => {
    if (entity.type !== 'calendar_event') return;
    console.log('[module:calendar] new event created:', entity.id);
  });

  eventBus.on('entity:updated', ({ entity }) => {
    if (entity.type !== 'calendar_event') return;
    console.log('[module:calendar] event updated:', entity.id);
  });

  eventBus.on('entity:deleted', ({ id, type }) => {
    if (type !== 'calendar_event') return;
    console.log('[module:calendar] event deleted:', id);
  });

  console.log('[module:calendar] initialised');
}
