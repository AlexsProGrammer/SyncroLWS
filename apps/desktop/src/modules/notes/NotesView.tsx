import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { NoteEditor } from './NoteEditor';
import { BacklinksPanel } from './BacklinksPanel';
import { NOTE_TEMPLATES, type NoteTemplate } from './templates';
import { getWorkspaceDB } from '@/core/db';
import { eventBus } from '@/core/events';
import { Button } from '@/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/components/dropdown-menu';
import { cn } from '@/lib/utils';
import type { NotePayload } from '@syncrohws/shared-types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface NoteListItem {
  id: string;
  title: string;
  preview: string;
  updated_at: string;
  tags: string[];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NotesView(): React.ReactElement {
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [activeNoteData, setActiveNoteData] = useState<{
    title: string;
    content_md: string;
    content_json: string;
  } | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // Derived state
  const allTags = useMemo(
    () => [...new Set(notes.flatMap((n) => n.tags))].sort(),
    [notes],
  );
  const filteredNotes = useMemo(
    () => (activeTag ? notes.filter((n) => n.tags.includes(activeTag)) : notes),
    [notes, activeTag],
  );

  // ── Load notes list ───────────────────────────────────────────────────────
  const loadNotes = useCallback(async () => {
    try {
      const db = getWorkspaceDB();
      const rows = await db.select<
        { id: string; payload: string; tags: string; updated_at: string }[]
      >(
        `SELECT id, payload, tags, updated_at FROM base_entities
         WHERE type = 'note' AND deleted_at IS NULL
         ORDER BY updated_at DESC`,
      );
      const items: NoteListItem[] = rows.map((r) => {
        const p = JSON.parse(r.payload) as Partial<NotePayload>;
        let parsedTags: string[] = [];
        try {
          parsedTags = JSON.parse(r.tags) as string[];
        } catch {
          /* empty */
        }
        return {
          id: r.id,
          title: p.title || 'Untitled',
          preview: (p.content_md ?? '').slice(0, 120),
          updated_at: r.updated_at,
          tags: Array.isArray(parsedTags) ? parsedTags : [],
        };
      });
      setNotes(items);
    } catch (err) {
      console.error('[notes] load failed:', err);
    }
  }, []);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  // Reload on entity events
  useEffect(() => {
    const onUpdate = (): void => {
      void loadNotes();
    };
    eventBus.on('entity:created', onUpdate);
    eventBus.on('entity:updated', onUpdate);
    eventBus.on('entity:deleted', onUpdate);
    return () => {
      eventBus.off('entity:created', onUpdate);
      eventBus.off('entity:updated', onUpdate);
      eventBus.off('entity:deleted', onUpdate);
    };
  }, [loadNotes]);

  // Handle nav:open-entity for notes
  useEffect(() => {
    const handler = ({ id, type }: { id: string; type: string }): void => {
      if (type === 'note') void openNote(id);
    };
    eventBus.on('nav:open-entity', handler);
    return () => {
      eventBus.off('nav:open-entity', handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Open a note ───────────────────────────────────────────────────────────
  const openNote = useCallback(async (noteId: string) => {
    try {
      const db = getWorkspaceDB();
      const rows = await db.select<{ payload: string }[]>(
        `SELECT payload FROM base_entities WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
        [noteId],
      );
      if (!rows[0]) return;
      const p = JSON.parse(rows[0].payload) as Partial<NotePayload>;
      setActiveNoteId(noteId);
      setActiveNoteData({
        title: p.title ?? '',
        content_md: p.content_md ?? '',
        content_json: p.content_json ?? '',
      });
    } catch (err) {
      console.error('[notes] open failed:', err);
    }
  }, []);

  // ── Create note (optionally from template) ────────────────────────────────
  const createNote = useCallback(async (template?: NoteTemplate) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const title = template ? template.getTitle() : '';
    const content = template ? template.getContent() : null;
    const content_json = content ? JSON.stringify(content) : '';

    const payload: NotePayload = {
      title,
      content_md: '',
      content_json,
      linked_entity_ids: [],
    };

    try {
      const db = getWorkspaceDB();
      await db.execute(
        `INSERT INTO base_entities (id, type, payload, metadata, tags, parent_id, created_at, updated_at)
         VALUES (?, 'note', ?, '{}', '[]', NULL, ?, ?)`,
        [id, JSON.stringify(payload), now, now],
      );

      eventBus.emit('entity:created', {
        entity: {
          id,
          type: 'note',
          payload,
          metadata: {},
          tags: [],
          parent_id: null,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        },
      });

      setActiveNoteId(id);
      setActiveNoteData({ title, content_md: '', content_json });
    } catch (err) {
      console.error('[notes] create failed:', err);
    }
  }, []);

  // ── Delete note ───────────────────────────────────────────────────────────
  const deleteNote = useCallback(
    async (noteId: string) => {
      try {
        const db = getWorkspaceDB();
        await db.execute(
          `UPDATE base_entities SET deleted_at = ? WHERE id = ?`,
          [new Date().toISOString(), noteId],
        );
        if (activeNoteId === noteId) {
          setActiveNoteId(null);
          setActiveNoteData(null);
        }
        setNotes((prev) => prev.filter((n) => n.id !== noteId));
        eventBus.emit('entity:deleted', { id: noteId, type: 'note' });
      } catch (err) {
        console.error('[notes] delete failed:', err);
      }
    },
    [activeNoteId],
  );

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ── Sidebar: note list ──────────────────────────────────────── */}
      <div className="flex w-64 flex-col border-r border-border bg-card/50">
        <div className="flex items-center justify-between border-b border-border p-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Notes
          </span>
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" title="New from template">
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M9 3v18M3 9h6" />
                  </svg>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {NOTE_TEMPLATES.map((t) => (
                  <DropdownMenuItem
                    key={t.id}
                    onClick={() => void createNote(t)}
                  >
                    {t.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="sm" onClick={() => void createNote()}>
              + New
            </Button>
          </div>
        </div>

        {/* Tag filter */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors',
                  activeTag === tag
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent',
                )}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}

        {/* Note list */}
        <div className="flex-1 overflow-y-auto">
          {filteredNotes.map((note) => (
            <button
              key={note.id}
              onClick={() => void openNote(note.id)}
              className={cn(
                'group flex w-full flex-col gap-0.5 border-b border-border/50 px-3 py-2.5 text-left transition-colors hover:bg-accent/50',
                activeNoteId === note.id && 'bg-accent',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="truncate text-sm font-medium text-foreground">
                  {note.title || 'Untitled'}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteNote(note.id);
                  }}
                  className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity"
                  title="Delete note"
                >
                  <svg
                    className="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <span className="truncate text-xs text-muted-foreground">
                {note.preview || 'Empty note'}
              </span>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground/60">
                  {new Date(note.updated_at).toLocaleDateString()}
                </span>
                {note.tags.length > 0 && (
                  <span className="text-[10px] text-primary/70">
                    {note.tags.map((t) => `#${t}`).join(' ')}
                  </span>
                )}
              </div>
            </button>
          ))}
          {filteredNotes.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <p>{activeTag ? `No notes with #${activeTag}` : 'No notes yet'}</p>
              {!activeTag && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void createNote()}
                >
                  Create your first note
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Editor pane ──────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {activeNoteId && activeNoteData ? (
          <NoteEditor
            key={activeNoteId}
            entityId={activeNoteId}
            initialTitle={activeNoteData.title}
            initialContentMd={activeNoteData.content_md}
            initialContentJson={activeNoteData.content_json}
            onTagClick={(tag) => setActiveTag(tag)}
            className="flex-1 overflow-y-auto p-4"
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a note or create a new one
          </div>
        )}
      </div>

      {/* ── Backlinks panel ──────────────────────────────────────────── */}
      {activeNoteId && activeNoteData && (
        <BacklinksPanel
          noteId={activeNoteId}
          noteTitle={activeNoteData.title}
        />
      )}
    </div>
  );
}
