import * as React from 'react';
import type { AspectEditorProps } from '@/registry/ToolRegistry';
import type { PomodoroAspectData } from '@syncrohws/shared-types';
import { Input } from '@/ui/components/input';
import { Button } from '@/ui/components/button';

export function AspectEditor({ aspect, onChange, onRemove }: AspectEditorProps): React.ReactElement {
  const data = aspect.data as Partial<PomodoroAspectData>;

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Focus minutes</label>
          <Input
            type="number"
            min={1}
            value={data.focus_minutes ?? 25}
            onChange={(e) => onChange({ focus_minutes: Math.max(1, Number(e.target.value) || 25) })}
            className="h-9"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Short break</label>
          <Input
            type="number"
            min={1}
            value={data.short_break_minutes ?? 5}
            onChange={(e) => onChange({ short_break_minutes: Math.max(1, Number(e.target.value) || 5) })}
            className="h-9"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Long break</label>
          <Input
            type="number"
            min={1}
            value={data.long_break_minutes ?? 15}
            onChange={(e) => onChange({ long_break_minutes: Math.max(1, Number(e.target.value) || 15) })}
            className="h-9"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Intervals before long</label>
          <Input
            type="number"
            min={1}
            value={data.intervals_before_long ?? 4}
            onChange={(e) => onChange({ intervals_before_long: Math.max(1, Number(e.target.value) || 4) })}
            className="h-9"
          />
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Phase: <strong>{data.phase ?? 'idle'}</strong> · Completed sessions:{' '}
        <strong>{data.completed_sessions ?? 0}</strong>
      </div>

      <div className="pt-2 border-t border-border">
        <Button variant="destructive" size="sm" onClick={onRemove}>
          Remove pomodoro aspect
        </Button>
      </div>
    </div>
  );
}
