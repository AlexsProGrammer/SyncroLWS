import React, { useEffect, useMemo, useState } from 'react';
import { eventBus } from '@/core/events';
import { ftsSearch, getWorkspaceDB } from '@/core/db';
import { getEntity } from '@/core/entityStore';
import { getAllAspectPlugins, getToolByEntityType } from '@/registry/ToolRegistry';
import type { AspectType, BaseEntity, HybridEntity } from '@syncrohws/shared-types';

interface SearchHit {
  entity: HybridEntity;
  primaryAspectType: AspectType | 'general';
  title: string;
  subtitle?: string;
  tags: string[];
  aspectTypes: string[];
}

const DEBOUNCE_MS = 200;

/**
 * Phase L — Search & Tags dashboard.
 *
 * Full-page FTS5 search, tag filtering, aspect-type filtering. Mirrors the
 * CommandPalette result-rendering shape so tools' `renderSearchResult` is
 * reused unchanged.
 */
export function SearchView(): React.ReactElement {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [selectedAspects, setSelectedAspects] = useState<Set<string>>(new Set());
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const aspectPlugins = useMemo(() => getAllAspectPlugins(), []);

  // Debounce the input.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  // Load distinct tags once.
  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const db = getWorkspaceDB();
        const rows = await db.select<{ tags: string | null }[]>(
          `SELECT tags FROM base_entities WHERE deleted_at IS NULL AND tags IS NOT NULL`,
        );
        const tagSet = new Set<string>();
        for (const r of rows) {
          if (!r.tags) continue;
          try {
            const arr = JSON.parse(r.tags) as unknown;
            if (Array.isArray(arr)) for (const t of arr) if (typeof t === 'string') tagSet.add(t);
          } catch {
            /* ignore malformed tag JSON */
          }
        }
        if (!cancelled) setAllTags(Array.from(tagSet).sort());
      } catch (err) {
        console.warn('[search-view] tag load failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Run search whenever inputs change.
  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      setLoading(true);
      try {
        // Without a query, we can list-by-tag: select base entities matching
        // the tag/aspect filters directly; if both are empty too, show empty.
        let ids: string[] = [];
        if (debounced.trim()) {
          ids = await ftsSearch(debounced);
        } else if (selectedTags.size > 0 || selectedAspects.size > 0) {
          const db = getWorkspaceDB();
          const rows = await db.select<{ id: string }[]>(
            `SELECT id FROM base_entities WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200`,
          );
          ids = rows.map((r) => r.id);
        }
        if (!ids.length) {
          if (!cancelled) setHits([]);
          return;
        }
        const hydrated = await Promise.all(ids.map((id) => getEntity(id)));
        const mapped: SearchHit[] = hydrated
          .filter((h): h is NonNullable<typeof h> => h !== null)
          .map((h) => {
            const primary = h.aspects[0];
            const aspectType: AspectType | 'general' = primary?.aspect_type ?? 'general';
            const tool = getToolByEntityType(aspectType);
            const title =
              (h.core.title && h.core.title.trim()) ||
              tool?.getEntityTitle?.(h) ||
              h.core.id;
            const subtitle =
              (h.core.description && h.core.description.trim()) ||
              tool?.getEntitySubtitle?.(h) ||
              undefined;
            return {
              entity: h,
              primaryAspectType: aspectType,
              title,
              subtitle,
              tags: Array.isArray(h.core.tags) ? h.core.tags : [],
              aspectTypes: h.aspects.map((a) => a.aspect_type),
            };
          });

        // Apply tag + aspect filters client-side.
        const filtered = mapped.filter((h) => {
          if (selectedTags.size > 0 && !h.tags.some((t) => selectedTags.has(t))) return false;
          if (selectedAspects.size > 0 && !h.aspectTypes.some((a) => selectedAspects.has(a))) return false;
          return true;
        });

        if (!cancelled) setHits(filtered);
      } catch (err) {
        console.error('[search-view] failed:', err);
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced, selectedTags, selectedAspects]);

  const toggleTag = (tag: string): void => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const toggleAspect = (aspect: string): void => {
    setSelectedAspects((prev) => {
      const next = new Set(prev);
      if (next.has(aspect)) next.delete(aspect);
      else next.add(aspect);
      return next;
    });
  };

  const clearFilters = (): void => {
    setSelectedTags(new Set());
    setSelectedAspects(new Set());
    setQuery('');
  };

  const hasFilters = selectedTags.size > 0 || selectedAspects.size > 0 || debounced.trim().length > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">Search &amp; Tags</h1>
        <p className="text-xs text-muted-foreground">
          Full-text search across all entities, filterable by tags and aspect types.
        </p>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Filter rail */}
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-border p-4 text-sm">
          <section>
            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Aspect type
            </h2>
            <ul className="space-y-1">
              {aspectPlugins.map((p) => {
                const Icon = p.icon;
                const active = selectedAspects.has(p.type);
                return (
                  <li key={p.type}>
                    <button
                      type="button"
                      onClick={() => toggleAspect(p.type)}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent ${
                        active ? 'bg-accent font-medium' : ''
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex-1">{p.label}</span>
                      {active && <span className="text-[10px] text-muted-foreground">×</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {allTags.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Tags
              </h2>
              <div className="flex flex-wrap gap-1">
                {allTags.map((tag) => {
                  const active = selectedTags.has(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                        active
                          ? 'border-primary bg-primary/10 font-medium text-primary'
                          : 'border-border bg-muted/50 text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      #{tag}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-6 w-full rounded border border-border px-2 py-1 text-xs hover:bg-accent"
            >
              Clear all filters
            </button>
          )}
        </aside>

        {/* Results */}
        <main className="flex-1 overflow-y-auto">
          <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, description, tags…"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
          </div>

          <div className="px-6 py-3 text-xs text-muted-foreground">
            {loading ? 'Searching…' : hits.length === 0 ? (hasFilters ? 'No results.' : 'Type to search or pick a filter.') : `${hits.length} result${hits.length === 1 ? '' : 's'}`}
          </div>

          <ul className="divide-y divide-border">
            {hits.map((r) => {
              const tool = getToolByEntityType(r.primaryAspectType);
              const ToolIcon = tool?.icon;
              const id = r.entity.core.id;
              const navType = r.primaryAspectType as BaseEntity['type'];
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => {
                      eventBus.emit('nav:open-entity', { id, type: navType });
                      eventBus.emit('nav:open-detail-sheet', { id });
                    }}
                    className="flex w-full items-start gap-3 px-6 py-3 text-left text-sm hover:bg-accent"
                  >
                    {tool?.renderSearchResult ? (
                      tool.renderSearchResult(r.entity)
                    ) : (
                      <>
                        {ToolIcon ? (
                          <ToolIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {r.primaryAspectType}
                          </span>
                        )}
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium">{r.title}</span>
                          {r.subtitle && (
                            <span className="truncate text-xs text-muted-foreground">{r.subtitle}</span>
                          )}
                          {r.tags.length > 0 && (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {r.tags.map((t) => (
                                <span
                                  key={t}
                                  className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                >
                                  #{t}
                                </span>
                              ))}
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </main>
      </div>
    </div>
  );
}
