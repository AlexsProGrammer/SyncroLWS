import React, { useState, useEffect, useCallback } from 'react';
import { Command } from 'cmdk';
import { eventBus } from '@/core/events';
import { ftsSearch, getDB } from '@/core/db';
import type { BaseEntity } from '@syncrohws/shared-types';

type SearchResult = Pick<BaseEntity, 'id' | 'type'> & { title: string };

export function CommandPalette(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);

  // Open / close via Event Bus
  useEffect(() => {
    eventBus.on('nav:open-command-palette', () => setOpen(true));
    eventBus.on('nav:close-command-palette', () => setOpen(false));
    return () => {
      eventBus.off('nav:open-command-palette', () => setOpen(true));
      eventBus.off('nav:close-command-palette', () => setOpen(false));
    };
  }, []);

  // Also close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const search = useCallback(async (q: string): Promise<void> => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    try {
      const ids = await ftsSearch(q);
      if (!ids.length) {
        setResults([]);
        return;
      }
      const db = await getDB();
      const placeholders = ids.map(() => '?').join(',');
      const rows = await db.select<{ id: string; type: string; payload: string }[]>(
        `SELECT id, type, payload FROM base_entities WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
        ids,
      );
      const mapped: SearchResult[] = rows.map((r) => {
        let title = r.id;
        try {
          const payload = JSON.parse(r.payload) as Record<string, unknown>;
          if (typeof payload['title'] === 'string') title = payload['title'];
        } catch {
          // keep id as fallback
        }
        return { id: r.id, type: r.type as BaseEntity['type'], title };
      });
      console.log('[fts] results:', mapped);
      setResults(mapped);
    } catch (err) {
      console.error('[fts] search error:', err);
    }
  }, []);

  useEffect(() => {
    void search(query);
  }, [query, search]);

  if (!open) return <></>;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-24">
      <Command
        className="w-full max-w-2xl rounded-xl border border-border bg-popover shadow-2xl"
        shouldFilter={false}
      >
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search notes, tasks, events…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
          autoFocus
        />
        <Command.List className="max-h-96 overflow-y-auto p-2">
          {results.length === 0 && query.trim() && (
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              No results for "{query}"
            </Command.Empty>
          )}
          {results.map((r) => (
            <Command.Item
              key={r.id}
              value={r.id}
              onSelect={() => {
                eventBus.emit('nav:open-entity', { id: r.id, type: r.type });
                setOpen(false);
                setQuery('');
              }}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-accent aria-selected:bg-accent"
            >
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                {r.type}
              </span>
              <span className="truncate">{r.title}</span>
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}
