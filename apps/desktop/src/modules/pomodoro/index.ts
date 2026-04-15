import { eventBus } from '@/core/events';

export { PomodoroView } from './PomodoroView';

/** Extract display title from a pomodoro session payload. */
export function getEntityTitle(payload: Record<string, unknown>): string {
  return (typeof payload['label'] === 'string' && payload['label']) || 'Pomodoro Session';
}

/** Extract subtitle from a pomodoro session payload. */
export function getEntitySubtitle(payload: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  if (typeof payload['phase'] === 'string') parts.push(payload['phase'].replace('_', ' '));
  if (typeof payload['completed_sessions'] === 'number') {
    parts.push(`${payload['completed_sessions']} sessions`);
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
