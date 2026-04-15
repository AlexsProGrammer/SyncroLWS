import React, { useEffect, useState, useCallback } from 'react';
import { CommandPalette } from './ui/CommandPalette';
import { DiffEditor } from './ui/DiffEditor';
import { Sidebar, useEnabledTools, type ActiveView } from './ui/Sidebar';
import { SettingsView } from './ui/SettingsView';
import { getTool, getToolByEntityType } from './registry/ToolRegistry';
import { eventBus } from './core/events';
import { startBackupScheduler } from './core/backup';
import { useWorkspaceStore } from './store/workspaceStore';
import type { BaseEntity } from '@syncrohws/shared-types';

interface ConflictState {
  local: BaseEntity;
  server: BaseEntity;
  resolve: (resolved: BaseEntity) => void;
}

export default function App(): React.ReactElement {
  const [activeView, setActiveView] = useState<ActiveView>('notes');
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const { enabledTools } = useEnabledTools();

  const navigateTo = useCallback((id: ActiveView) => {
    setActiveView(id);
  }, []);

  // If the active tool gets disabled, fall back to the first enabled tool or settings
  useEffect(() => {
    if (activeView === 'settings') return;
    const isActive = enabledTools.some((t) => t.id === activeView);
    if (!isActive) {
      setActiveView(enabledTools[0]?.id ?? 'settings');
    }
  }, [enabledTools, activeView]);

  useEffect(() => {
    // Ctrl+K / Cmd+K → command palette
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        eventBus.emit('nav:open-command-palette', undefined);
        return;
      }
      // Ctrl+1…9 → switch to tool by shortcut (dynamic from registry)
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const tool = enabledTools.find((t) => t.shortcut === e.key);
        if (tool) {
          e.preventDefault();
          setActiveView(tool.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);

    // nav:open-entity → switch to the matching tool
    const onOpenEntity = ({ type }: { id: string; type: BaseEntity['type'] }): void => {
      const tool = getToolByEntityType(type) ?? enabledTools.find((t) => t.entityTypes?.includes(type));
      if (tool) setActiveView(tool.id);
    };
    eventBus.on('nav:open-entity', onOpenEntity);

    // deeplink:received → parse syncrohws://entity/<type>/<id> and navigate
    const onDeepLink = ({ path, params }: { path: string; params: Record<string, string> }): void => {
      console.log('[deep-link] App received:', path, params);
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
  }, [enabledTools]);

  // Resolve the active view's component
  const renderView = (): React.ReactElement => {
    if (activeView === 'settings') return <SettingsView />;
    const tool = getTool(activeView);
    if (tool) {
      const Component = tool.component;
      return <Component />;
    }
    return <SettingsView />;
  };

  // Display name for the header
  const headerTitle =
    activeView === 'settings'
      ? 'Settings'
      : (getTool(activeView)?.name ?? activeView).replace('-', ' ');

  const activeWorkspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === s.activeWorkspaceId),
  );
  const workspaceLoading = useWorkspaceStore((s) => s.loading);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <Sidebar active={activeView} onNavigate={navigateTo} />

      {/* ── Main content area ────────────────────────────────────────────── */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar with workspace breadcrumb */}
        <header className="flex h-14 shrink-0 items-center border-b border-border px-4 gap-2">
          {activeWorkspace && (
            <>
              <span
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{ backgroundColor: activeWorkspace.color }}
              />
              <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                {activeWorkspace.name}
              </span>
              <span className="text-xs text-muted-foreground">/</span>
            </>
          )}
          <h1 className="text-sm font-medium text-foreground capitalize">
            {headerTitle}
          </h1>
          {workspaceLoading && (
            <span className="ml-auto text-xs text-muted-foreground animate-pulse">
              Loading…
            </span>
          )}
        </header>

        {/* Active view */}
        <div className="flex flex-1 overflow-auto">
          {renderView()}
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
