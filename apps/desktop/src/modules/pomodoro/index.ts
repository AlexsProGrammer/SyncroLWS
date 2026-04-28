import { eventBus } from '@/core/events';
import type { HybridEntity } from '@syncrohws/shared-types';

export { PomodoroView } from './PomodoroView';

function pomodoroData(entity: HybridEntity): Record<string, unknown> {
  return (entity.aspects.find((a) => a.aspect_type === 'pomodoro_session')?.data ?? {}) as Record<string, unknown>;
}

/** Extract display title from a pomodoro hybrid entity. */
export function getEntityTitle(entity: HybridEntity): string {
  if (entity.core.title) return entity.core.title;
  const data = pomodoroData(entity);
  return (typeof data['label'] === 'string' && data['label']) || 'Pomodoro Session';
}

/** Extract subtitle from a pomodoro hybrid entity. */
export function getEntitySubtitle(entity: HybridEntity): string | undefined {
  const data = pomodoroData(entity);
  const parts: string[] = [];
  if (typeof data['phase'] === 'string') parts.push(data['phase'].replace('_', ' '));
  if (typeof data['completed_sessions'] === 'number') {
    parts.push(`${data['completed_sessions']} sessions`);
  }
  return parts.length ? parts.join(' · ') : undefined;
}

/**
 * Pomodoro module — listens for pomodoro events and triggers notifications.
 */
export function init(): void {
  eventBus.on('pomodoro:completed', ({ phase, label }) => {
    const msg =
      phase === 'focus'
        ? `Focus session complete! Time for a break.${label ? ` (${label})` : ''}`
        : `Break is over — time to focus!`;

    eventBus.emit('notification:show', { title: 'Focus Timer', body: msg, type: 'info' });
  });

  console.log('[module:pomodoro] initialised');
}
