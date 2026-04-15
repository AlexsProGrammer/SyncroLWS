import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/ui/components/sheet';
import { Button } from '@/ui/components/button';
import { Input } from '@/ui/components/input';
import { Textarea } from '@/ui/components/textarea';
import { Badge } from '@/ui/components/badge';
import { Separator } from '@/ui/components/separator';
import { ScrollArea } from '@/ui/components/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/select';
import { cn } from '@/lib/utils';
import { getWorkspaceDB } from '@/core/db';
import { eventBus } from '@/core/events';
import type {
  TaskPayload,
  TaskLabel,
  ChecklistItem,
  TaskComment,
} from '@syncrohws/shared-types';
import type { KanbanTaskItem } from './KanbanCard';
import type { KanbanColumn } from './TasksView';

// ── Preset label colors ───────────────────────────────────────────────────────

const LABEL_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

// ── Component ─────────────────────────────────────────────────────────────────

interface TaskDetailPanelProps {
  task: KanbanTaskItem | null;
  columns: KanbanColumn[];
  open: boolean;
  onClose: () => void;
  onSave: (taskId: string, payload: TaskPayload) => void;
  onDelete: (taskId: string) => void;
}

export function TaskDetailPanel({
  task,
  columns,
  open,
  onClose,
  onSave,
  onDelete,
}: TaskDetailPanelProps): React.ReactElement {
  if (!task) return <></>;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-hidden flex flex-col">
        <TaskDetailInner
          task={task}
          columns={columns}
          onSave={onSave}
          onDelete={onDelete}
          onClose={onClose}
        />
      </SheetContent>
    </Sheet>
  );
}

// ── Inner form (ensures hook lifecycle matches open state) ────────────────────

interface InnerProps {
  task: KanbanTaskItem;
  columns: KanbanColumn[];
  onSave: (taskId: string, payload: TaskPayload) => void;
  onDelete: (taskId: string) => void;
  onClose: () => void;
}

function TaskDetailInner({
  task,
  columns,
  onSave,
  onDelete,
  onClose,
}: InnerProps): React.ReactElement {
  const p = task.payload;

  // Local state mirrors payload fields
  const [title, setTitle] = useState(p.title);
  const [status, setStatus] = useState(p.status ?? 'todo');
  const [priority, setPriority] = useState(p.priority ?? 'medium');
  const [columnId, setColumnId] = useState(p.column_id ?? 'todo');
  const [dueDate, setDueDate] = useState(p.due_date ?? '');
  const [assignedTo, setAssignedTo] = useState(p.assigned_to ?? '');
  const [labels, setLabels] = useState<TaskLabel[]>(p.labels ?? []);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(p.checklist ?? []);
  const [comments, setComments] = useState<TaskComment[]>(p.comments ?? []);
  const [newCheckItem, setNewCheckItem] = useState('');
  const [newComment, setNewComment] = useState('');
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState<string>(LABEL_COLORS[0] ?? '#ef4444');

  // Embedded TipTap for rich description
  const descEditor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Add a detailed description…' }),
    ],
    content: p.description_json ? (() => { try { return JSON.parse(p.description_json); } catch { return p.description || ''; } })() : (p.description || ''),
  });

  // ── Save handler ──────────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    const descText = descEditor?.getText({ blockSeparator: '\n\n' }) ?? '';
    const descJson = descEditor ? JSON.stringify(descEditor.getJSON()) : undefined;

    const payload: TaskPayload = {
      title,
      description: descText,
      description_json: descJson,
      status,
      priority,
      column_id: columnId,
      due_date: dueDate || null,
      assigned_to: assignedTo || null,
      file_hashes: p.file_hashes ?? [],
      labels,
      checklist,
      attachments: p.attachments ?? [],
      comments,
    };
    onSave(task.id, payload);
    onClose();
  }, [
    task.id, title, status, priority, columnId, dueDate, assignedTo,
    labels, checklist, comments, descEditor, p, onSave, onClose,
  ]);

  // ── Checklist helpers ─────────────────────────────────────────────────────
  const addCheckItem = useCallback(() => {
    const text = newCheckItem.trim();
    if (!text) return;
    setChecklist((prev) => [
      ...prev,
      { id: crypto.randomUUID(), text, checked: false },
    ]);
    setNewCheckItem('');
  }, [newCheckItem]);

  const toggleCheckItem = useCallback((itemId: string) => {
    setChecklist((prev) =>
      prev.map((c) => (c.id === itemId ? { ...c, checked: !c.checked } : c)),
    );
  }, []);

  const removeCheckItem = useCallback((itemId: string) => {
    setChecklist((prev) => prev.filter((c) => c.id !== itemId));
  }, []);

  // ── Label helpers ─────────────────────────────────────────────────────────
  const addLabel = useCallback(() => {
    const name = newLabelName.trim();
    if (!name) return;
    setLabels((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name, color: newLabelColor },
    ]);
    setNewLabelName('');
  }, [newLabelName, newLabelColor]);

  const removeLabel = useCallback((labelId: string) => {
    setLabels((prev) => prev.filter((l) => l.id !== labelId));
  }, []);

  // ── Comment helpers ───────────────────────────────────────────────────────
  const addComment = useCallback(() => {
    const text = newComment.trim();
    if (!text) return;
    setComments((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        author: '',
        text,
        created_at: new Date().toISOString(),
      },
    ]);
    setNewComment('');
  }, [newComment]);

  const checkedCount = checklist.filter((c) => c.checked).length;

  return (
    <>
      <SheetHeader>
        <SheetTitle className="sr-only">Task Details</SheetTitle>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title"
          className="border-0 bg-transparent p-0 text-lg font-semibold outline-none focus-visible:ring-0"
        />
      </SheetHeader>

      <ScrollArea className="flex-1 -mx-6 px-6">
        <div className="flex flex-col gap-4 py-4">
          {/* ── Status / Priority / Column row ─────────────────────── */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Status</label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskPayload['status'])}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todo">To Do</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Priority</label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPayload['priority'])}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Column</label>
              <Select value={columnId} onValueChange={setColumnId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {columns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── Due date / Assignee ─────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Due date</label>
              <Input
                type="datetime-local"
                value={dueDate ? dueDate.slice(0, 16) : ''}
                onChange={(e) => setDueDate(e.target.value ? new Date(e.target.value).toISOString() : '')}
                className="h-8 text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Assignee</label>
              <Input
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                placeholder="Unassigned"
                className="h-8 text-xs"
              />
            </div>
          </div>

          <Separator />

          {/* ── Labels ──────────────────────────────────────────────── */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Labels
            </h4>
            <div className="mb-2 flex flex-wrap gap-1">
              {labels.map((label) => (
                <button
                  key={label.id}
                  onClick={() => removeLabel(label.id)}
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white transition-opacity hover:opacity-70"
                  style={{ backgroundColor: label.color }}
                  title="Click to remove"
                >
                  {label.name} ×
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <Input
                value={newLabelName}
                onChange={(e) => setNewLabelName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addLabel()}
                placeholder="Label name"
                className="h-7 flex-1 text-xs"
              />
              <div className="flex gap-0.5">
                {LABEL_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewLabelColor(c)}
                    className={cn(
                      'h-5 w-5 rounded-full border-2 transition-transform',
                      newLabelColor === c ? 'scale-110 border-foreground' : 'border-transparent',
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={addLabel} className="h-7 px-2 text-xs">
                Add
              </Button>
            </div>
          </div>

          <Separator />

          {/* ── Description (TipTap) ────────────────────────────────── */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Description
            </h4>
            <EditorContent
              editor={descEditor}
              className="prose prose-sm dark:prose-invert max-w-none min-h-[80px] rounded-md border border-border p-2 text-sm"
            />
          </div>

          <Separator />

          {/* ── Checklist ───────────────────────────────────────────── */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Checklist
              </h4>
              {checklist.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {checkedCount}/{checklist.length}
                </span>
              )}
            </div>

            {checklist.length > 0 && (
              <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${(checkedCount / checklist.length) * 100}%` }}
                />
              </div>
            )}

            <div className="flex flex-col gap-1">
              {checklist.map((item) => (
                <div key={item.id} className="group flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={() => toggleCheckItem(item.id)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  <span
                    className={cn(
                      'flex-1 text-sm',
                      item.checked && 'text-muted-foreground line-through',
                    )}
                  >
                    {item.text}
                  </span>
                  <button
                    onClick={() => removeCheckItem(item.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-2 flex gap-1">
              <Input
                value={newCheckItem}
                onChange={(e) => setNewCheckItem(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCheckItem()}
                placeholder="Add item…"
                className="h-7 flex-1 text-xs"
              />
              <Button variant="ghost" size="sm" onClick={addCheckItem} className="h-7 px-2 text-xs">
                Add
              </Button>
            </div>
          </div>

          <Separator />

          {/* ── Activity / Comments ─────────────────────────────────── */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Activity
            </h4>
            <div className="flex flex-col gap-2">
              {comments.map((c) => (
                <div key={c.id} className="rounded border border-border/50 bg-muted/30 p-2">
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="font-medium">{c.author || 'You'}</span>
                    <span>·</span>
                    <span>{new Date(c.created_at).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-xs text-foreground">{c.text}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-1">
              <Input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addComment()}
                placeholder="Write a comment…"
                className="h-7 flex-1 text-xs"
              />
              <Button variant="ghost" size="sm" onClick={addComment} className="h-7 px-2 text-xs">
                Post
              </Button>
            </div>
          </div>
        </div>
      </ScrollArea>

      {/* ── Footer actions ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button
          variant="destructive"
          size="sm"
          onClick={() => { onDelete(task.id); onClose(); }}
        >
          Delete
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            Save
          </Button>
        </div>
      </div>
    </>
  );
}
