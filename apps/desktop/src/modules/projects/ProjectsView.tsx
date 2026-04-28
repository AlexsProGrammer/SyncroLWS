/**
 * ProjectsView — workspace-wide list of project entities.
 * core.title=name, project aspect holds status/due_date/owner_label/milestones.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { eventBus } from '@/core/events';
import { useEntityEvents } from '@/ui/hooks/useEntityEvents';
import {
  createEntity,
  listByAspect,
  type AspectWithCore,
} from '@/core/entityStore';
import { Button } from '@/ui/components/button';
import { Input } from '@/ui/components/input';
import { Badge } from '@/ui/components/badge';
import { EntityRowContextMenu } from '@/ui/components/EntityRowContextMenu';
import type { ProjectAspectData } from '@syncrohws/shared-types';

const STATUS_LABEL: Record<ProjectAspectData['status'], string> = {
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  archived: 'Archived',
};

const STATUS_COLOR: Record<ProjectAspectData['status'], string> = {
  active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  on_hold: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  completed: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  archived: 'bg-muted text-muted-foreground',
};

function dataOf(item: AspectWithCore): Partial<ProjectAspectData> {
  return item.aspect.data as Partial<ProjectAspectData>;
}

export function ProjectsView(): React.ReactElement {
  const [items, setItems] = useState<AspectWithCore[]>([]);
  const [filter, setFilter] = useState<ProjectAspectData['status'] | 'all'>('all');
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    const rows = await listByAspect('project');
    setItems(rows);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEntityEvents(reload, { aspectType: 'project' });

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((i) => (dataOf(i).status ?? 'active') === filter);
  }, [items, filter]);

  async function handleCreate(): Promise<void> {
    const title = newTitle.trim();
    if (!title || creating) return;
    setCreating(true);
    try {
      await createEntity({
        core: { title, icon: 'project', color: '#6366f1' },
        aspects: [
          {
            aspect_type: 'project',
            data: { status: 'active', due_date: null, owner_label: '', milestones: [] },
          },
        ],
      });
      setNewTitle('');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <Input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleCreate();
          }}
          placeholder="New project name…"
          className="h-9 max-w-sm"
        />
        <Button size="sm" onClick={() => void handleCreate()} disabled={!newTitle.trim() || creating}>
          Create
        </Button>

        <div className="ml-auto flex items-center gap-1">
          {(['all', 'active', 'on_hold', 'completed', 'archived'] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={filter === s ? 'default' : 'ghost'}
              onClick={() => setFilter(s)}
              className="h-7 px-2 text-xs"
            >
              {s === 'all' ? 'All' : STATUS_LABEL[s]}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No projects yet.
          </div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item) => {
              const data = dataOf(item);
              const status: ProjectAspectData['status'] = data.status ?? 'active';
              const milestones = data.milestones ?? [];
              const done = milestones.filter((m) => m.done).length;
              const due = data.due_date ? new Date(data.due_date) : null;
              return (
                <EntityRowContextMenu
                  key={item.core.id}
                  entityId={item.core.id}
                  existingTypes={['project']}
                  openInitialAspectType="project"
                >
                  <button
                    onClick={() =>
                      eventBus.emit('nav:open-detail-sheet', {
                        id: item.core.id,
                        initialAspectType: 'project',
                      })
                    }
                    className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 text-left hover:border-primary/40 hover:bg-accent/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div
                        className="flex h-2 w-2 mt-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: item.core.color }}
                      />
                      <div className="flex-1 truncate font-medium">
                        {item.core.title || 'Untitled Project'}
                      </div>
                      <Badge variant="outline" className={`shrink-0 text-[10px] ${STATUS_COLOR[status]}`}>
                        {STATUS_LABEL[status]}
                      </Badge>
                    </div>
                    {item.core.description && (
                      <div className="text-xs text-muted-foreground line-clamp-2">
                        {item.core.description}
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      {data.owner_label && <span className="truncate">{data.owner_label}</span>}
                      {due && <span>· due {due.toLocaleDateString()}</span>}
                      {milestones.length > 0 && (
                        <span>
                          · {done}/{milestones.length} milestones
                        </span>
                      )}
                    </div>
                  </button>
                </EntityRowContextMenu>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
