import { eventBus } from '@/core/events';
import type { TaskPayload } from '@syncrohws/shared-types';

export { TasksView } from './TasksView';
export { KanbanCard, SortableKanbanCard } from './KanbanCard';
export { TaskDetailPanel } from './TaskDetailPanel';
export { KanbanFilters, DEFAULT_FILTERS } from './KanbanFilters';
export type { KanbanTaskItem } from './KanbanCard';
export type { KanbanColumn } from './TasksView';
export type { KanbanFilterState } from './KanbanFilters';

/**
 * Tasks module — registers all Event Bus listeners.
 * Call init() once at app startup.
 */
export function init(): void {
  // When a calendar event is created from a task due date
  eventBus.on('entity:created', ({ entity }) => {
    if (entity.type !== 'task') return;
    const payload = entity.payload as Partial<TaskPayload>;

    if (payload.due_date) {
      // Emit a calendar event creation request
      eventBus.emit('notification:show', {
        title: 'Task scheduled',
        body: `"${payload.title ?? entity.id.slice(0, 8)}" is due on ${new Date(payload.due_date).toLocaleDateString()}.`,
        type: 'info',
      });
    }
  });

  // Sync conflicts for tasks
  eventBus.on('sync:conflict', (event) => {
    if (event.local.type !== 'task') return;
    eventBus.emit('notification:show', {
      title: 'Task conflict detected',
      body: 'A task was modified on two devices. Please resolve the conflict.',
      type: 'warning',
    });
  });

  console.log('[module:tasks] initialised');
}
