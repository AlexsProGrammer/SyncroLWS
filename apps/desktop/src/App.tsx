import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { CommandPalette } from './ui/CommandPalette';
import { DiffEditor } from './ui/DiffEditor';
import { Sidebar, useEnabledTools, type ActiveView } from './ui/Sidebar';
import { SettingsView } from './ui/SettingsView';
import { Toaster } from './ui/Toaster';
import { Separator } from './ui/components/separator';
import { EntityDetailSheetHost } from './ui/components/EntityDetailSheetHost';
import { AddAspectDialogHost } from './ui/components/AddAspectDialogHost';
import { getTool, getToolByEntityType } from './registry/ToolRegistry';
import { eventBus } from './core/events';
import { startBackupScheduler } from './core/backup';
import { useWorkspaceStore, type WorkspaceTool } from './store/workspaceStore';
import { useProfileStore } from './store/profileStore';
import { toast } from './ui/hooks/use-toast';

import type { BaseEntity } from '@syncrohws/shared-types';

interface ConflictState {
  local: BaseEntity;
  server: BaseEntity;
  resolve: (resolved: BaseEntity) => void;
}

export default function App(): React.ReactElement {
  // activeView is now a workspace tool INSTANCE UUID (or 'settings')
  const [activeView, setActiveView] = useState<ActiveView>('settings');
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const { enabledTools } = useEnabledTools();

  // Subscribe to workspace tools from the store (instance list)
  const workspaceTools = useWorkspaceStore((s) => s.workspaceTools);
  const loadWorkspaceTools = useWorkspaceStore((s) => s.loadWorkspaceTools);

  // Reload workspace tools when tool-added/removed events fire
  useEffect(() => {
    const handler = (): void => { void loadWorkspaceTools(); };
    eventBus.on('workspace:tool-added', handler);
    eventBus.on('workspace:tool-removed', handler);
    return () => {
      eventBus.off('workspace:tool-added', handler);
      eventBus.off('workspace:tool-removed', handler);
    };
  }, [loadWorkspaceTools]);

  // Map: instanceId -> toolId (for renderedView resolution)
  const instanceMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const wt of workspaceTools) m.set(wt.id, wt.tool_id);
    return m;
  }, [workspaceTools]);

  // Keep a ref to workspaceTools for use inside stable event handlers
  const workspaceToolsRef = useRef<WorkspaceTool[]>(workspaceTools);
  workspaceToolsRef.current = workspaceTools;

  const navigateTo = useCallback((id: ActiveView) => {
    setActiveView(id);
  }, []);

  // Keep a ref to enabledTools so event handlers always see current value
  const enabledToolsRef = useRef(enabledTools);
  enabledToolsRef.current = enabledTools;

  // If activeView is a legacy tool.id (not an instance UUID), resolve to first matching instance
  useEffect(() => {
    if (activeView === 'settings') return;
    if (instanceMap.has(activeView)) return; // already an instance UUID
    // It's a legacy tool.id string — find first matching instance
    const wt = workspaceTools.find((w) => w.tool_id === activeView);
    if (wt) {
      setActiveView(wt.id);
    } else if (workspaceTools.length > 0) {
      setActiveView(workspaceTools[0]!.id);
    }
  }, [activeView, instanceMap, workspaceTools]);

  // ── Stable one-time effect: keyboard, events, backup ──────────────────────
  useEffect(() => {
    // Ctrl+K / Cmd+K → command palette
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        eventBus.emit('nav:open-command-palette', undefined);
        return;
      }
      // Ctrl+1…9 → switch to tool by workspace shortcut config
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        const wts = workspaceToolsRef.current;
        for (const wt of wts) {
          try {
            const cfg = JSON.parse(wt.config || '{}');
            if (cfg.shortcut === e.key) {
              setActiveView(wt.id); // use instance UUID
              e.preventDefault();
              return;
            }
          } catch { /* skip */ }
        }
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);

    // nav:open-entity → switch to first workspace tool instance of the matching type
    const onOpenEntity = ({ type }: { id: string; type: BaseEntity['type'] }): void => {
      try {
        const tool = getToolByEntityType(type) ?? enabledToolsRef.current.find((t) => t.entityTypes?.includes(type));
        if (!tool) return;
        const wts = workspaceToolsRef.current;
        const wt = wts.find((w) => w.tool_id === tool.id);
        if (wt) setActiveView(wt.id);
      } catch (err) {
        console.error('[app] nav:open-entity failed:', err);
      }
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

    // Profile switch → reset active view to first workspace tool instance
    const onProfileSwitched = (): void => {
      const wts = workspaceToolsRef.current;
      setActiveView(wts[0]?.id ?? 'settings');
    };
    eventBus.on('profile:switched', onProfileSwitched);

    // Sync conflict overlay
    const onConflict = (event: { local: BaseEntity; server: BaseEntity; resolve: (r: BaseEntity) => void }): void => {
      setConflict({ local: event.local, server: event.server, resolve: event.resolve });
    };
    eventBus.on('sync:conflict', onConflict);

    // New workspace with seeded tools → auto-navigate to first instance UUID
    const onToolsSeeded = ({ firstInstanceId }: { firstInstanceId: string }): void => {
      setActiveView(firstInstanceId);
    };
    eventBus.on('workspace:tools-seeded', onToolsSeeded);

    return () => {
      window.removeEventListener('keydown', onKey);
      eventBus.off('nav:open-entity', onOpenEntity);
      eventBus.off('deeplink:received', onDeepLink);
      eventBus.off('sync:conflict', onConflict);
      eventBus.off('profile:switched', onProfileSwitched);
      eventBus.off('workspace:tools-seeded', onToolsSeeded);
      stopBackup();
    };
  }, []); // stable — no deps, uses refs for mutable state

  // Resolve the active view's component (memoized to avoid unnecessary remounts)
  const renderedView = useMemo(() => {
    if (activeView === 'settings') return <SettingsView />;
    // Resolve instance UUID → tool_id → component
    const toolId = instanceMap.get(activeView);
    const tool = toolId ? getTool(toolId) : getTool(activeView); // fallback for legacy strings
    if (tool) {
      const Component = tool.component;
      return <Component toolInstanceId={activeView} />;
    }
    return <SettingsView />;
  }, [activeView, instanceMap]);

  // Display name for the header
  const activeWt = workspaceTools.find((wt) => wt.id === activeView);
  const activeToolId = activeWt ? activeWt.tool_id : activeView;
  const headerTitle =
    activeView === 'settings'
      ? 'Settings'
      : (activeWt?.name ?? getTool(activeToolId)?.name ?? activeView).replace('-', ' ');

  const activeWorkspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === s.activeWorkspaceId),
  );
  const workspaceLoading = useWorkspaceStore((s) => s.loading);
  const profileSwitching = useProfileStore((s) => s.switching);
  const activeProfile = useProfileStore((s) =>
    s.profiles.find((p) => p.id === s.activeProfileId),
  );

  // Wire notification:show event bus → toast UI
  useEffect(() => {
    const onNotification = ({ title, body, type }: { title: string; body: string; type: 'info' | 'warning' | 'error' }): void => {
      const variant = type === 'error' ? 'destructive' as const
        : type === 'warning' ? 'warning' as const
        : 'default' as const;
      toast({ title, description: body, variant });
    };
    eventBus.on('notification:show', onNotification);
    return () => { eventBus.off('notification:show', onNotification); };
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <Sidebar active={activeView} onNavigate={navigateTo} />

      {/* ── Main content area ────────────────────────────────────────────── */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Breadcrumb header: Profile / Workspace / Tool */}
        <header className="flex h-12 shrink-0 items-center border-b border-border px-4 gap-1.5">
          {activeProfile && (
            <span className="header-breadcrumb-profile contents">
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                style={{ backgroundColor: activeProfile.color ?? '#6366f1' }}
              >
                {activeProfile.name[0]?.toUpperCase()}
              </span>
              <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                {activeProfile.name}
              </span>
              <Separator orientation="vertical" className="mx-1 h-4" />
            </span>
          )}
          {activeWorkspace && (
            <>
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: activeWorkspace.color }}
              />
              <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                {activeWorkspace.name}
              </span>
              <Separator orientation="vertical" className="mx-1 h-4" />
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
          {profileSwitching ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <svg className="h-8 w-8 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="60" strokeDashoffset="20" strokeLinecap="round" />
                </svg>
                <span className="text-sm">Switching profile…</span>
              </div>
            </div>
          ) : (
            renderedView
          )}
        </div>
      </main>

      {/* ── Global overlays ─────────────────────────────────────────────── */}
      <CommandPalette />
      <Toaster />
      <EntityDetailSheetHost />
      <AddAspectDialogHost />

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
