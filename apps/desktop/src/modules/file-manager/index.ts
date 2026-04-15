import { eventBus } from '@/core/events';

export { FileManagerView } from './FileManagerView';

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
