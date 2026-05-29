import React, { useState, useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentProfileId, getCurrentWorkspaceId } from '@/core/db';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CSVImportZoneProps {
  /** Called after a successful import so the parent can refresh the dataset list. */
  onComplete: () => void;
}

type ImportState =
  | { status: 'idle' }
  | { status: 'importing'; fileName: string }
  | { status: 'done'; fileName: string; rowCount: number }
  | { status: 'error'; message: string };

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Renders a compact "Import CSV" button that:
 * 1. Opens the native OS file picker (CSV filter, Tauri dialog plugin).
 * 2. Generates a UUID to identify the new dataset.
 * 3. Resolves the active workspace DB path and calls the Rust command
 *    `stream_csv_to_sqlite` — all heavy I/O stays off the JS thread.
 * 4. Calls `onComplete` on success so the parent reloads the dataset list.
 *
 * All processing is strictly local — no data leaves the device (DSGVO).
 */
export function CSVImportZone({ onComplete }: CSVImportZoneProps): React.ReactElement {
  const [state, setState] = useState<ImportState>({ status: 'idle' });

  const handleImport = useCallback(async () => {
    // Open native OS file picker — restricted to CSV files, no multi-select
    const selected = await open({
      multiple: false,
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    });

    // User cancelled or dialog returned nothing
    if (!selected || typeof selected !== 'string') return;

    const filePath = selected;
    // Derive a display name from the path for status messages
    const fileName = filePath.split(/[\\/]/).pop() ?? filePath;

    console.log(`[analytics] file selected: ${fileName}`);

    const profileId = getCurrentProfileId();
    const workspaceId = getCurrentWorkspaceId();

    if (!profileId || !workspaceId) {
      setState({
        status: 'error',
        message: 'No active workspace. Open a workspace first.',
      });
      return;
    }

    // Generate a collision-resistant UUID for this dataset
    const datasetId = crypto.randomUUID();

    setState({ status: 'importing', fileName });
    console.log(`[analytics] importing → dataset ${datasetId}`);

    try {
      // Resolve absolute workspace root path, then build the SQLite path
      const workspacePath = await invoke<string>('get_workspace_path', {
        profileUuid: profileId,
        workspaceUuid: workspaceId,
      });
      const dbPath = `${workspacePath}/data.sqlite`;

      // Hand the CSV streaming work off to the Rust thread — UI stays free
      const rowCount = await invoke<number>('stream_csv_to_sqlite', {
        filePath,
        datasetId,
        dbPath,
      });

      console.log(`[analytics] import complete: ${rowCount} rows → ${datasetId}`);
      setState({ status: 'done', fileName, rowCount });
      onComplete();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[analytics] import failed:', err);
      setState({ status: 'error', message });
    }
  }, [onComplete]);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void handleImport()}
        disabled={state.status === 'importing'}
        className={cn(
          'w-full flex items-center justify-center gap-1.5 rounded-md px-3 py-2',
          'text-xs font-medium transition-colors',
          state.status === 'importing'
            ? 'bg-muted text-muted-foreground cursor-not-allowed'
            : 'bg-primary text-primary-foreground hover:bg-primary/90',
        )}
      >
        {state.status === 'importing' ? (
          <>
            <SpinnerIcon className="w-3 h-3 animate-spin" />
            Importing…
          </>
        ) : (
          <>
            <UploadIcon className="w-3 h-3" />
            Import CSV
          </>
        )}
      </button>

      {state.status === 'importing' && (
        <p className="text-xs text-muted-foreground truncate px-1" title={state.fileName}>
          {state.fileName}
        </p>
      )}

      {state.status === 'done' && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 px-1">
          ✓ {state.rowCount.toLocaleString()} rows imported
        </p>
      )}

      {state.status === 'error' && (
        <p className="text-xs text-destructive px-1 break-words">{state.message}</p>
      )}
    </div>
  );
}

// ── Inline SVG icons (no external CDN — DSGVO compliant) ─────────────────────

function UploadIcon({ className }: { className?: string }): React.ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }): React.ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
