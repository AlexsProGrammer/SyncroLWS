import React, { useState, useEffect, useCallback } from 'react';
import { NoteEditor } from './NoteEditor';
import { getDB } from '@/core/db';
import { eventBus } from '@/core/events';
import { Button } from '@/ui/components/button';
import { cn } from '@/lib/utils';
import type { NotePayload } from '@syncrohws/shared-types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface NoteListItem {
  id: string;
  title: string;
  preview: string;
  updated_at: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NotesView(): React.ReactElement {
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [activeNoteData, setActiveNoteData] = useState<{
    title: string;
    content_md: string;
  } | null>(null);

  // ── Load notes list ───────────────────────────────────────────────────────
  const loadNotes = useCallback(async () => {
    try {
      const db = getDB();
      const rows = await db.select<{ id: string; payload: string; updated_at: string }[]>(
        `SELECT id, payload, updated_at FROM base_entities
         WHERE type = 'note' AND deleted_at IS NULL
         ORDER BY updated_at DESC`,
      );
      const items: NoteListItem[] = rows.map((r) => {
        const p = JSON.parse(r.payload) as Partial<NotePayload>;
        return {
          id: r.id,
          title: p.title || 'Untitled',
          preview: (p.content_md ?? '').slice(0, 120),
          updated_at: r.updated_at,
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
      const db = getDB();
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
      });
    } catch (err) {
      console.error('[notes] open failed:', err);
    }
  }, []);

  // ── Create note ───────────────────────────────────────────────────────────
  const createNote = useCallback(async () => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const payload: NotePayload = {
      title: '',
      content_md: '',
      linked_entity_ids: [],
    };

    try {
      const db = getDB();
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
      setActiveNoteData({ title: '', content_md: '' });
    } catch (err) {
      console.error('[notes] create failed:', err);
    }
  }, []);

  // ── Delete note ───────────────────────────────────────────────────────────
  const deleteNote = useCallback(
    async (noteId: string) => {
      try {
        const db = getDB();
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
          <Button variant="ghost" size="sm" onClick={() => void createNote()}>
            + New
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {notes.map((note) => (
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
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <span className="truncate text-xs text-muted-foreground">{note.preview || 'Empty note'}</span>
              <span className="text-[10px] text-muted-foreground/60">
                {new Date(note.updated_at).toLocaleDateString()}
              </span>
            </button>
          ))}
          {notes.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <p>No notes yet</p>
              <Button variant="outline" size="sm" onClick={() => void createNote()}>
                Create your first note
              </Button>
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
            className="flex-1 overflow-y-auto p-4"
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a note or create a new one
          </div>
        )}
      </div>
    </div>
  );
}
