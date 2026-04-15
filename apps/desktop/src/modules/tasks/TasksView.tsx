import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { getWorkspaceDB } from '@/core/db';
import { eventBus } from '@/core/events';
import { Button } from '@/ui/components/button';
import { Input } from '@/ui/components/input';
import { cn } from '@/lib/utils';
import type { TaskPayload, TaskLabel } from '@syncrohws/shared-types';
import { KanbanCard, SortableKanbanCard, type KanbanTaskItem } from './KanbanCard';
import { TaskDetailPanel } from './TaskDetailPanel';
import {
  KanbanFilters,
  type KanbanFilterState,
  DEFAULT_FILTERS,
} from './KanbanFilters';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KanbanColumn {
  id: string;
  name: string;
  color: string;
}

const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: 'todo', name: 'To Do', color: 'border-blue-500/40' },
  { id: 'in_progress', name: 'In Progress', color: 'border-yellow-500/40' },
  { id: 'done', name: 'Done', color: 'border-green-500/40' },
];

// ── Main Component ────────────────────────────────────────────────────────────

export function TasksView(): React.ReactElement {
  const [tasks, setTasks] = useState<KanbanTaskItem[]>([]);
  const [columns, setColumns] = useState<KanbanColumn[]>(DEFAULT_COLUMNS);
  const [activeTask, setActiveTask] = useState<KanbanTaskItem | null>(null);
  const [detailTask, setDetailTask] = useState<KanbanTaskItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [filters, setFilters] = useState<KanbanFilterState>(DEFAULT_FILTERS);
  const [newColName, setNewColName] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // ── Derived data ──────────────────────────────────────────────────────────

  const allLabels = useMemo(() => {
    const map = new Map<string, TaskLabel>();
    for (const t of tasks) {
      for (const l of t.payload.labels ?? []) {
        if (!map.has(l.id)) map.set(l.id, l);
      }
    }
    return [...map.values()];
  }, [tasks]);

  const allAssignees = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.payload.assigned_to) set.add(t.payload.assigned_to);
    }
    return [...set].sort();
  }, [tasks]);

  // ── Filter tasks ──────────────────────────────────────────────────────────

  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (t) =>
          t.payload.title.toLowerCase().includes(q) ||
          (t.payload.description ?? '').toLowerCase().includes(q),
      );
    }
    if (filters.priority) {
      result = result.filter((t) => t.payload.priority === filters.priority);
    }
    if (filters.assignee) {
      result = result.filter((t) => t.payload.assigned_to === filters.assignee);
    }
    if (filters.labelId) {
      result = result.filter((t) =>
        (t.payload.labels ?? []).some((l) => l.id === filters.labelId),
      );
    }
    return result;
  }, [tasks, filters]);

  // ── Load tasks from DB ────────────────────────────────────────────────────

  const loadTasks = useCallback(async () => {
    try {
      const db = getWorkspaceDB();
      const rows = await db.select<
        { id: string; payload: string; created_at: string; updated_at: string }[]
      >(
        `SELECT id, payload, created_at, updated_at FROM base_entities
         WHERE type = 'task' AND deleted_at IS NULL ORDER BY created_at DESC`,
      );
      const items: KanbanTaskItem[] = rows.map((r) => {
        const p = JSON.parse(r.payload) as TaskPayload;
        return {
          id: r.id,
          payload: {
            title: p.title ?? '',
            description: p.description ?? '',
            description_json: p.description_json,
            status: p.status ?? 'todo',
            priority: p.priority ?? 'medium',
            due_date: p.due_date ?? null,
            assigned_to: p.assigned_to ?? null,
            file_hashes: p.file_hashes ?? [],
            column_id: p.column_id ?? p.status ?? 'todo',
            labels: p.labels ?? [],
            checklist: p.checklist ?? [],
            attachments: p.attachments ?? [],
            comments: p.comments ?? [],
          },
          created_at: r.created_at,
          updated_at: r.updated_at,
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

  // Reload on entity events
  useEffect(() => {
    const handler = (): void => void loadTasks();
    eventBus.on('entity:created', handler);
    eventBus.on('entity:deleted', handler);
    return () => {
      eventBus.off('entity:created', handler);
      eventBus.off('entity:deleted', handler);
    };
  }, [loadTasks]);

  // ── Create task ───────────────────────────────────────────────────────────

  const createTask = useCallback(
    async (columnId?: string) => {
      const title = newTaskTitle.trim();
      if (!title) return;

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const colId = columnId ?? columns[0]?.id ?? 'todo';
      const payload: TaskPayload = {
        title,
        description: '',
        status: 'todo',
        priority: 'medium',
        due_date: null,
        assigned_to: null,
        file_hashes: [],
        column_id: colId,
        labels: [],
        checklist: [],
        attachments: [],
        comments: [],
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
          { id, payload, created_at: now, updated_at: now },
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
    },
    [newTaskTitle, columns],
  );

  // ── Save task payload ─────────────────────────────────────────────────────

  const saveTask = useCallback(
    async (taskId: string, payload: TaskPayload) => {
      try {
        const db = getWorkspaceDB();
        const now = new Date().toISOString();
        await db.execute(
          `UPDATE base_entities SET payload = ?, updated_at = ? WHERE id = ?`,
          [JSON.stringify(payload), now, taskId],
        );
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, payload, updated_at: now } : t,
          ),
        );
        eventBus.emit('entity:updated', {
          entity: {
            id: taskId,
            type: 'task',
            payload,
            metadata: {},
            tags: [],
            parent_id: null,
            created_at: '',
            updated_at: now,
            deleted_at: null,
          },
        });
      } catch (err) {
        console.error('[tasks] save failed:', err);
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

  // ── Add / remove columns ─────────────────────────────────────────────────

  const addColumn = useCallback(() => {
    const name = newColName.trim();
    if (!name) return;
    const id = name.toLowerCase().replace(/\s+/g, '_');
    if (columns.some((c) => c.id === id)) return;
    setColumns((prev) => [...prev, { id, name, color: 'border-muted-foreground/40' }]);
    setNewColName('');
  }, [newColName, columns]);

  const removeColumn = useCallback(
    (colId: string) => {
      if (columns.length <= 1) return;
      setColumns((prev) => prev.filter((c) => c.id !== colId));
      // Move tasks from deleted column to first remaining column
      const firstCol = columns.find((c) => c.id !== colId);
      if (firstCol) {
        setTasks((prev) =>
          prev.map((t) =>
            t.payload.column_id === colId
              ? { ...t, payload: { ...t.payload, column_id: firstCol.id } }
              : t,
          ),
        );
      }
    },
    [columns],
  );

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
      let newColumnId: string | undefined;

      // Check if dropped over a column directly
      if (columns.some((c) => c.id === over.id)) {
        newColumnId = over.id as string;
      } else {
        // Dropped over another task — use that task's column
        const overTask = tasks.find((t) => t.id === over.id);
        if (overTask) newColumnId = overTask.payload.column_id;
      }

      if (!newColumnId) return;

      const task = tasks.find((t) => t.id === taskId);
      if (!task || task.payload.column_id === newColumnId) return;

      const updatedPayload = { ...task.payload, column_id: newColumnId };
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, payload: updatedPayload } : t,
        ),
      );
      void saveTask(taskId, updatedPayload);
    },
    [tasks, columns, saveTask],
  );

  // ── Group tasks by column ─────────────────────────────────────────────────

  const tasksByColumn = useCallback(
    (colId: string): KanbanTaskItem[] =>
      filteredTasks.filter((t) => t.payload.column_id === colId),
    [filteredTasks],
  );

  // ── Open task detail ──────────────────────────────────────────────────────

  const openDetail = useCallback(
    (taskId: string) => {
      const t = tasks.find((x) => x.id === taskId);
      if (t) {
        setDetailTask(t);
        setDetailOpen(true);
      }
    },
    [tasks],
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-4">
      {/* ── Top bar: New task + filters ─────────────────────────────── */}
      <div className="mb-4 flex flex-col gap-2">
        <div className="flex gap-2">
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
        <KanbanFilters
          filters={filters}
          onChange={setFilters}
          allLabels={allLabels}
          allAssignees={allAssignees}
        />
      </div>

      {/* ── Kanban columns ──────────────────────────────────────────── */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="flex flex-1 gap-4 overflow-x-auto pb-2">
          {columns.map((col) => (
            <KanbanColumnView
              key={col.id}
              column={col}
              tasks={tasksByColumn(col.id)}
              canRemove={columns.length > 1}
              onRemove={() => removeColumn(col.id)}
              onOpenTask={openDetail}
            />
          ))}

          {/* Add column */}
          <div className="flex min-w-[200px] flex-col items-center justify-start gap-2 pt-2">
            <Input
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addColumn()}
              placeholder="New column…"
              className="h-8 text-xs"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={addColumn}
              disabled={!newColName.trim()}
              className="w-full text-xs"
            >
              + Add Column
            </Button>
          </div>
        </div>

        <DragOverlay>
          {activeTask ? <KanbanCard task={activeTask} isOverlay /> : null}
        </DragOverlay>
      </DndContext>

      {/* ── Task detail panel ───────────────────────────────────────── */}
      <TaskDetailPanel
        task={detailTask}
        columns={columns}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onSave={saveTask}
        onDelete={deleteTask}
      />
    </div>
  );
}

// ── Kanban Column ─────────────────────────────────────────────────────────────

interface KanbanColumnViewProps {
  column: KanbanColumn;
  tasks: KanbanTaskItem[];
  canRemove: boolean;
  onRemove: () => void;
  onOpenTask: (id: string) => void;
}

function KanbanColumnView({
  column,
  tasks,
  canRemove,
  onRemove,
  onOpenTask,
}: KanbanColumnViewProps): React.ReactElement {
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
        <h3 className="text-sm font-semibold text-foreground">{column.name}</h3>
        <div className="flex items-center gap-1">
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {tasks.length}
          </span>
          {canRemove && (
            <button
              onClick={onRemove}
              className="text-muted-foreground hover:text-red-400 transition-colors"
              title="Remove column"
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <SortableContext
        items={tasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
          {tasks.map((task) => (
            <SortableKanbanCard
              key={task.id}
              task={task}
              onClick={() => onOpenTask(task.id)}
            />
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
