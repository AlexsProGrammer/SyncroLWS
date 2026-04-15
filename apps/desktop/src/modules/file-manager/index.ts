import { eventBus } from '@/core/events';

export { FileManagerView } from './FileManagerView';

/** Extract display title from a file attachment payload. */
export function getEntityTitle(payload: Record<string, unknown>): string {
  return (typeof payload['name'] === 'string' && payload['name']) || 'Untitled File';
}

/** Extract subtitle from a file attachment payload. */
export function getEntitySubtitle(payload: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  if (typeof payload['mime_type'] === 'string') parts.push(payload['mime_type']);
  if (typeof payload['size_bytes'] === 'number') {
    const kb = Math.round(payload['size_bytes'] / 1024);
    parts.push(kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`);
  }
  return parts.length ? parts.join(' · ') : undefined;
}

/**
 * File Manager module — registers event bus listeners.
 */
export function init(): void {
  eventBus.on('entity:created', ({ entity }) => {
    if (entity.type !== 'file_attachment') return;
    console.log('[module:file-manager] file attached:', entity.id);
  });

  eventBus.on('entity:deleted', ({ id, type }) => {
    if (type !== 'file_attachment') return;
    console.log('[module:file-manager] file removed:', id);
  });

  console.log('[module:file-manager] initialised');
}
