import { eventBus } from '@/core/events';
import { reconcileWikiLinks } from '@/core/entityStore';
import type { HybridEntity, NoteAspectData } from '@syncrohws/shared-types';

export { NotesView } from './NotesView';
export { WikiLink } from './WikiLinkExtension';
export { TagHighlight } from './TagExtension';
export { AspectEditor } from './AspectEditor';

function noteData(entity: HybridEntity): Partial<NoteAspectData> {
  return (entity.aspects.find((a) => a.aspect_type === 'note')?.data ?? {}) as Partial<NoteAspectData>;
}

/** Extract display title from a note hybrid entity. */
export function getEntityTitle(entity: HybridEntity): string {
  return entity.core.title || 'Untitled Note';
}

/** Extract subtitle from a note hybrid entity (first ~80 chars of content). */
export function getEntitySubtitle(entity: HybridEntity): string | undefined {
  if (entity.core.description) {
    const d = entity.core.description.trim();
    return d.length > 80 ? d.slice(0, 80) + '…' : d;
  }
  const data = noteData(entity);
  const md = typeof data.content_md === 'string' ? data.content_md : '';
  if (!md) return undefined;
  const plain = md.replace(/[#*_~`>\[\]()!|]/g, '').trim();
  return plain.length > 80 ? plain.slice(0, 80) + '…' : plain || undefined;
}

/**
 * Notes module — registers Event Bus listeners.
 *
 * Wiki-link reconciliation: when a `note` aspect is added or updated, parse
 * its `content_md` for `[[Name]]` references and reconcile the entity's
 * outgoing `wiki_link` relations via `reconcileWikiLinks` (which targets
 * the new `entity_relations` table — no SQL on legacy `payload`).
 */
export function init(): void {
  const onNoteAspect = ({ aspect }: { aspect: { aspect_type: string; entity_id: string; data: Record<string, unknown> } }): void => {
    if (aspect.aspect_type !== 'note') return;
    const md = typeof aspect.data['content_md'] === 'string' ? (aspect.data['content_md'] as string) : '';
    void reconcileWikiLinks(aspect.entity_id, md).catch((err) => {
      console.error('[module:notes] wiki-link reconcile failed:', err);
    });
  };

  eventBus.on('aspect:added', onNoteAspect);
  eventBus.on('aspect:updated', onNoteAspect);

  console.log('[module:notes] initialised');
}
