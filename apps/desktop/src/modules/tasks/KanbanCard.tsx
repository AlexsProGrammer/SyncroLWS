import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import type { EntityCore, EntityAspect, TaskAspectData } from '@syncrohws/shared-types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KanbanTaskItem {
  core: EntityCore;
  aspect: EntityAspect;
}

interface KanbanCardProps {
  item: KanbanTaskItem;
  isOverlay?: boolean;
  onClick?: () => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-slate-500/20 text-slate-500',
  medium: 'bg-blue-500/20 text-blue-500',
  high: 'bg-orange-500/20 text-orange-500',
  urgent: 'bg-red-500/20 text-red-500',
};

// ── Card ──────────────────────────────────────────────────────────────────────

export function KanbanCard({ item, isOverlay, onClick }: KanbanCardProps): React.ReactElement {
  const { core } = item;
  const data = item.aspect.data as Partial<TaskAspectData>;
  const checkedCount = data.checklist?.filter((c) => c.checked).length ?? 0;
  const totalChecklist = data.checklist?.length ?? 0;
  const labels = data.labels ?? [];

  return (
    <div
      onClick={onClick}
      className={cn(
        'group cursor-pointer rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow-md',
        isOverlay && 'rotate-2 shadow-lg',
      )}
      style={{ borderLeft: `3px solid ${core.color}` }}
    >
      {labels.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {labels.map((label) => (
            <span
              key={label.id}
              className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
              style={{ backgroundColor: label.color }}
            >
              {label.name}
            </span>
          ))}
        </div>
      )}

      <p className="text-sm font-medium leading-snug text-foreground">
        {core.title || 'Untitled task'}
      </p>

      {core.description && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{core.description}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-medium',
            PRIORITY_COLORS[data.priority ?? 'medium'] ?? PRIORITY_COLORS.medium,
          )}
        >
          {data.priority ?? 'medium'}
        </span>

        {data.due_date && (
          <span
            className={cn(
              'text-[10px]',
              new Date(data.due_date) < new Date()
                ? 'font-semibold text-red-500'
                : 'text-muted-foreground',
            )}
          >
            {new Date(data.due_date).toLocaleDateString()}
          </span>
        )}

        {totalChecklist > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="9,11 12,14 22,4" />
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
            </svg>
            {checkedCount}/{totalChecklist}
          </span>
        )}

        {data.assigned_to && (
          <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {data.assigned_to}
          </span>
        )}
      </div>

      {totalChecklist > 0 && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${(checkedCount / totalChecklist) * 100}%` }}
          />
        </div>
      )}

      {core.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {core.tags.map((t) => (
            <span key={t} className="text-[9px] text-primary/70">#{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sortable wrapper ──────────────────────────────────────────────────────────

interface SortableKanbanCardProps {
  item: KanbanTaskItem;
  onClick?: () => void;
}

export function SortableKanbanCard({ item, onClick }: SortableKanbanCardProps): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.core.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <KanbanCard item={item} onClick={onClick} />
    </div>
  );
}
