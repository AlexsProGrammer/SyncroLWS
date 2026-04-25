import * as React from 'react';
import type { AspectEditorProps } from '@/registry/ToolRegistry';
import type { HabitAspectData } from '@syncrohws/shared-types';
import { Input } from '@/ui/components/input';
import { Switch } from '@/ui/components/switch';
import { Button } from '@/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/select';

export function AspectEditor({ aspect, onChange, onRemove }: AspectEditorProps): React.ReactElement {
  const data = aspect.data as Partial<HabitAspectData>;
  const today = new Date().toISOString().slice(0, 10);
  const completedToday = (data.completions ?? {})[today] ?? 0;
  const target = data.target_count ?? 1;

  function bumpToday(delta: number): void {
    const next = Math.max(0, completedToday + delta);
    const completions = { ...(data.completions ?? {}), [today]: next };
    if (next === 0) delete completions[today];
    onChange({ completions });
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Frequency</label>
          <Select value={data.frequency ?? 'daily'} onValueChange={(v) => onChange({ frequency: v })}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Target / period</label>
          <Input
            type="number"
            min={1}
            value={data.target_count ?? 1}
            onChange={(e) => onChange({ target_count: Math.max(1, Number(e.target.value) || 1) })}
            className="h-9"
          />
        </div>
      </div>

      <div className="rounded-md border border-border p-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">Today</div>
          <div className="text-xs text-muted-foreground">{completedToday} / {target}</div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => bumpToday(-1)} disabled={completedToday === 0}>−</Button>
          <Button size="sm" onClick={() => bumpToday(1)}>+</Button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Archived</label>
        <Switch checked={data.archived ?? false} onCheckedChange={(v) => onChange({ archived: v })} />
      </div>

      <div className="pt-2 border-t border-border">
        <Button variant="destructive" size="sm" onClick={onRemove}>
          Remove habit aspect
        </Button>
      </div>
    </div>
  );
}
