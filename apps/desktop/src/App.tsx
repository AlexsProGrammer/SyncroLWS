import React, { useEffect, useState, useCallback } from 'react';
import { CommandPalette } from './ui/CommandPalette';
import { DiffEditor } from './ui/DiffEditor';
import { Sidebar, type ModuleId } from './ui/Sidebar';
import { NotesView, TasksView, CalendarView, TimeTrackerView } from './ui/ModuleViews';
import { eventBus } from './core/events';
import { startBackupScheduler } from './core/backup';
import type { BaseEntity } from '@syncrohws/shared-types';

interface ConflictState {
  local: BaseEntity;
  server: BaseEntity;
  resolve: (resolved: BaseEntity) => void;
}

const MODULE_VIEWS: Record<ModuleId, React.ReactElement> = {
  notes: <NotesView />,
  tasks: <TasksView />,
  calendar: <CalendarView />,
  'time-tracker': <TimeTrackerView />,
};

export default function App(): React.ReactElement {
  const [activeModule, setActiveModule] = useState<ModuleId>('notes');
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  const navigateTo = useCallback((id: ModuleId) => {
    setActiveModule(id);
  }, []);

  useEffect(() => {
    // Ctrl+K / Cmd+K → command palette
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        eventBus.emit('nav:open-command-palette', undefined);
        return;
      }
      // Ctrl+1…4 → switch module
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const map: Record<string, ModuleId> = {
          '1': 'notes',
          '2': 'tasks',
          '3': 'calendar',
          '4': 'time-tracker',
        };
        if (map[e.key]) {
          e.preventDefault();
          setActiveModule(map[e.key] as ModuleId);
        }
      }
    };
    window.addEventListener('keydown', onKey);

    // nav:open-entity → switch to the matching module
    const onOpenEntity = ({ type }: { id: string; type: BaseEntity['type'] }): void => {
      const moduleMap: Partial<Record<BaseEntity['type'], ModuleId>> = {
        note: 'notes',
        task: 'tasks',
        calendar_event: 'calendar',
        time_log: 'time-tracker',
      };
      const mod = moduleMap[type];
      if (mod) setActiveModule(mod);
    };
    eventBus.on('nav:open-entity', onOpenEntity);

    // deeplink:received → parse syncrohws://entity/<type>/<id> and navigate
    const onDeepLink = ({ path, params }: { path: string; params: Record<string, string> }): void => {
      console.log('[deep-link] App received:', path, params);
      // Pattern: /entity/<type>/<id>
      const match = path.match(/^\/entity\/([^/]+)\/([^/]+)/);
      if (match && match[1] && match[2]) {
        const type = match[1] as BaseEntity['type'];
        const id = match[2];
        eventBus.emit('nav:open-entity', { id, type });
      }
    };
    eventBus.on('deeplink:received', onDeepLink);

    // Backup scheduler
    const stopBackup = startBackupScheduler();

    // Sync conflict overlay
    const onConflict = (event: { local: BaseEntity; server: BaseEntity; resolve: (r: BaseEntity) => void }): void => {
      setConflict({ local: event.local, server: event.server, resolve: event.resolve });
    };
    eventBus.on('sync:conflict', onConflict);

    return () => {
      window.removeEventListener('keydown', onKey);
      eventBus.off('nav:open-entity', onOpenEntity);
      eventBus.off('deeplink:received', onDeepLink);
      eventBus.off('sync:conflict', onConflict);
      stopBackup();
    };
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <Sidebar active={activeModule} onNavigate={navigateTo} />

      {/* ── Main content area ────────────────────────────────────────────── */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center border-b border-border px-4">
          <h1 className="text-sm font-medium text-foreground capitalize">
            {activeModule.replace('-', ' ')}
          </h1>
        </header>

        {/* Active module view */}
        <div className="flex flex-1 overflow-auto">
          {MODULE_VIEWS[activeModule]}
        </div>
      </main>

      {/* ── Global overlays ─────────────────────────────────────────────── */}
      <CommandPalette />

      {conflict && (
        <DiffEditor
          local={conflict.local}
          server={conflict.server}
          onResolve={(resolved) => {
            conflict.resolve(resolved);
            setConflict(null);
          }}
          onCancel={() => setConflict(null)}
        />
      )}
    </div>
  );
}
