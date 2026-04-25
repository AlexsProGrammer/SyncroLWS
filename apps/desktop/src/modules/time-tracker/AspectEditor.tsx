import * as React from 'react';
import type { AspectEditorProps } from '@/registry/ToolRegistry';
import type { TimeLogAspectData } from '@syncrohws/shared-types';
import { Input } from '@/ui/components/input';
import { Switch } from '@/ui/components/switch';
import { Button } from '@/ui/components/button';

export function AspectEditor({ aspect, onChange, onRemove }: AspectEditorProps): React.ReactElement {
  const data = aspect.data as Partial<TimeLogAspectData>;

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Start</label>
          <Input
            type="datetime-local"
            value={data.start ? toLocalInput(data.start) : ''}
            onChange={(e) => onChange({ start: e.target.value ? new Date(e.target.value).toISOString() : new Date().toISOString() })}
            className="h-9"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">End</label>
          <Input
            type="datetime-local"
            value={data.end ? toLocalInput(data.end) : ''}
            onChange={(e) => onChange({ end: e.target.value ? new Date(e.target.value).toISOString() : null })}
            className="h-9"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Project</label>
        <Input
          value={data.project ?? ''}
          onChange={(e) => onChange({ project: e.target.value })}
          className="h-9"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Window title</label>
        <Input
          value={data.window_title ?? ''}
          onChange={(e) => onChange({ window_title: e.target.value })}
          className="h-9"
        />
      </div>

      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Billable</label>
        <Switch
          checked={data.billable ?? false}
          onCheckedChange={(v) => onChange({ billable: v })}
        />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Hourly rate (cents)</label>
        <Input
          type="number"
          min={0}
          value={data.hourly_rate_cents ?? 0}
          onChange={(e) => onChange({ hourly_rate_cents: Number(e.target.value) || 0 })}
          className="h-9"
        />
      </div>

      <div className="pt-2 border-t border-border">
        <Button variant="destructive" size="sm" onClick={onRemove}>
          Remove time-log aspect
        </Button>
      </div>
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 16);
}
