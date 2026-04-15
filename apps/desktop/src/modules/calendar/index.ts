import { eventBus } from '@/core/events';

export { CalendarView } from './CalendarView';
export { EventDetailModal } from './EventDetailModal';
export type { CalendarEventItem } from './EventDetailModal';

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
