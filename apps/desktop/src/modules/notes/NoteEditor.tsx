import React, { useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { WikiLink } from './WikiLinkExtension';
import { eventBus } from '@/core/events';
import { getDB } from '@/core/db';
import type { NotePayload } from '@syncrohws/shared-types';
import { cn } from '@/lib/utils';

interface NoteEditorProps {
  /** UUID of the base_entity row being edited */
  entityId: string;
  initialTitle?: string;
  initialContentMd?: string;
  className?: string;
}

const AUTOSAVE_DEBOUNCE_MS = 800;

/**
 * Full-featured Markdown note editor backed by TipTap.
 *
 * Persistence contract:
 *   - Content is stored as raw Markdown string in `payload.content_md`
 *   - On every keystroke (debounced) the entity row is updated via raw SQL
 *   - FTS5 virtual table is kept in sync via the UPDATE trigger defined in db.ts
 *   - [[wikilink]] syntax is highlighted; clicking one emits `nav:open-entity`
 */
export function NoteEditor({
  entityId,
  initialTitle = '',
  initialContentMd = '',
  className,
}: NoteEditorProps): React.ReactElement {
  const titleRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── TipTap editor instance ─────────────────────────────────────────────────
  const editor = useEditor({
    extensions: [
      StarterKit,
      Highlight,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
      WikiLink.configure({
        onLinkClick(linkText) {
          // Fire the event bus so other modules / routing can react
          void resolveAndOpenLink(linkText);
        },
      }),
    ],
    content: initialContentMd,
    onUpdate({ editor: ed }) {
      scheduleSave(ed.getText({ blockSeparator: '\n\n' }), ed.storage);
    },
  });

  // ── Autosave ───────────────────────────────────────────────────────────────
  const scheduleSave = useCallback(
    (_text: string, _storage: unknown) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        await persistNote();
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entityId],
  );

  const persistNote = useCallback(async (): Promise<void> => {
    if (!editor) return;
    const title = titleRef.current?.value ?? initialTitle;
    const content_md: string = editor.getText({ blockSeparator: '\n\n' });

    // Extract [[links]] for bi-directional index (resolved in notes/index.ts via event)
    const linked_entity_ids: string[] = [];

    const payload: NotePayload = { title, content_md, linked_entity_ids };

    try {
      const db = getDB();
      await db.execute(
        `UPDATE base_entities SET payload = ?, updated_at = ? WHERE id = ?`,
        [JSON.stringify(payload), new Date().toISOString(), entityId],
      );
      // Notify other modules that content changed
      eventBus.emit('entity:updated', {
        entity: {
          id: entityId,
          type: 'note',
          payload,
          metadata: {},
          tags: [],
          parent_id: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          deleted_at: null,
        },
      });
      console.log('[NoteEditor] saved:', entityId);
    } catch (err) {
      console.error('[NoteEditor] save failed:', err);
    }
  }, [editor, entityId, initialTitle]);

  // Save on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      void persistNote();
    };
  }, [persistNote]);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {/* Title field */}
      <input
        ref={titleRef}
        defaultValue={initialTitle}
        placeholder="Untitled note"
        className="w-full border-0 bg-transparent text-2xl font-semibold text-foreground outline-none placeholder:text-muted-foreground"
        onChange={() => scheduleSave('', null)}
      />

      {/* TipTap content area */}
      <EditorContent
        editor={editor}
        className={cn(
          'prose prose-sm dark:prose-invert max-w-none flex-1 cursor-text rounded-md p-1 outline-none',
          // wiki-link decoration styles (injected via TipTap decorator class)
          '[&_.wiki-link]:cursor-pointer [&_.wiki-link]:rounded [&_.wiki-link]:bg-primary/10 [&_.wiki-link]:px-1 [&_.wiki-link]:text-primary [&_.wiki-link]:underline-offset-2 hover:[&_.wiki-link]:underline',
        )}
      />
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function resolveAndOpenLink(linkText: string): Promise<void> {
  try {
    const db = getDB();
    const rows = await db.select<{ id: string; type: string }[]>(
      `SELECT id, type FROM base_entities
       WHERE json_extract(payload, '$.title') = ? AND deleted_at IS NULL LIMIT 1`,
      [linkText],
    );
    if (rows[0]) {
      eventBus.emit('nav:open-entity', { id: rows[0].id, type: rows[0].type as 'note' });
    } else {
      console.warn('[NoteEditor] [[' + linkText + ']] — no matching entity found');
    }
  } catch (err) {
    console.error('[NoteEditor] link resolution failed:', err);
  }
}
