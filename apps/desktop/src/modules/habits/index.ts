import { eventBus } from '@/core/events';

export { HabitsView } from './HabitsView';

/**
 * Habits module — event bus hooks.
 */
export function init(): void {
  eventBus.on('entity:created', ({ entity }) => {
    if (entity.type !== 'habit') return;
    console.log('[module:habits] habit created:', entity.id);
  });

  console.log('[module:habits] initialised');
}
