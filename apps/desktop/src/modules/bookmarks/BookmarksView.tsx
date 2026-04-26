/**
 * BookmarksView — Hybrid-entity edition.
 * Title/desc/color/tags live on EntityCore; url/pinned on bookmark aspect.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { eventBus } from '@/core/events';
import {
  createEntity,
  listByAspect,
  softDeleteEntity,
  updateAspect,
  updateCore,
  type AspectWithCore,
} from '@/core/entityStore';
import { Button } from '@/ui/components/button';
import { Input } from '@/ui/components/input';
import { Badge } from '@/ui/components/badge';
import { EntityRowContextMenu } from '@/ui/components/EntityRowContextMenu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/dialog';
import type { BookmarkAspectData } from '@syncrohws/shared-types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function dataOf(item: AspectWithCore): Partial<BookmarkAspectData> {
  return item.aspect.data as Partial<BookmarkAspectData>;
}

const PRESET_COLORS = [
  '#3b82f6', '#22c55e', '#ef4444', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6',
];

// ── Component ─────────────────────────────────────────────────────────────────

export function BookmarksView(): React.ReactElement {
  const [bookmarks, setBookmarks] = useState<AspectWithCore[]>([]);
  const [search, setSearch] = useState('');
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Create form
  const [newUrl, setNewUrl] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');
  const [newTags, setNewTags] = useState('');
  const [newPinned, setNewPinned] = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    try {
      const items = await listByAspect('bookmark');
      setBookmarks(items);
    } catch (err) {
      console.error('[bookmarks] load failed:', err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onChange = (): void => void load();
    const events = [
      'core:created', 'core:updated', 'core:deleted',
      'aspect:added', 'aspect:updated', 'aspect:removed',
      'entity:created', 'entity:updated', 'entity:deleted',
    ] as const;
    events.forEach((e) => eventBus.on(e, onChange));
    return () => events.forEach((e) => eventBus.off(e, onChange));
  }, [load]);

  // ── Create ────────────────────────────────────────────────────────────────

  const createBookmark = useCallback(async () => {
    if (!newUrl.trim()) return;
    const url = newUrl.trim();
    const tags = newTags.split(',').map((t) => t.trim()).filter(Boolean);
    try {
      await createEntity({
        core: {
          title: newTitle.trim() || getDomain(url),
          description: newDescription.trim(),
          color: newColor,
          tags,
        },
        aspects: [
          { aspect_type: 'bookmark', data: { url, pinned: newPinned, favicon_hash: null } },
        ],
      });
      setNewUrl('');
      setNewTitle('');
      setNewDescription('');
      setNewColor('#3b82f6');
      setNewTags('');
      setNewPinned(false);
      setShowCreateDialog(false);
    } catch (err) {
      console.error('[bookmarks] create failed:', err);
    }
  }, [newUrl, newTitle, newDescription, newColor, newTags, newPinned]);

  // ── Toggle pin ────────────────────────────────────────────────────────────

  const togglePin = useCallback(async (item: AspectWithCore) => {
    try {
      await updateAspect(item.aspect.id, {
        data: { pinned: !(dataOf(item).pinned ?? false) },
      });
    } catch (err) {
      console.error('[bookmarks] pin toggle failed:', err);
    }
  }, []);

  // ── Delete ────────────────────────────────────────────────────────────────

  const deleteBookmark = useCallback(async (id: string) => {
    try {
      await softDeleteEntity(id);
    } catch (err) {
      console.error('[bookmarks] delete failed:', err);
    }
  }, []);

  // ── Open in detail sheet ──────────────────────────────────────────────────

  const openDetail = useCallback((id: string) => {
    eventBus.emit('nav:open-detail-sheet', { id, initialAspectType: 'bookmark' });
  }, []);

  useEffect(() => {
    const onNav = ({ id, type }: { id: string; type: string }): void => {
      if (type === 'bookmark') openDetail(id);
    };
    eventBus.on('nav:open-entity', onNav);
    return () => { eventBus.off('nav:open-entity', onNav); };
  }, [openDetail]);

  // ── Inline color update via grid border (kept in core) ────────────────────

  // (Removed inline edit dialog — now uses universal sheet.)

  // ── All tags ──────────────────────────────────────────────────────────────

  const allTags = Array.from(new Set(bookmarks.flatMap((b) => b.core.tags))).sort();

  // ── Filter ────────────────────────────────────────────────────────────────

  let filtered = bookmarks;
  if (showPinnedOnly) filtered = filtered.filter((b) => dataOf(b).pinned);
  if (filterTag) filtered = filtered.filter((b) => b.core.tags.includes(filterTag));
  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter((b) => {
      const url = dataOf(b).url ?? '';
      return (
        b.core.title.toLowerCase().includes(s) ||
        url.toLowerCase().includes(s) ||
        b.core.description.toLowerCase().includes(s) ||
        b.core.tags.some((t) => t.toLowerCase().includes(s))
      );
    });
  }

  // Sort: pinned first
  filtered = [...filtered].sort((a, b) => {
    const ap = dataOf(a).pinned ?? false;
    const bp = dataOf(b).pinned ?? false;
    return ap === bp ? 0 : ap ? -1 : 1;
  });

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
            {filtered.map((item) => {
              const data = dataOf(item);
              const url = data.url ?? '';
              return (
                <EntityRowContextMenu
                  key={item.core.id}
                  entityId={item.core.id}
                  existingTypes={['bookmark']}
                  openInitialAspectType="bookmark"
                  onDelete={() => void deleteBookmark(item.core.id)}
                >
                <div
                  className="group relative flex flex-col gap-2 rounded-lg border bg-card p-3.5 transition-colors hover:border-primary/30"
                  style={{ borderLeftColor: item.core.color, borderLeftWidth: '3px' }}
                >
                  {data.pinned && (
                    <span className="absolute right-2 top-2 text-xs text-yellow-500">⭐</span>
                  )}

                  <div onClick={() => openDetail(item.core.id)} className="cursor-pointer">
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {item.core.title}
                    </a>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{getDomain(url)}</p>
                  </div>

                  {item.core.description && (
                    <p
                      className="line-clamp-2 cursor-pointer text-xs text-muted-foreground"
                      onClick={() => openDetail(item.core.id)}
                    >
                      {item.core.description}
                    </p>
                  )}

                  {item.core.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {item.core.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-[9px]">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => void togglePin(item)}
                      className="rounded p-1 text-muted-foreground hover:text-yellow-500"
                      title={data.pinned ? 'Unpin' : 'Pin'}
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill={data.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => openDetail(item.core.id)}
                      className="rounded p-1 text-muted-foreground hover:text-foreground"
                      title="Edit"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => void deleteBookmark(item.core.id)}
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
                </EntityRowContextMenu>
              );
            })}
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
    </div>
  );
}

// Re-export updateCore so it's clear how to update bookmark titles/colors externally.
export { updateCore };
