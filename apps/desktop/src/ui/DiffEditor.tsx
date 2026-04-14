import React, { useState } from 'react';
import DiffMatchPatch from 'diff-match-patch';
import type { BaseEntity } from '@syncrohws/shared-types';

interface DiffEditorProps {
  local: BaseEntity;
  server: BaseEntity;
  onResolve: (resolved: BaseEntity) => void;
  onCancel: () => void;
}

type Side = 'local' | 'server' | 'merged';

const dmp = new DiffMatchPatch();

function payloadText(entity: BaseEntity): string {
  return JSON.stringify(entity.payload, null, 2);
}

/**
 * Highlights character-level diffs in a string.
 * Returns an array of React spans coloured by operation type.
 */
function renderDiff(text1: string, text2: string): React.ReactNode {
  const diffs = dmp.diff_main(text1, text2);
  dmp.diff_cleanupSemantic(diffs);
  return diffs.map(([op, text], i) => {
    if (op === DiffMatchPatch.DIFF_EQUAL) {
      return <span key={i}>{text}</span>;
    }
    if (op === DiffMatchPatch.DIFF_INSERT) {
      return (
        <span key={i} className="bg-green-500/20 text-green-700 dark:text-green-400">
          {text}
        </span>
      );
    }
    // DIFF_DELETE
    return (
      <span key={i} className="bg-red-500/20 text-red-700 line-through dark:text-red-400">
        {text}
      </span>
    );
  });
}

/**
 * Shows a side-by-side diff between local and server versions of an entity.
 * The user picks which version to keep (or accepts an auto-merge).
 */
export function DiffEditor({ local, server, onResolve, onCancel }: DiffEditorProps): React.ReactElement {
  const [choice, setChoice] = useState<Side>('local');

  const localText = payloadText(local);
  const serverText = payloadText(server);

  const handleResolve = (): void => {
    let resolved: BaseEntity;
    if (choice === 'local') {
      resolved = { ...local, updated_at: new Date().toISOString() };
    } else if (choice === 'server') {
      resolved = { ...server, updated_at: new Date().toISOString() };
    } else {
      // Simple 3-way merge attempt
      const [merged] = dmp.patch_apply(dmp.patch_make(localText, serverText), localText);
      resolved = {
        ...local,
        payload: JSON.parse(merged) as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      };
    }
    onResolve(resolved);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex w-full max-w-5xl flex-col rounded-xl border border-border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Sync Conflict</h2>
            <p className="text-sm text-muted-foreground">
              Entity <code className="font-mono text-xs">{local.id.slice(0, 8)}…</code> was modified
              on two different devices.
            </p>
          </div>
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1 text-sm hover:bg-muted"
          >
            Cancel
          </button>
        </div>

        {/* Diff columns */}
        <div className="grid flex-1 grid-cols-2 divide-x divide-border overflow-hidden">
          <div className="flex flex-col">
            <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Local version
            </div>
            <pre className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed">
              {renderDiff(serverText, localText)}
            </pre>
          </div>
          <div className="flex flex-col">
            <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Server version
            </div>
            <pre className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed">
              {renderDiff(localText, serverText)}
            </pre>
          </div>
        </div>

        {/* Resolution controls */}
        <div className="flex items-center gap-3 border-t border-border px-6 py-4">
          <span className="text-sm font-medium">Keep:</span>
          {(['local', 'server', 'merged'] as Side[]).map((s) => (
            <button
              key={s}
              onClick={() => setChoice(s)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                choice === s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
          <button
            onClick={handleResolve}
            className="ml-auto rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Resolve conflict
          </button>
        </div>
      </div>
    </div>
  );
}
