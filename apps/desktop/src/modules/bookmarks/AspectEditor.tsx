import * as React from 'react';
import type { AspectEditorProps } from '@/registry/ToolRegistry';
import type { BookmarkAspectData } from '@syncrohws/shared-types';
import { Input } from '@/ui/components/input';
import { Switch } from '@/ui/components/switch';
import { Button } from '@/ui/components/button';

export function AspectEditor({ aspect, onChange, onRemove }: AspectEditorProps): React.ReactElement {
  const data = aspect.data as Partial<BookmarkAspectData>;

  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <label className="text-xs font-medium text-muted-foreground">URL</label>
        <Input
          type="url"
          value={data.url ?? ''}
          onChange={(e) => onChange({ url: e.target.value })}
          placeholder="https://…"
          className="h-9"
        />
      </div>

      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Pinned</label>
        <Switch
          checked={data.pinned ?? false}
          onCheckedChange={(v) => onChange({ pinned: v })}
        />
      </div>

      {data.url && (
        <a
          href={data.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-primary underline truncate"
        >
          Open in browser ↗
        </a>
      )}

      <div className="pt-2 border-t border-border">
        <Button variant="destructive" size="sm" onClick={onRemove}>
          Remove bookmark aspect
        </Button>
      </div>
    </div>
  );
}
