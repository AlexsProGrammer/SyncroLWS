import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import type { TaskPayload } from '@syncrohws/shared-types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KanbanTaskItem {
  id: string;
  payload: TaskPayload;
  created_at: string;
  updated_at: string;
}

interface KanbanCardProps {
  task: KanbanTaskItem;
  isOverlay?: boolean;
  onClick?: () => void;
}

// ── Priority badge colors ─────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-slate-500/20 text-slate-500',
  medium: 'bg-blue-500/20 text-blue-500',
  high: 'bg-orange-500/20 text-orange-500',
  urgent: 'bg-red-500/20 text-red-500',
};

// ── Card ──────────────────────────────────────────────────────────────────────

export function KanbanCard({
  task,
  isOverlay,
  onClick,
}: KanbanCardProps): React.ReactElement {
  const p = task.payload;
  const checkedCount = p.checklist?.filter((c) => c.checked).length ?? 0;
  const totalChecklist = p.checklist?.length ?? 0;
  const attachmentCount = p.attachments?.length ?? 0;
  const commentCount = p.comments?.length ?? 0;

  return (
    <div
      onClick={onClick}
      className={cn(
        'group cursor-pointer rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow hover:shadow-md',
        isOverlay && 'rotate-2 shadow-lg',
      )}
    >
      {/* Labels row */}
      {p.labels && p.labels.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {p.labels.map((label) => (
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

      {/* Title */}
      <p className="text-sm font-medium leading-snug text-foreground">
        {p.title || 'Untitled task'}
      </p>

      {/* Description preview */}
      {p.description && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {p.description}
        </p>
      )}

      {/* Bottom row: priority, due date, counters */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-medium',
            PRIORITY_COLORS[p.priority ?? 'medium'] ?? PRIORITY_COLORS.medium,
          )}
        >
          {p.priority ?? 'medium'}
        </span>

        {p.due_date && (
          <span
            className={cn(
              'text-[10px]',
              new Date(p.due_date) < new Date()
                ? 'font-semibold text-red-500'
                : 'text-muted-foreground',
            )}
          >
            {new Date(p.due_date).toLocaleDateString()}
          </span>
        )}

        {/* Subtask progress */}
        {totalChecklist > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="9,11 12,14 22,4" />
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
            </svg>
            {checkedCount}/{totalChecklist}
          </span>
        )}

        {/* Attachment count */}
        {attachmentCount > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
            {attachmentCount}
          </span>
        )}

        {/* Comment count */}
        {commentCount > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            {commentCount}
          </span>
        )}

        {/* Assignee */}
        {p.assigned_to && (
          <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {p.assigned_to}
          </span>
        )}
      </div>

      {/* Subtask progress bar */}
      {totalChecklist > 0 && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${(checkedCount / totalChecklist) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ── Sortable wrapper ──────────────────────────────────────────────────────────

interface SortableKanbanCardProps {
  task: KanbanTaskItem;
  onClick?: () => void;
}

export function SortableKanbanCard({
  task,
  onClick,
}: SortableKanbanCardProps): React.ReactElement {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <KanbanCard task={task} onClick={onClick} />
    </div>
  );
}
