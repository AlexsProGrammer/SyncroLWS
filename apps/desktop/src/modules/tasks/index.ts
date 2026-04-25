export { TasksView } from './TasksView';
export { KanbanCard, SortableKanbanCard } from './KanbanCard';
export { KanbanFilters, DEFAULT_FILTERS } from './KanbanFilters';
export type { KanbanTaskItem } from './KanbanCard';
export type { KanbanColumn } from './TasksView';
export type { KanbanFilterState } from './KanbanFilters';

/** Module init — no-op (subscriptions live in TasksView itself now). */
export function init(): void {
  console.log('[module:tasks] initialised');
}
