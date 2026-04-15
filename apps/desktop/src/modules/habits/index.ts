import { eventBus } from '@/core/events';

export { HabitsView } from './HabitsView';

/** Extract display title from a habit payload. */
export function getEntityTitle(payload: Record<string, unknown>): string {
  return (typeof payload['name'] === 'string' && payload['name']) || 'Untitled Habit';
}

/** Extract subtitle from a habit payload (frequency + streak). */
export function getEntitySubtitle(payload: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  if (typeof payload['frequency'] === 'string') parts.push(payload['frequency']);
  if (typeof payload['completions'] === 'object' && payload['completions']) {
    const count = Object.keys(payload['completions'] as object).length;
    if (count > 0) parts.push(`${count} completions`);
  }
  return parts.length ? parts.join(' · ') : undefined;
}

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
