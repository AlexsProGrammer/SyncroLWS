import React, { useEffect } from 'react';
import { CommandPalette } from './ui/CommandPalette';
import { eventBus } from './core/events';
import { startBackupScheduler } from './core/backup';

export default function App(): React.ReactElement {
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

    return () => {
      window.removeEventListener('keydown', handler);
      stopBackup();
    };
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Global Command Palette overlay — always mounted */}
      <CommandPalette />

      {/* Module views will be rendered here via routing (Phase 5+) */}
      <main className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm">SyncroLWS — press Ctrl+K to begin</p>
      </main>
    </div>
  );
}
