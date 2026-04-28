import type { HybridEntity } from '@syncrohws/shared-types';

export { BookmarksView } from './BookmarksView';

function bookmarkData(entity: HybridEntity): Record<string, unknown> {
  return (entity.aspects.find((a) => a.aspect_type === 'bookmark')?.data ?? {}) as Record<string, unknown>;
}

/** Extract display title from a bookmark hybrid entity. */
export function getEntityTitle(entity: HybridEntity): string {
  if (entity.core.title) return entity.core.title;
  const data = bookmarkData(entity);
  return (typeof data['url'] === 'string' ? data['url'] : 'Untitled Bookmark');
}

/** Extract subtitle from a bookmark hybrid entity (URL domain). */
export function getEntitySubtitle(entity: HybridEntity): string | undefined {
  const data = bookmarkData(entity);
  if (typeof data['url'] !== 'string') return undefined;
  try {
    return new URL(data['url']).hostname;
  } catch {
    return data['url'];
  }
}

/**
 * Bookmarks module — event bus hooks.
 */
export function init(): void {
  console.log('[module:bookmarks] initialised');
}
