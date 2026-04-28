import type { HybridEntity } from '@syncrohws/shared-types';

export { HabitsView } from './HabitsView';

function habitData(entity: HybridEntity): Record<string, unknown> {
  return (entity.aspects.find((a) => a.aspect_type === 'habit')?.data ?? {}) as Record<string, unknown>;
}

/** Extract display title from a habit hybrid entity. */
export function getEntityTitle(entity: HybridEntity): string {
  return entity.core.title || 'Untitled Habit';
}

/** Extract subtitle from a habit hybrid entity (frequency + streak). */
export function getEntitySubtitle(entity: HybridEntity): string | undefined {
  const data = habitData(entity);
  const parts: string[] = [];
  if (typeof data['frequency'] === 'string') parts.push(data['frequency']);
  if (typeof data['completions'] === 'object' && data['completions']) {
    const count = Object.keys(data['completions'] as object).length;
    if (count > 0) parts.push(`${count} completions`);
  }
  return parts.length ? parts.join(' · ') : undefined;
}

/**
 * Habits module — event bus hooks.
 */
export function init(): void {
  console.log('[module:habits] initialised');
}
