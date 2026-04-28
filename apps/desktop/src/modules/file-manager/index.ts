import { eventBus } from '@/core/events';
import type { HybridEntity } from '@syncrohws/shared-types';

export { FileManagerView } from './FileManagerView';

function fileData(entity: HybridEntity): Record<string, unknown> {
  return (entity.aspects.find((a) => a.aspect_type === 'file_attachment')?.data ?? {}) as Record<string, unknown>;
}

/** Extract display title from a file attachment hybrid entity. */
export function getEntityTitle(entity: HybridEntity): string {
  if (entity.core.title) return entity.core.title;
  const data = fileData(entity);
  return (typeof data['name'] === 'string' && data['name']) || 'Untitled File';
}

/** Extract subtitle from a file attachment hybrid entity. */
export function getEntitySubtitle(entity: HybridEntity): string | undefined {
  const data = fileData(entity);
  const parts: string[] = [];
  if (typeof data['mime_type'] === 'string') parts.push(data['mime_type']);
  if (typeof data['size_bytes'] === 'number') {
    const kb = Math.round(data['size_bytes'] / 1024);
    parts.push(kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`);
  }
  return parts.length ? parts.join(' · ') : undefined;
}

/**
 * File Manager module — registers event bus listeners.
 */
export function init(): void {
  eventBus.on('aspect:added', ({ aspect }) => {
    if (aspect.aspect_type !== 'file_attachment') return;
    console.log('[module:file-manager] file attached:', aspect.entity_id);
  });

  eventBus.on('aspect:removed', ({ entity_id, aspect_type }) => {
    if (aspect_type !== 'file_attachment') return;
    console.log('[module:file-manager] file aspect removed:', entity_id);
  });

  console.log('[module:file-manager] initialised');
}
