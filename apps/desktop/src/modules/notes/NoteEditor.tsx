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
import { convertFileSrc } from '@tauri-apps/api/core';
import { WikiLink } from './WikiLinkExtension';
import { TagHighlight } from './TagExtension';
import { EditorToolbar } from './EditorToolbar';
import { eventBus } from '@/core/events';
import { getWorkspaceDB } from '@/core/db';
import type { NotePayload } from '@syncrohws/shared-types';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/dialog';
import { Input } from '@/ui/components/input';
import { Button } from '@/ui/components/button';

const lowlight = createLowlight(common);

// ── Image Picker Dialog ───────────────────────────────────────────────────────

interface WorkspaceImage {
  hash: string;
  local_path: string;
  name: string;
  size_bytes: number;
}

function ImagePickerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (src: string) => void;
}): React.ReactElement {
  const [images, setImages] = useState<WorkspaceImage[]>([]);
  const [urlInput, setUrlInput] = useState('');

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const db = getWorkspaceDB();
        const rows = await db.select<{
          hash: string;
          local_path: string;
          payload: string;
          size_bytes: number;
        }[]>(
          `SELECT lf.hash, lf.local_path, lf.size_bytes, be.payload
           FROM local_files lf
           JOIN base_entities be ON json_extract(be.payload, '$.hash') = lf.hash
           WHERE be.type = 'file_attachment'
             AND lf.mime_type LIKE 'image/%'
             AND be.deleted_at IS NULL
           ORDER BY lf.created_at DESC`,
        );
        setImages(
          rows.map((r) => {
            const p = JSON.parse(r.payload) as { name?: string };
            return {
              hash: r.hash,
              local_path: r.local_path,
              name: p.name || 'Untitled',
              size_bytes: r.size_bytes,
            };
          }),
        );
      } catch {
        setImages([]);
      }
    })();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Insert Image</DialogTitle>
        </DialogHeader>

        {/* URL input */}
        <div className="flex gap-2 mt-1">
          <Input
            placeholder="Paste image URL…"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            className="h-8 text-sm flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && urlInput.trim()) {
                onSelect(urlInput.trim());
                onOpenChange(false);
                setUrlInput('');
              }
            }}
          />
          <Button
            size="sm"
            className="h-8"
            disabled={!urlInput.trim()}
            onClick={() => {
              onSelect(urlInput.trim());
              onOpenChange(false);
              setUrlInput('');
            }}
          >
            Insert
          </Button>
        </div>

        {/* Workspace images */}
        {images.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground mt-2">Or pick from workspace files:</p>
            <div className="grid grid-cols-3 gap-2 overflow-y-auto flex-1 min-h-0 mt-1">
              {images.map((img) => (
                <button
                  key={img.hash}
                  type="button"
                  className="group flex flex-col items-center gap-1 rounded-lg border border-border p-2 hover:border-primary/50 transition-colors cursor-pointer"
                  onClick={() => {
                    onSelect(convertFileSrc(img.local_path));
                    onOpenChange(false);
                  }}
                >
                  <img
                    src={convertFileSrc(img.local_path)}
                    alt={img.name}
                    className="h-16 w-full rounded object-cover"
                    loading="lazy"
                  />
                  <span className="w-full truncate text-[10px] text-muted-foreground text-center">
                    {img.name}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {images.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No images in workspace — upload files via the File Manager or paste a URL above.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── NoteEditor ────────────────────────────────────────────────────────────────

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
  const [showImagePicker, setShowImagePicker] = useState(false);

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

  const handleInsertImage = useCallback(
    (src: string) => {
      if (editor) {
        editor.chain().focus().setImage({ src }).run();
        scheduleSave();
      }
    },
    [editor, scheduleSave],
  );

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
        onInsertImage={() => setShowImagePicker(true)}
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

      {/* Image picker dialog */}
      <ImagePickerDialog
        open={showImagePicker}
        onOpenChange={setShowImagePicker}
        onSelect={handleInsertImage}
      />
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
