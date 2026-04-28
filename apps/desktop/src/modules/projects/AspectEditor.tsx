import * as React from 'react';
import type { AspectEditorProps } from '@/registry/ToolRegistry';
import type { ProjectAspectData } from '@syncrohws/shared-types';
import { Input } from '@/ui/components/input';
import { Button } from '@/ui/components/button';
import { Badge } from '@/ui/components/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/select';

type Milestone = ProjectAspectData['milestones'][number];

const STATUS_OPTIONS: ProjectAspectData['status'][] = ['active', 'on_hold', 'completed', 'archived'];

function newId(): string {
  // RFC4122-ish lite — fine for client-side milestone ids.
  return 'm_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

function fromDateInputValue(v: string): string | null {
  if (!v) return null;
  // Store as ISO datetime at midnight UTC.
  const d = new Date(v + 'T00:00:00.000Z');
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function AspectEditor({ aspect, onChange, onRemove }: AspectEditorProps): React.ReactElement {
  const data = aspect.data as Partial<ProjectAspectData>;
  const milestones: Milestone[] = Array.isArray(data.milestones) ? data.milestones : [];

  function patchMilestones(next: Milestone[]): void {
    onChange({ milestones: next });
  }

  function addMilestone(): void {
    patchMilestones([
      ...milestones,
      { id: newId(), label: 'New milestone', done: false, due_date: null },
    ]);
  }

  function updateMilestone(id: string, patch: Partial<Milestone>): void {
    patchMilestones(milestones.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function removeMilestone(id: string): void {
    patchMilestones(milestones.filter((m) => m.id !== id));
  }

  const doneCount = milestones.filter((m) => m.done).length;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Status</label>
          <Select
            value={data.status ?? 'active'}
            onValueChange={(v) => onChange({ status: v as ProjectAspectData['status'] })}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace('_', ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Due date</label>
          <Input
            type="date"
            value={toDateInputValue(data.due_date)}
            onChange={(e) => onChange({ due_date: fromDateInputValue(e.target.value) })}
            className="h-9"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Owner / responsible</label>
        <Input
          value={data.owner_label ?? ''}
          onChange={(e) => onChange({ owner_label: e.target.value })}
          placeholder="Name or team"
          className="h-9"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground">Milestones</label>
            {milestones.length > 0 && (
              <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                {doneCount}/{milestones.length}
              </Badge>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={addMilestone}>
            + Add
          </Button>
        </div>

        {milestones.length === 0 ? (
          <p className="text-xs text-muted-foreground">No milestones yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {milestones.map((m) => (
              <li key={m.id} className="flex items-center gap-2 px-2 py-1.5">
                <input
                  type="checkbox"
                  checked={m.done}
                  onChange={(e) => updateMilestone(m.id, { done: e.target.checked })}
                  className="h-4 w-4"
                />
                <Input
                  value={m.label}
                  onChange={(e) => updateMilestone(m.id, { label: e.target.value })}
                  className="h-8 flex-1"
                />
                <Input
                  type="date"
                  value={toDateInputValue(m.due_date)}
                  onChange={(e) => updateMilestone(m.id, { due_date: fromDateInputValue(e.target.value) })}
                  className="h-8 w-36"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => removeMilestone(m.id)}
                  title="Remove milestone"
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pt-2 border-t border-border">
        <Button variant="destructive" size="sm" onClick={onRemove}>
          Remove project aspect
        </Button>
      </div>
    </div>
  );
}
