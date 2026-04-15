import { eventBus } from '@/core/events';

export { BookmarksView } from './BookmarksView';

/**
 * Bookmarks module — event bus hooks.
 */
export function init(): void {
  eventBus.on('entity:created', ({ entity }) => {
    if (entity.type !== 'bookmark') return;
    console.log('[module:bookmarks] bookmark created:', entity.id);
  });

  console.log('[module:bookmarks] initialised');
}
