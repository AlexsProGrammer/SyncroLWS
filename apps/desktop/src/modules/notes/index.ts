import { eventBus } from '@/core/events';
import { getDB } from '@/core/db';
import type { BaseEntity, NotePayload } from '@syncrohws/shared-types';

export { NoteEditor } from './NoteEditor';
export { NotesView } from './NotesView';
export { WikiLink } from './WikiLinkExtension';

/**
 * Notes module — registers all Event Bus listeners.
 * Call init() once at app startup.
 */
export function init(): void {
  // Handle sync conflicts for note entities
  eventBus.on('sync:conflict', (event) => {
    if (event.local.type !== 'note') return;
    // Conflict resolution is handled by DiffEditor in the UI layer.
    // This listener triggers the notification that a conflict exists.
    eventBus.emit('notification:show', {
      title: 'Notes conflict detected',
      body: `Note "${getNoteTitle(event.local)}" was modified on two devices.`,
      type: 'warning',
    });
  });

  // When a new entity is created, index it for bi-directional links if it's a note
  eventBus.on('entity:created', async ({ entity }) => {
    if (entity.type !== 'note') return;
    await updateBiDirectionalLinks(entity);
  });

  eventBus.on('entity:updated', async ({ entity }) => {
    if (entity.type !== 'note') return;
    await updateBiDirectionalLinks(entity);
  });

  console.log('[module:notes] initialised');
}

function getNoteTitle(entity: BaseEntity): string {
  const payload = entity.payload as Partial<NotePayload>;
  return payload.title ?? entity.id.slice(0, 8);
}

/**
 * Parses [[Name]] wiki-link syntax from the note's Markdown content
 * and persists the linked entity IDs back into the payload.
 */
async function updateBiDirectionalLinks(entity: BaseEntity): Promise<void> {
  const payload = entity.payload as Partial<NotePayload>;
  const content = payload.content_md ?? '';
  const matches = [...content.matchAll(/\[\[([^\]]+)]]/g)].map((m) => m[1]).filter(Boolean);

  if (!matches.length) return;

  try {
    const db = getDB();
    // Look up entity IDs whose payload title matches the link text
    const linked: string[] = [];
    for (const name of matches) {
      const rows = await db.select<{ id: string }[]>(
        `SELECT id FROM base_entities WHERE json_extract(payload, '$.title') = ? AND deleted_at IS NULL LIMIT 1`,
        [name],
      );
      if (rows[0]) linked.push(rows[0].id);
    }

    if (!linked.length) return;

    const updated: NotePayload = {
      title: payload.title ?? '',
      content_md: content,
      linked_entity_ids: [...new Set(linked)],
    };

    await db.execute(
      `UPDATE base_entities SET payload = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(updated), new Date().toISOString(), entity.id],
    );
  } catch (err) {
    console.error('[module:notes] bi-directional link update failed:', err);
  }
}
