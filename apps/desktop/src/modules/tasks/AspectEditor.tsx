import * as React from 'react';
import type { AspectEditorProps } from '@/registry/ToolRegistry';
import type { TaskAspectData } from '@syncrohws/shared-types';
import { Input } from '@/ui/components/input';
import { Textarea } from '@/ui/components/textarea';
import { Button } from '@/ui/components/button';
import { toLocalInput } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/select';

const STATUSES: TaskAspectData['status'][] = ['todo', 'in_progress', 'done', 'cancelled'];
const PRIORITIES: TaskAspectData['priority'][] = ['low', 'medium', 'high', 'urgent'];

export function AspectEditor({ aspect, onChange, onRemove }: AspectEditorProps): React.ReactElement {
  const data = aspect.data as Partial<TaskAspectData>;

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-xs font-medium text-muted-foreground">Status</label>
          <Select
            value={data.status ?? 'todo'}
            onValueChange={(v) => onChange({ status: v })}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace('_', ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1">
          <label className="text-xs font-medium text-muted-foreground">Priority</label>
          <Select
            value={data.priority ?? 'medium'}
            onValueChange={(v) => onChange({ priority: v })}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Due date</label>
        <Input
          type="datetime-local"
          value={data.due_date ? toLocalInput(data.due_date) : ''}
          onChange={(e) => onChange({ due_date: e.target.value ? new Date(e.target.value).toISOString() : null })}
          className="h-9"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Column id</label>
        <Input
          value={data.column_id ?? 'todo'}
          onChange={(e) => onChange({ column_id: e.target.value })}
          className="h-9"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Checklist</label>
        <Textarea
          value={(data.checklist ?? []).map((c) => `${c.checked ? '[x]' : '[ ]'} ${c.text}`).join('\n')}
          onChange={(e) => {
            const lines = e.target.value.split('\n').filter((l) => l.trim());
            const items = lines.map((l, i) => {
              const m = l.match(/^\s*\[([ xX])\]\s*(.*)$/);
              return {
                id: data.checklist?.[i]?.id ?? crypto.randomUUID(),
                text: m ? (m[2] ?? '') : l,
                checked: m ? m[1]?.toLowerCase() === 'x' : false,
              };
            });
            onChange({ checklist: items });
          }}
          rows={4}
          placeholder="[ ] item one\n[x] item two"
          className="font-mono text-xs"
        />
      </div>

      <div className="pt-2 border-t border-border">
        <Button variant="destructive" size="sm" onClick={onRemove}>
          Remove task aspect
        </Button>
      </div>
    </div>
  );
}
