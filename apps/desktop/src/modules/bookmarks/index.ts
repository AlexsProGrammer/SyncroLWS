import { eventBus } from '@/core/events';

export { BookmarksView } from './BookmarksView';

/** Extract display title from a bookmark payload. */
export function getEntityTitle(payload: Record<string, unknown>): string {
  return (typeof payload['title'] === 'string' && payload['title'])
    || (typeof payload['url'] === 'string' ? payload['url'] : 'Untitled Bookmark');
}

/** Extract subtitle from a bookmark payload (URL domain). */
export function getEntitySubtitle(payload: Record<string, unknown>): string | undefined {
  if (typeof payload['url'] !== 'string') return undefined;
  try {
    return new URL(payload['url']).hostname;
  } catch {
    return payload['url'];
  }
}

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
