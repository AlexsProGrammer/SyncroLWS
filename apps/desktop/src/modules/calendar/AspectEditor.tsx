import * as React from 'react';
import type { AspectEditorProps } from '@/registry/ToolRegistry';
import type { CalendarEventAspectData } from '@syncrohws/shared-types';
import { Input } from '@/ui/components/input';
import { Switch } from '@/ui/components/switch';
import { Button } from '@/ui/components/button';

export function AspectEditor({ aspect, onChange, onRemove }: AspectEditorProps): React.ReactElement {
  const data = aspect.data as Partial<CalendarEventAspectData>;

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">All-day</label>
        <Switch
          checked={data.all_day ?? false}
          onCheckedChange={(v) => onChange({ all_day: v })}
        />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Start</label>
        <Input
          type={data.all_day ? 'date' : 'datetime-local'}
          value={data.start ? toLocalInput(data.start, !!data.all_day) : ''}
          onChange={(e) =>
            onChange({ start: e.target.value ? new Date(e.target.value).toISOString() : new Date().toISOString() })
          }
          className="h-9"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">End</label>
        <Input
          type={data.all_day ? 'date' : 'datetime-local'}
          value={data.end ? toLocalInput(data.end, !!data.all_day) : ''}
          onChange={(e) =>
            onChange({ end: e.target.value ? new Date(e.target.value).toISOString() : new Date().toISOString() })
          }
          className="h-9"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Location</label>
        <Input
          value={data.location ?? ''}
          onChange={(e) => onChange({ location: e.target.value })}
          className="h-9"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Recurrence (RRULE)</label>
        <Input
          value={data.recurrence_rule ?? ''}
          onChange={(e) => onChange({ recurrence_rule: e.target.value || null })}
          placeholder="FREQ=WEEKLY;BYDAY=MO,WE,FR"
          className="h-9 font-mono text-xs"
        />
      </div>

      <div className="pt-2 border-t border-border">
        <Button variant="destructive" size="sm" onClick={onRemove}>
          Remove calendar aspect
        </Button>
      </div>
    </div>
  );
}

function toLocalInput(iso: string, dateOnly: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return dateOnly ? local.toISOString().slice(0, 10) : local.toISOString().slice(0, 16);
}
