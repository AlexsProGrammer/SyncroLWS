import { eventBus } from '@/core/events';

export { PomodoroView } from './PomodoroView';

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
