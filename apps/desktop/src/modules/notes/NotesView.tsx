import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/components/dropdown-menu';
import { cn } from '@/lib/utils';
import { eventBus } from '@/core/events';
import {
  createEntity,
  listByAspect,
  softDeleteEntity,
  type AspectWithCore,
} from '@/core/entityStore';
import { NOTE_TEMPLATES, type NoteTemplate } from './templates';
import type { NoteAspectData } from '@syncrohws/shared-types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface NoteListItem {
  id: string;
  title: string;
  preview: string;
  updated_at: string;
  tags: string[];
  color: string;
}

function rowFrom(item: AspectWithCore): NoteListItem {
  const data = item.aspect.data as Partial<NoteAspectData>;
  return {
    id: item.core.id,
    title: item.core.title || 'Untitled',
    preview: (data.content_md ?? '').slice(0, 120),
    updated_at: item.aspect.updated_at,
    tags: item.core.tags,
    color: item.core.color,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NotesView(): React.ReactElement {
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const allTags = useMemo(
    () => [...new Set(notes.flatMap((n) => n.tags))].sort(),
    [notes],
  );
  const filteredNotes = useMemo(
    () => (activeTag ? notes.filter((n) => n.tags.includes(activeTag)) : notes),
    [notes, activeTag],
  );

  const loadNotes = useCallback(async () => {
    try {
      const items = await listByAspect('note');
      items.sort((a, b) => b.aspect.updated_at.localeCompare(a.aspect.updated_at));
      setNotes(items.map(rowFrom));
    } catch (err) {
      console.error('[notes] load failed:', err);
    }
  }, []);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    const onUpdate = (): void => {
      void loadNotes();
    };
    eventBus.on('core:created', onUpdate);
    eventBus.on('core:updated', onUpdate);
    eventBus.on('core:deleted', onUpdate);
    eventBus.on('aspect:added', onUpdate);
    eventBus.on('aspect:updated', onUpdate);
    eventBus.on('aspect:removed', onUpdate);
    eventBus.on('entity:created', onUpdate);
    eventBus.on('entity:updated', onUpdate);
    eventBus.on('entity:deleted', onUpdate);
    return () => {
      eventBus.off('core:created', onUpdate);
      eventBus.off('core:updated', onUpdate);
      eventBus.off('core:deleted', onUpdate);
      eventBus.off('aspect:added', onUpdate);
      eventBus.off('aspect:updated', onUpdate);
      eventBus.off('aspect:removed', onUpdate);
      eventBus.off('entity:created', onUpdate);
      eventBus.off('entity:updated', onUpdate);
      eventBus.off('entity:deleted', onUpdate);
    };
  }, [loadNotes]);

  const openNote = useCallback((id: string): void => {
    eventBus.emit('nav:open-detail-sheet', { id, initialAspectType: 'note' });
  }, []);

  useEffect(() => {
    const handler = ({ id, type }: { id: string; type: string }): void => {
      if (type === 'note') openNote(id);
    };
    eventBus.on('nav:open-entity', handler);
    return () => {
      eventBus.off('nav:open-entity', handler);
    };
  }, [openNote]);

  const createNote = useCallback(
    async (template?: NoteTemplate) => {
      const title = template ? template.getTitle() : '';
      const content = template ? template.getContent() : null;
      const content_json = content ? JSON.stringify(content) : '';

      try {
        const hybrid = await createEntity({
          core: { title },
          aspects: [
            {
              aspect_type: 'note',
              data: { content_md: '', content_json },
            },
          ],
        });
        openNote(hybrid.core.id);
      } catch (err) {
        console.error('[notes] create failed:', err);
      }
    },
    [openNote],
  );

  const deleteNote = useCallback(async (id: string) => {
    try {
      await softDeleteEntity(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      console.error('[notes] delete failed:', err);
    }
  }, []);

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
                  <DropdownMenuItem key={t.id} onClick={() => void createNote(t)}>
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

        <div className="flex-1 overflow-y-auto">
          {filteredNotes.map((note) => (
            <button
              key={note.id}
              onClick={() => openNote(note.id)}
              className="group flex w-full flex-col gap-0.5 border-b border-border/50 px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: note.color }}
                  />
                  <span className="truncate text-sm font-medium text-foreground">
                    {note.title}
                  </span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteNote(note.id);
                  }}
                  className="shrink-0 opacity-0 transition-opacity text-muted-foreground hover:text-red-400 group-hover:opacity-100"
                  title="Delete entity"
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
                <Button variant="outline" size="sm" onClick={() => void createNote()}>
                  Create your first note
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Empty pane (editor lives in EntityDetailSheet now) ───────── */}
      <div className="flex flex-1 items-center justify-center px-8 text-center text-sm text-muted-foreground">
        <div>
          <p>Select a note from the list to open the editor.</p>
          <p className="mt-2 text-xs opacity-70">
            Editing happens in the universal detail sheet — every note is also a base entity
            that can gain task, calendar, or time-log aspects.
          </p>
        </div>
      </div>
    </div>
  );
}
