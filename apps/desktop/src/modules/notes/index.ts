import { eventBus } from '@/core/events';
import { getWorkspaceDB } from '@/core/db';
import type { BaseEntity, NotePayload } from '@syncrohws/shared-types';

export { NoteEditor } from './NoteEditor';
export { NotesView } from './NotesView';
export { WikiLink } from './WikiLinkExtension';
export { TagHighlight } from './TagExtension';
export { BacklinksPanel } from './BacklinksPanel';
export { EditorToolbar } from './EditorToolbar';

/** Extract display title from a note payload. */
export function getEntityTitle(payload: Record<string, unknown>): string {
  return (typeof payload['title'] === 'string' && payload['title']) || 'Untitled Note';
}

/** Extract subtitle from a note payload (first ~80 chars of content). */
export function getEntitySubtitle(payload: Record<string, unknown>): string | undefined {
  const md = typeof payload['content_md'] === 'string' ? payload['content_md'] : '';
  if (!md) return undefined;
  const plain = md.replace(/[#*_~`>\[\]()!|]/g, '').trim();
  return plain.length > 80 ? plain.slice(0, 80) + '…' : plain || undefined;
}

/**
 * Notes module — registers all Event Bus listeners.
 * Call init() once at app startup.
 */
export function init(): void {
  // Handle sync conflicts for note entities
  eventBus.on('sync:conflict', (event) => {
    if (event.local.type !== 'note') return;
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
 * Parses [[Name]] wiki-link syntax from the note's content
 * and persists the linked entity IDs back into the payload.
 * Reads current payload from DB and merges to preserve content_json.
 */
async function updateBiDirectionalLinks(entity: BaseEntity): Promise<void> {
  const payload = entity.payload as Partial<NotePayload>;
  const content = payload.content_md ?? '';
  const matches = [...content.matchAll(/\[\[([^\]]+)]]/g)].map((m) => m[1]).filter(Boolean);

  if (!matches.length) return;

  try {
    const db = getWorkspaceDB();
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

    // Read current payload from DB to preserve all fields (including content_json)
    const currentRows = await db.select<{ payload: string }[]>(
      `SELECT payload FROM base_entities WHERE id = ? LIMIT 1`,
      [entity.id],
    );
    if (!currentRows[0]) return;

    const currentPayload = JSON.parse(currentRows[0].payload) as Record<string, unknown>;
    currentPayload.linked_entity_ids = [...new Set(linked)];

    await db.execute(
      `UPDATE base_entities SET payload = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(currentPayload), new Date().toISOString(), entity.id],
    );
  } catch (err) {
    console.error('[module:notes] bi-directional link update failed:', err);
  }
}
