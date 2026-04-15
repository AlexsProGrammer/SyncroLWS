import React, { useState, useEffect, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import { getWorkspaceDB } from '@/core/db';
import { eventBus } from '@/core/events';
import { Button } from '@/ui/components/button';
import { Input } from '@/ui/components/input';
import { cn } from '@/lib/utils';
import type { TaskPayload, BaseEntity } from '@syncrohws/shared-types';

// ── Types ─────────────────────────────────────────────────────────────────────

type TaskStatus = 'todo' | 'in_progress' | 'done';

interface TaskItem {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: string;
  due_date: string | null;
  created_at: string;
}

const COLUMNS: { id: TaskStatus; label: string; color: string }[] = [
  { id: 'todo', label: 'To Do', color: 'border-blue-500/40' },
  { id: 'in_progress', label: 'In Progress', color: 'border-yellow-500/40' },
  { id: 'done', label: 'Done', color: 'border-green-500/40' },
];

// ── Main Component ────────────────────────────────────────────────────────────

export function TasksView(): React.ReactElement {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [activeTask, setActiveTask] = useState<TaskItem | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // ── Load tasks from DB ────────────────────────────────────────────────────
  const loadTasks = useCallback(async () => {
    try {
      const db = getWorkspaceDB();
      const rows = await db.select<{ id: string; payload: string; created_at: string }[]>(
        `SELECT id, payload, created_at FROM base_entities WHERE type = 'task' AND deleted_at IS NULL ORDER BY created_at DESC`,
      );
      const items: TaskItem[] = rows.map((r) => {
        const p = JSON.parse(r.payload) as Partial<TaskPayload>;
        return {
          id: r.id,
          title: p.title ?? '',
          description: p.description ?? '',
          status: (p.status as TaskStatus) ?? 'todo',
          priority: p.priority ?? 'medium',
          due_date: p.due_date ?? null,
          created_at: r.created_at,
        };
      });
      setTasks(items);
    } catch (err) {
      console.error('[tasks] load failed:', err);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  // Reload when entities change
  useEffect(() => {
    const handler = (): void => {
      void loadTasks();
    };
    eventBus.on('entity:created', handler);
    eventBus.on('entity:deleted', handler);
    return () => {
      eventBus.off('entity:created', handler);
      eventBus.off('entity:deleted', handler);
    };
  }, [loadTasks]);

  // ── Create task ───────────────────────────────────────────────────────────
  const createTask = useCallback(async () => {
    const title = newTaskTitle.trim();
    if (!title) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const payload: TaskPayload = {
      title,
      description: '',
      status: 'todo',
      priority: 'medium',
      due_date: null,
      assigned_to: null,
      file_hashes: [],
    };

    try {
      const db = getWorkspaceDB();
      await db.execute(
        `INSERT INTO base_entities (id, type, payload, metadata, tags, parent_id, created_at, updated_at)
         VALUES (?, 'task', ?, '{}', '[]', NULL, ?, ?)`,
        [id, JSON.stringify(payload), now, now],
      );

      setNewTaskTitle('');
      setTasks((prev) => [
        {
          id,
          title,
          description: '',
          status: 'todo',
          priority: 'medium',
          due_date: null,
          created_at: now,
        },
        ...prev,
      ]);

      eventBus.emit('entity:created', {
        entity: {
          id,
          type: 'task',
          payload,
          metadata: {},
          tags: [],
          parent_id: null,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        },
      });
    } catch (err) {
      console.error('[tasks] create failed:', err);
    }
  }, [newTaskTitle]);

  // ── Update task status in DB ──────────────────────────────────────────────
  const updateTaskStatus = useCallback(
    async (taskId: string, newStatus: TaskStatus) => {
      try {
        const db = getWorkspaceDB();
        // Read current payload, update status field
        const rows = await db.select<{ payload: string }[]>(
          `SELECT payload FROM base_entities WHERE id = ?`,
          [taskId],
        );
        if (!rows[0]) return;

        const payload = JSON.parse(rows[0].payload) as TaskPayload;
        payload.status = newStatus;

        await db.execute(
          `UPDATE base_entities SET payload = ?, updated_at = ? WHERE id = ?`,
          [JSON.stringify(payload), new Date().toISOString(), taskId],
        );
      } catch (err) {
        console.error('[tasks] status update failed:', err);
      }
    },
    [],
  );

  // ── Delete task ───────────────────────────────────────────────────────────
  const deleteTask = useCallback(async (taskId: string) => {
    try {
      const db = getWorkspaceDB();
      await db.execute(
        `UPDATE base_entities SET deleted_at = ? WHERE id = ?`,
        [new Date().toISOString(), taskId],
      );
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      eventBus.emit('entity:deleted', { id: taskId, type: 'task' });
    } catch (err) {
      console.error('[tasks] delete failed:', err);
    }
  }, []);

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = tasks.find((t) => t.id === event.active.id);
      setActiveTask(task ?? null);
    },
    [tasks],
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveTask(null);
      const { active, over } = event;
      if (!over) return;

      const taskId = active.id as string;
      // The "over" target can be a column id or another task card
      let newStatus: TaskStatus | undefined;

      // Check if dropped over a column directly
      if (COLUMNS.some((c) => c.id === over.id)) {
        newStatus = over.id as TaskStatus;
      } else {
        // Dropped over another task — use that task's column
        const overTask = tasks.find((t) => t.id === over.id);
        if (overTask) newStatus = overTask.status;
      }

      if (!newStatus) return;

      const task = tasks.find((t) => t.id === taskId);
      if (!task || task.status === newStatus) return;

      // Optimistic UI update
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)),
      );
      void updateTaskStatus(taskId, newStatus);
    },
    [tasks, updateTaskStatus],
  );

  // ── Group tasks by status ─────────────────────────────────────────────────
  const tasksByStatus = (status: TaskStatus): TaskItem[] =>
    tasks.filter((t) => t.status === status);

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-4">
      {/* ── New task input ──────────────────────────────────────────── */}
      <div className="mb-4 flex gap-2">
        <Input
          value={newTaskTitle}
          onChange={(e) => setNewTaskTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void createTask();
          }}
          placeholder="New task title…"
          className="flex-1"
        />
        <Button onClick={() => void createTask()} disabled={!newTaskTitle.trim()}>
          Add Task
        </Button>
      </div>

      {/* ── Kanban columns ──────────────────────────────────────────── */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="flex flex-1 gap-4 overflow-x-auto">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              column={col}
              tasks={tasksByStatus(col.id)}
              onDelete={deleteTask}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} isOverlay /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

// ── Kanban Column ─────────────────────────────────────────────────────────────

interface KanbanColumnProps {
  column: { id: TaskStatus; label: string; color: string };
  tasks: TaskItem[];
  onDelete: (id: string) => void;
}

function KanbanColumn({ column, tasks, onDelete }: KanbanColumnProps): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-w-[280px] flex-1 flex-col rounded-lg border-t-2 bg-muted/30 p-2',
        column.color,
        isOver && 'bg-accent/30',
      )}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold text-foreground">{column.label}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {tasks.length}
        </span>
      </div>

      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
          {tasks.map((task) => (
            <SortableTaskCard key={task.id} task={task} onDelete={onDelete} />
          ))}
          {tasks.length === 0 && (
            <div className="flex flex-1 items-center justify-center py-8 text-xs text-muted-foreground">
              Drop tasks here
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

// ── Sortable Task Card ────────────────────────────────────────────────────────

interface SortableTaskCardProps {
  task: TaskItem;
  onDelete: (id: string) => void;
}

function SortableTaskCard({ task, onDelete }: SortableTaskCardProps): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard task={task} onDelete={onDelete} />
    </div>
  );
}

// ── Task Card ─────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-slate-500/20 text-slate-400',
  medium: 'bg-blue-500/20 text-blue-400',
  high: 'bg-orange-500/20 text-orange-400',
  urgent: 'bg-red-500/20 text-red-400',
};

interface TaskCardProps {
  task: TaskItem;
  isOverlay?: boolean;
  onDelete?: (id: string) => void;
}

function TaskCard({ task, isOverlay, onDelete }: TaskCardProps): React.ReactElement {
  return (
    <div
      className={cn(
        'group rounded-lg border border-border bg-card p-3 shadow-sm',
        isOverlay && 'rotate-2 shadow-lg',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground leading-snug">{task.title}</p>
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(task.id);
            }}
            className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity"
            title="Delete task"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
      {task.description && (
        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{task.description}</p>
      )}
      <div className="mt-2 flex items-center gap-2">
        <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.medium)}>
          {task.priority}
        </span>
        {task.due_date && (
          <span className="text-[10px] text-muted-foreground">
            {new Date(task.due_date).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}
