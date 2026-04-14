import React, { useEffect, useState } from 'react';
import { CommandPalette } from './ui/CommandPalette';
import { DiffEditor } from './ui/DiffEditor';
import { eventBus } from './core/events';
import { startBackupScheduler } from './core/backup';
import type { BaseEntity } from '@syncrohws/shared-types';

interface ConflictState {
  local: BaseEntity;
  server: BaseEntity;
  resolve: (resolved: BaseEntity) => void;
}

export default function App(): React.ReactElement {
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  useEffect(() => {
    // Register Ctrl+K / Cmd+K globally
    const handler = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        eventBus.emit('nav:open-command-palette', undefined);
      }
    };
    window.addEventListener('keydown', handler);

    // Start background backup scheduler
    const stopBackup = startBackupScheduler();

    // Listen for sync conflicts → show DiffEditor
    const handleConflict = (event: { local: BaseEntity; server: BaseEntity; resolve: (resolved: BaseEntity) => void }): void => {
      setConflict({ local: event.local, server: event.server, resolve: event.resolve });
    };
    eventBus.on('sync:conflict', handleConflict);

    return () => {
      window.removeEventListener('keydown', handler);
      stopBackup();
      eventBus.off('sync:conflict', handleConflict);
    };
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Global Command Palette overlay — always mounted */}
      <CommandPalette />

      {/* Sync conflict resolution overlay */}
      {conflict && (
        <DiffEditor
          local={conflict.local}
          server={conflict.server}
          onResolve={(resolved) => {
            conflict.resolve(resolved);
            console.log('[App] conflict resolved:', resolved);
            setConflict(null);
          }}
          onCancel={() => setConflict(null)}
        />
      )}

      {/* Module views will be rendered here via routing (Phase 6+) */}
      <main className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm">SyncroLWS — press Ctrl+K to begin</p>
      </main>
    </div>
  );
}
