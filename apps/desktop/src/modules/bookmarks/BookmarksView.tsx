/**
 * BookmarksView — Save, tag, pin, and browse bookmarks / links.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { getWorkspaceDB } from '@/core/db';
import { eventBus } from '@/core/events';
import { Button } from '@/ui/components/button';
import { Input } from '@/ui/components/input';
import { Badge } from '@/ui/components/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/dialog';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Bookmark {
  id: string;
  url: string;
  title: string;
  description: string;
  color: string;
  pinned: boolean;
  tags: string[];
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const PRESET_COLORS = [
  '#3b82f6', '#22c55e', '#ef4444', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6',
];

// ── Component ─────────────────────────────────────────────────────────────────

export function BookmarksView(): React.ReactElement {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [search, setSearch] = useState('');
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editBookmark, setEditBookmark] = useState<Bookmark | null>(null);

  // Create form
  const [newUrl, setNewUrl] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');
  const [newTags, setNewTags] = useState('');
  const [newPinned, setNewPinned] = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadBookmarks = useCallback(async () => {
    try {
      const db = getWorkspaceDB();
      const rows = await db.select<{ id: string; payload: string; tags: string; created_at: string }[]>(
        `SELECT id, payload, tags, created_at FROM base_entities
         WHERE type = 'bookmark' AND deleted_at IS NULL
         ORDER BY created_at DESC`,
      );

      setBookmarks(
        rows.map((r) => {
          const p = JSON.parse(r.payload);
          const tags: string[] = (() => {
            try { return JSON.parse(r.tags); } catch { return []; }
          })();
          return {
            id: r.id,
            url: p.url ?? '',
            title: p.title ?? '',
            description: p.description ?? '',
            color: p.color ?? '#3b82f6',
            pinned: p.pinned ?? false,
            tags,
            created_at: r.created_at,
          };
        }),
      );
    } catch (err) {
      console.error('[bookmarks] load failed:', err);
    }
  }, []);

  useEffect(() => {
    void loadBookmarks();
  }, [loadBookmarks]);

  useEffect(() => {
    const handler = (): void => void loadBookmarks();
    eventBus.on('entity:created', handler);
    eventBus.on('entity:updated', handler);
    eventBus.on('entity:deleted', handler);
    return () => {
      eventBus.off('entity:created', handler);
      eventBus.off('entity:updated', handler);
      eventBus.off('entity:deleted', handler);
    };
  }, [loadBookmarks]);

  // ── Create ────────────────────────────────────────────────────────────────

  const createBookmark = useCallback(async () => {
    if (!newUrl.trim()) return;
    const db = getWorkspaceDB();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const tags = newTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const payload = {
      url: newUrl.trim(),
      title: newTitle.trim() || getDomain(newUrl.trim()),
      description: newDescription.trim(),
      favicon_hash: null,
      color: newColor,
      pinned: newPinned,
    };

    await db.execute(
      `INSERT INTO base_entities
         (id, type, payload, metadata, tags, parent_id, created_at, updated_at)
       VALUES (?, 'bookmark', ?, '{}', ?, NULL, ?, ?)`,
      [id, JSON.stringify(payload), JSON.stringify(tags), now, now],
    );

    eventBus.emit('entity:created', {
      entity: {
        id,
        type: 'bookmark',
        payload,
        metadata: {},
        tags,
        parent_id: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      },
    });

    setNewUrl('');
    setNewTitle('');
    setNewDescription('');
    setNewColor('#3b82f6');
    setNewTags('');
    setNewPinned(false);
    setShowCreateDialog(false);
  }, [newUrl, newTitle, newDescription, newColor, newTags, newPinned]);

  // ── Toggle pin ────────────────────────────────────────────────────────────

  const togglePin = useCallback(async (bm: Bookmark) => {
    const db = getWorkspaceDB();
    const now = new Date().toISOString();
    await db.execute(
      `UPDATE base_entities
       SET payload = json_set(payload, '$.pinned', json(?)),
           updated_at = ?
       WHERE id = ?`,
      [bm.pinned ? 'false' : 'true', now, bm.id],
    );
    eventBus.emit('entity:updated', { entity: { id: bm.id, type: 'bookmark', payload: {} as Record<string, unknown>, metadata: {}, tags: [], parent_id: null, created_at: '', updated_at: now, deleted_at: null } });
  }, []);

  // ── Delete ────────────────────────────────────────────────────────────────

  const deleteBookmark = useCallback(async (id: string) => {
    const db = getWorkspaceDB();
    const now = new Date().toISOString();
    await db.execute(`UPDATE base_entities SET deleted_at = ? WHERE id = ?`, [now, id]);
    eventBus.emit('entity:deleted', { id, type: 'bookmark' });
    setEditBookmark(null);
  }, []);

  // ── Update ────────────────────────────────────────────────────────────────

  const updateBookmark = useCallback(
    async (bm: Bookmark) => {
      const db = getWorkspaceDB();
      const now = new Date().toISOString();
      const payload = {
        url: bm.url,
        title: bm.title,
        description: bm.description,
        favicon_hash: null,
        color: bm.color,
        pinned: bm.pinned,
      };
      await db.execute(
        `UPDATE base_entities
         SET payload = ?, tags = ?, updated_at = ?
         WHERE id = ?`,
        [JSON.stringify(payload), JSON.stringify(bm.tags), now, bm.id],
      );
      eventBus.emit('entity:updated', { entity: { id: bm.id, type: 'bookmark', payload: payload as unknown as Record<string, unknown>, metadata: {}, tags: bm.tags, parent_id: null, created_at: bm.created_at, updated_at: now, deleted_at: null } });
      setEditBookmark(null);
    },
    [],
  );

  // ── All tags ──────────────────────────────────────────────────────────────

  const allTags = Array.from(new Set(bookmarks.flatMap((b) => b.tags))).sort();

  // ── Filter ────────────────────────────────────────────────────────────────

  let filtered = bookmarks;
  if (showPinnedOnly) filtered = filtered.filter((b) => b.pinned);
  if (filterTag) filtered = filtered.filter((b) => b.tags.includes(filterTag));
  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(
      (b) =>
        b.title.toLowerCase().includes(s) ||
        b.url.toLowerCase().includes(s) ||
        b.description.toLowerCase().includes(s) ||
        b.tags.some((t) => t.toLowerCase().includes(s)),
    );
  }

  // Sort: pinned first
  filtered = [...filtered].sort((a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1));

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-4">
      {/* ── Toolbar ────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search bookmarks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-56 text-xs"
          />
          <span className="text-xs text-muted-foreground">{filtered.length} bookmarks</span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={showPinnedOnly ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setShowPinnedOnly(!showPinnedOnly)}
            className="h-7 text-xs"
          >
            ⭐ Pinned
          </Button>
          <Button size="sm" onClick={() => setShowCreateDialog(true)} className="h-7">
            + Add Bookmark
          </Button>
        </div>
      </div>

      {/* ── Tag filter bar ─────────────────────────────────── */}
      {allTags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          <button
            onClick={() => setFilterTag(null)}
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
              !filterTag ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            All
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setFilterTag(filterTag === tag ? null : tag)}
              className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                filterTag === tag
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* ── Bookmark grid ──────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="text-4xl">🔖</span>
            <p className="text-sm text-muted-foreground">
              {search || filterTag ? 'No bookmarks match your filter' : 'No bookmarks yet — add one!'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
            {filtered.map((bm) => (
              <div
                key={bm.id}
                className="group relative flex flex-col gap-2 rounded-lg border bg-card p-3.5 transition-colors hover:border-primary/30"
                style={{ borderLeftColor: bm.color, borderLeftWidth: '3px' }}
              >
                {/* Pin indicator */}
                {bm.pinned && (
                  <span className="absolute right-2 top-2 text-xs text-yellow-500">⭐</span>
                )}

                {/* Title + domain */}
                <div>
                  <a
                    href={bm.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {bm.title}
                  </a>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{getDomain(bm.url)}</p>
                </div>

                {/* Description */}
                {bm.description && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{bm.description}</p>
                )}

                {/* Tags */}
                {bm.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {bm.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-[9px]">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => void togglePin(bm)}
                    className="rounded p-1 text-muted-foreground hover:text-yellow-500"
                    title={bm.pinned ? 'Unpin' : 'Pin'}
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill={bm.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
                      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setEditBookmark(bm)}
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                    title="Edit"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => void deleteBookmark(bm.id)}
                    className="rounded p-1 text-muted-foreground hover:text-destructive"
                    title="Delete"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Create dialog ──────────────────────────────────── */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Bookmark</DialogTitle>
          </DialogHeader>

          <div className="mt-2 space-y-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">URL</label>
              <Input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://…" autoFocus />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Title</label>
              <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Auto-detected from domain" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Description</label>
              <Input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Tags (comma separated)</label>
              <Input value={newTags} onChange={(e) => setNewTags(e.target.value)} placeholder="dev, docs, tools" />
            </div>

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Color</label>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewColor(c)}
                    className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      borderColor: newColor === c ? 'hsl(var(--foreground))' : 'transparent',
                    }}
                  />
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={newPinned} onChange={(e) => setNewPinned(e.target.checked)} />
              Pin to top
            </label>

            <Button onClick={() => void createBookmark()} className="w-full" disabled={!newUrl.trim()}>
              Save Bookmark
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ────────────────────────────────────── */}
      <Dialog open={!!editBookmark} onOpenChange={(open) => !open && setEditBookmark(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Bookmark</DialogTitle>
          </DialogHeader>

          {editBookmark && (
            <div className="mt-2 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">URL</label>
                <Input
                  value={editBookmark.url}
                  onChange={(e) => setEditBookmark({ ...editBookmark, url: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Title</label>
                <Input
                  value={editBookmark.title}
                  onChange={(e) => setEditBookmark({ ...editBookmark, title: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Description</label>
                <Input
                  value={editBookmark.description}
                  onChange={(e) => setEditBookmark({ ...editBookmark, description: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Tags</label>
                <Input
                  value={editBookmark.tags.join(', ')}
                  onChange={(e) =>
                    setEditBookmark({
                      ...editBookmark,
                      tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
                    })
                  }
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Color</label>
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setEditBookmark({ ...editBookmark, color: c })}
                      className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
                      style={{
                        backgroundColor: c,
                        borderColor: editBookmark.color === c ? 'hsl(var(--foreground))' : 'transparent',
                      }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={() => void updateBookmark(editBookmark)} className="flex-1">
                  Save
                </Button>
                <Button variant="destructive" onClick={() => void deleteBookmark(editBookmark.id)} className="flex-1">
                  Delete
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
