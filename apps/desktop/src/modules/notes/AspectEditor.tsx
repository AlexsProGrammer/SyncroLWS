import * as React from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Typography from '@tiptap/extension-typography';
import { WikiLink } from './WikiLinkExtension';
import { TagHighlight } from './TagExtension';
import type { AspectEditorProps } from '@/registry/ToolRegistry';
import type { NoteAspectData } from '@syncrohws/shared-types';
import { Button } from '@/ui/components/button';
import { eventBus } from '@/core/events';
import { getEntity } from '@/core/entityStore';

const AUTOSAVE_DEBOUNCE_MS = 600;

export function AspectEditor({ aspect, onChange, onRemove }: AspectEditorProps): React.ReactElement {
  const data = aspect.data as Partial<NoteAspectData>;
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Compute initial content once per aspect mount.
  const initialContent = React.useMemo<string | object>(() => {
    if (data.content_json) {
      try {
        return JSON.parse(data.content_json) as object;
      } catch {
        /* fall through */
      }
    }
    return data.content_md ?? '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspect.id]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Highlight,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Typography,
      WikiLink.configure({
        onLinkClick(linkText) {
          void resolveAndOpenLink(linkText);
        },
      }),
      TagHighlight,
    ],
    content: initialContent,
    onUpdate({ editor: ed }) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        onChange({
          content_md: ed.getText({ blockSeparator: '\n\n' }),
          content_json: JSON.stringify(ed.getJSON()),
        });
      }, AUTOSAVE_DEBOUNCE_MS);
    },
  });

  // Flush on unmount.
  React.useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (editor && !editor.isDestroyed) {
        onChange({
          content_md: editor.getText({ blockSeparator: '\n\n' }),
          content_json: JSON.stringify(editor.getJSON()),
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  return (
    <div className="flex h-full flex-col">
      <div
        className="note-editor-content prose prose-sm dark:prose-invert max-w-none flex-1 min-h-[240px] cursor-text rounded-md p-2 outline-none overflow-y-auto"
        onClick={(e) => {
          if (editor && e.target === e.currentTarget) {
            editor.commands.focus('end');
          }
        }}
      >
        <EditorContent editor={editor} />
      </div>

      <div className="border-t border-border px-2 py-2">
        <Button variant="destructive" size="sm" onClick={onRemove}>
          Remove note aspect
        </Button>
      </div>
    </div>
  );
}

async function resolveAndOpenLink(linkText: string): Promise<void> {
  // Phase E will move this into a relations-aware resolver. For now, resolve
  // by core.title equality through the entityStore.
  try {
    const { getWorkspaceDB } = await import('@/core/db');
    const db = getWorkspaceDB();
    const rows = await db.select<{ id: string }[]>(
      `SELECT id FROM base_entities WHERE title = ? AND deleted_at IS NULL LIMIT 1`,
      [linkText],
    );
    if (rows[0]) {
      // If hydratable, open the universal sheet on the Note tab.
      const hybrid = await getEntity(rows[0].id);
      if (hybrid) {
        eventBus.emit('nav:open-detail-sheet', { id: hybrid.core.id, initialAspectType: 'note' });
      }
    }
  } catch (err) {
    console.error('[notes/AspectEditor] link resolution failed:', err);
  }
}
