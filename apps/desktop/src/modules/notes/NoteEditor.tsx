import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Image from '@tiptap/extension-image';
import Typography from '@tiptap/extension-typography';
import { common, createLowlight } from 'lowlight';
import { WikiLink } from './WikiLinkExtension';
import { TagHighlight } from './TagExtension';
import { EditorToolbar } from './EditorToolbar';
import { eventBus } from '@/core/events';
import { getWorkspaceDB } from '@/core/db';
import type { NotePayload } from '@syncrohws/shared-types';
import { cn } from '@/lib/utils';

const lowlight = createLowlight(common);

interface NoteEditorProps {
  entityId: string;
  initialTitle?: string;
  initialContentMd?: string;
  initialContentJson?: string;
  className?: string;
  onTagClick?: (tag: string) => void;
}

const AUTOSAVE_DEBOUNCE_MS = 800;

export function NoteEditor({
  entityId,
  initialTitle = '',
  initialContentMd = '',
  initialContentJson = '',
  className,
  onTagClick,
}: NoteEditorProps): React.ReactElement {
  const titleRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceHtml, setSourceHtml] = useState('');

  // Determine initial content: prefer JSON, fall back to plain text
  let initialContent: string | object = '';
  if (initialContentJson) {
    try {
      initialContent = JSON.parse(initialContentJson) as object;
    } catch {
      initialContent = initialContentMd || '';
    }
  } else {
    initialContent = initialContentMd || '';
  }

  // ── TipTap editor instance ─────────────────────────────────────────────────
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Highlight,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      CodeBlockLowlight.configure({ lowlight }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Image,
      Typography,
      WikiLink.configure({
        onLinkClick(linkText) {
          void resolveAndOpenLink(linkText);
        },
      }),
      TagHighlight.configure({ onTagClick }),
    ],
    content: initialContent,
    onUpdate() {
      scheduleSave();
    },
  });

  // ── Autosave ───────────────────────────────────────────────────────────────

  const persistNote = useCallback(async (): Promise<void> => {
    if (!editor) return;
    const title = titleRef.current?.value ?? initialTitle;
    const content_md = editor.getText({ blockSeparator: '\n\n' });
    const content_json = JSON.stringify(editor.getJSON());
    const linked_entity_ids: string[] = [];

    // Extract #tags from text
    const tagMatches = [...content_md.matchAll(/#([a-zA-Z][\w-]*)/g)];
    const tags = [...new Set(tagMatches.map((m) => m[1]).filter((t): t is string => !!t))];

    const payload: NotePayload = { title, content_md, content_json, linked_entity_ids };

    try {
      const db = getWorkspaceDB();
      await db.execute(
        `UPDATE base_entities SET payload = ?, tags = ?, updated_at = ? WHERE id = ?`,
        [JSON.stringify(payload), JSON.stringify(tags), new Date().toISOString(), entityId],
      );
      eventBus.emit('entity:updated', {
        entity: {
          id: entityId,
          type: 'note',
          payload,
          metadata: {},
          tags,
          parent_id: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          deleted_at: null,
        },
      });
    } catch (err) {
      console.error('[NoteEditor] save failed:', err);
    }
  }, [editor, entityId, initialTitle]);

  const persistNoteRef = useRef(persistNote);
  persistNoteRef.current = persistNote;

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await persistNoteRef.current();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, []);

  // Save on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      void persistNote();
    };
  }, [persistNote]);

  // ── Source mode toggle ─────────────────────────────────────────────────────
  const toggleSourceMode = useCallback(() => {
    if (!editor) return;
    if (!sourceMode) {
      setSourceHtml(editor.getHTML());
      setSourceMode(true);
    } else {
      editor.commands.setContent(sourceHtml);
      setSourceMode(false);
    }
  }, [editor, sourceMode, sourceHtml]);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Title field */}
      <input
        ref={titleRef}
        defaultValue={initialTitle}
        placeholder="Untitled note"
        className="w-full border-0 bg-transparent text-2xl font-semibold text-foreground outline-none placeholder:text-muted-foreground px-1 mb-2 shrink-0"
        onChange={() => scheduleSave()}
      />

      {/* Formatting toolbar */}
      <EditorToolbar
        editor={editor}
        sourceMode={sourceMode}
        onToggleSource={toggleSourceMode}
      />

      {/* Editor content / source view */}
      {sourceMode ? (
        <textarea
          value={sourceHtml}
          onChange={(e) => setSourceHtml(e.target.value)}
          className="flex-1 min-h-0 rounded-md border border-border bg-muted/50 p-3 font-mono text-sm text-foreground outline-none resize-none overflow-y-auto"
          spellCheck={false}
        />
      ) : (
        <EditorContent
          editor={editor}
          className="note-editor-content prose prose-sm dark:prose-invert max-w-none flex-1 min-h-0 cursor-text rounded-md p-1 outline-none overflow-y-auto"
        />
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function resolveAndOpenLink(linkText: string): Promise<void> {
  try {
    const db = getWorkspaceDB();
    const rows = await db.select<{ id: string; type: string }[]>(
      `SELECT id, type FROM base_entities
       WHERE json_extract(payload, '$.title') = ? AND deleted_at IS NULL LIMIT 1`,
      [linkText],
    );
    if (rows[0]) {
      eventBus.emit('nav:open-entity', { id: rows[0].id, type: rows[0].type as 'note' });
    }
  } catch (err) {
    console.error('[NoteEditor] link resolution failed:', err);
  }
}
