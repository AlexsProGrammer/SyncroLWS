import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { eventBus } from '@/core/events';
import {
  createEntity,
  listByAspect,
  softDeleteEntity,
  updateAspect,
} from '@/core/entityStore';
import { Button } from '@/ui/components/button';
import { Input } from '@/ui/components/input';
import { EntityRowContextMenu } from '@/ui/components/EntityRowContextMenu';
import { cn } from '@/lib/utils';
import type { TaskAspectData, TaskLabel } from '@syncrohws/shared-types';
import { KanbanCard, SortableKanbanCard, type KanbanTaskItem } from './KanbanCard';
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

function dataOf(item: KanbanTaskItem): Partial<TaskAspectData> {
  return item.aspect.data as Partial<TaskAspectData>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TasksView({ toolInstanceId }: { toolInstanceId?: string }): React.ReactElement {
  const [tasks, setTasks] = useState<KanbanTaskItem[]>([]);
  const [columns, setColumns] = useState<KanbanColumn[]>(DEFAULT_COLUMNS);
  const [activeTask, setActiveTask] = useState<KanbanTaskItem | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [filters, setFilters] = useState<KanbanFilterState>(DEFAULT_FILTERS);
  const [newColName, setNewColName] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // ── Derived ───────────────────────────────────────────────────────────────

  const allLabels = useMemo(() => {
    const map = new Map<string, TaskLabel>();
    for (const t of tasks) {
      for (const l of dataOf(t).labels ?? []) {
        if (!map.has(l.id)) map.set(l.id, l);
      }
    }
    return [...map.values()];
  }, [tasks]);

  const allAssignees = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      const a = dataOf(t).assigned_to;
      if (a) set.add(a);
    }
    return [...set].sort();
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (t) =>
          t.core.title.toLowerCase().includes(q) ||
          t.core.description.toLowerCase().includes(q),
      );
    }
    if (filters.priority) {
      result = result.filter((t) => dataOf(t).priority === filters.priority);
    }
    if (filters.assignee) {
      result = result.filter((t) => dataOf(t).assigned_to === filters.assignee);
    }
    if (filters.labelId) {
      result = result.filter((t) =>
        (dataOf(t).labels ?? []).some((l) => l.id === filters.labelId),
      );
    }
    return result;
  }, [tasks, filters]);

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadTasks = useCallback(async () => {
    try {
      const items = await listByAspect('task', { tool_instance_id: toolInstanceId ?? null });
      setTasks(items);
    } catch (err) {
      console.error('[tasks] load failed:', err);
    }
  }, [toolInstanceId]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    const onChange = (): void => void loadTasks();
    eventBus.on('core:created', onChange);
    eventBus.on('core:updated', onChange);
    eventBus.on('core:deleted', onChange);
    eventBus.on('aspect:added', onChange);
    eventBus.on('aspect:updated', onChange);
    eventBus.on('aspect:removed', onChange);
    eventBus.on('entity:created', onChange);
    eventBus.on('entity:updated', onChange);
    eventBus.on('entity:deleted', onChange);
    return () => {
      eventBus.off('core:created', onChange);
      eventBus.off('core:updated', onChange);
      eventBus.off('core:deleted', onChange);
      eventBus.off('aspect:added', onChange);
      eventBus.off('aspect:updated', onChange);
      eventBus.off('aspect:removed', onChange);
      eventBus.off('entity:created', onChange);
      eventBus.off('entity:updated', onChange);
      eventBus.off('entity:deleted', onChange);
    };
  }, [loadTasks]);

  // ── Open detail (shared sheet) ────────────────────────────────────────────

  const openDetail = useCallback((id: string) => {
    eventBus.emit('nav:open-detail-sheet', { id, initialAspectType: 'task' });
  }, []);

  useEffect(() => {
    const onNav = ({ id, type }: { id: string; type: string }): void => {
      if (type === 'task') openDetail(id);
    };
    eventBus.on('nav:open-entity', onNav);
    return () => {
      eventBus.off('nav:open-entity', onNav);
    };
  }, [openDetail]);

  // ── Create ────────────────────────────────────────────────────────────────

  const createTask = useCallback(
    async (columnId?: string) => {
      const title = newTaskTitle.trim();
      if (!title) return;
      const colId = columnId ?? columns[0]?.id ?? 'todo';
      try {
        await createEntity({
          core: { title },
          aspects: [
            {
              aspect_type: 'task',
              data: {
                status: 'todo',
                priority: 'medium',
                column_id: colId,
              },
              tool_instance_id: toolInstanceId ?? null,
            },
          ],
        });
        setNewTaskTitle('');
      } catch (err) {
        console.error('[tasks] create failed:', err);
      }
    },
    [newTaskTitle, columns, toolInstanceId],
  );

  // ── Delete ────────────────────────────────────────────────────────────────

  const deleteTask = useCallback(async (id: string) => {
    try {
      await softDeleteEntity(id);
      setTasks((prev) => prev.filter((t) => t.core.id !== id));
    } catch (err) {
      console.error('[tasks] delete failed:', err);
    }
  }, []);

  // ── Columns ──────────────────────────────────────────────────────────────

  const addColumn = useCallback(() => {
    const name = newColName.trim();
    if (!name) return;
    const id = name.toLowerCase().replace(/\s+/g, '_');
    if (columns.some((c) => c.id === id)) return;
    setColumns((prev) => [...prev, { id, name, color: 'border-muted-foreground/40' }]);
    setNewColName('');
  }, [newColName, columns]);

  const removeColumn = useCallback(
    async (colId: string) => {
      if (columns.length <= 1) return;
      const firstCol = columns.find((c) => c.id !== colId);
      if (!firstCol) return;
      setColumns((prev) => prev.filter((c) => c.id !== colId));
      // Reassign tasks in the deleted column
      const toReassign = tasks.filter((t) => dataOf(t).column_id === colId);
      for (const t of toReassign) {
        try {
          await updateAspect(t.aspect.id, { data: { column_id: firstCol.id } });
        } catch (err) {
          console.error('[tasks] column reassign failed:', err);
        }
      }
    },
    [columns, tasks],
  );

  // ── Drag ─────────────────────────────────────────────────────────────────

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = tasks.find((t) => t.core.id === event.active.id);
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

      if (columns.some((c) => c.id === over.id)) {
        newColumnId = over.id as string;
      } else {
        const overTask = tasks.find((t) => t.core.id === over.id);
        if (overTask) newColumnId = dataOf(overTask).column_id;
      }
      if (!newColumnId) return;

      const task = tasks.find((t) => t.core.id === taskId);
      if (!task || dataOf(task).column_id === newColumnId) return;

      // Optimistic update
      setTasks((prev) =>
        prev.map((t) =>
          t.core.id === taskId
            ? { ...t, aspect: { ...t.aspect, data: { ...t.aspect.data, column_id: newColumnId } } }
            : t,
        ),
      );
      void updateAspect(task.aspect.id, { data: { column_id: newColumnId } }).catch((err) =>
        console.error('[tasks] drag save failed:', err),
      );
    },
    [tasks, columns],
  );

  const tasksByColumn = useCallback(
    (colId: string): KanbanTaskItem[] =>
      filteredTasks.filter((t) => (dataOf(t).column_id ?? 'todo') === colId),
    [filteredTasks],
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-4">
      {/* ── Top bar ───────────────────────────────────────────────── */}
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

      {/* ── Kanban columns ────────────────────────────────────────── */}
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
              onRemove={() => void removeColumn(col.id)}
              onOpenTask={openDetail}
              onDeleteTask={deleteTask}
            />
          ))}

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

        <DragOverlay>{activeTask ? <KanbanCard item={activeTask} isOverlay /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}

// ── Column ────────────────────────────────────────────────────────────────────

interface KanbanColumnViewProps {
  column: KanbanColumn;
  tasks: KanbanTaskItem[];
  canRemove: boolean;
  onRemove: () => void;
  onOpenTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
}

function KanbanColumnView({
  column,
  tasks,
  canRemove,
  onRemove,
  onOpenTask,
  onDeleteTask,
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

      <SortableContext items={tasks.map((t) => t.core.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
          {tasks.map((task) => (
            <EntityRowContextMenu
              key={task.core.id}
              entityId={task.core.id}
              existingTypes={['task']}
              openInitialAspectType="task"
              onDelete={() => onDeleteTask(task.core.id)}
            >
            <div className="group/card relative">
              <SortableKanbanCard item={task} onClick={() => onOpenTask(task.core.id)} />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteTask(task.core.id);
                }}
                className="absolute right-1 top-1 hidden rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-500 group-hover/card:block"
                title="Delete entity"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            </EntityRowContextMenu>
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
