import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { CommandPalette } from './ui/CommandPalette';
import { DiffEditor } from './ui/DiffEditor';
import { Sidebar, useEnabledTools, type ActiveView } from './ui/Sidebar';
import { SettingsView } from './ui/SettingsView';
import { Toaster } from './ui/Toaster';
import { Separator } from './ui/components/separator';
import { EntityDetailSheetHost } from './ui/components/EntityDetailSheetHost';
import { getTool, getToolByEntityType } from './registry/ToolRegistry';
import { eventBus } from './core/events';
import { startBackupScheduler } from './core/backup';
import { useWorkspaceStore } from './store/workspaceStore';
import { useProfileStore } from './store/profileStore';
import { toast } from './ui/hooks/use-toast';
import { getWorkspaceDB } from './core/db';
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

  // Keep a ref to enabledTools so event handlers always see current value
  const enabledToolsRef = useRef(enabledTools);
  enabledToolsRef.current = enabledTools;

  // If the active tool gets disabled, fall back to the first enabled tool or settings
  useEffect(() => {
    if (activeView === 'settings') return;
    const isActive = enabledTools.some((t) => t.id === activeView);
    if (!isActive) {
      setActiveView(enabledTools[0]?.id ?? 'settings');
    }
  }, [enabledTools, activeView]);

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
        // Try workspace tool shortcuts first
        try {
          const db = getWorkspaceDB();
          db.select<{ tool_id: string; config: string }[]>(
            `SELECT tool_id, config FROM workspace_tools`,
          ).then((rows) => {
            for (const row of rows) {
              try {
                const cfg = JSON.parse(row.config || '{}');
                if (cfg.shortcut === e.key) {
                  setActiveView(row.tool_id);
                  return;
                }
              } catch { /* skip */ }
            }
          }).catch(() => { /* no workspace DB loaded */ });
        } catch {
          // No workspace DB loaded — ignore
        }
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);

    // nav:open-entity → switch to the matching tool
    const onOpenEntity = ({ type }: { id: string; type: BaseEntity['type'] }): void => {
      try {
        const tools = enabledToolsRef.current;
        const tool = getToolByEntityType(type) ?? tools.find((t) => t.entityTypes?.includes(type));
        if (tool) setActiveView(tool.id);
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

    // Profile switch → reset active view to first enabled tool
    const onProfileSwitched = (): void => {
      const firstTool = useWorkspaceStore.getState().activeWorkspaceId
        ? enabledToolsRef.current[0]?.id
        : undefined;
      setActiveView(firstTool ?? 'settings');
    };
    eventBus.on('profile:switched', onProfileSwitched);

    // Sync conflict overlay
    const onConflict = (event: { local: BaseEntity; server: BaseEntity; resolve: (r: BaseEntity) => void }): void => {
      setConflict({ local: event.local, server: event.server, resolve: event.resolve });
    };
    eventBus.on('sync:conflict', onConflict);

    // New workspace with seeded tools → auto-navigate to first tool
    const onToolsSeeded = ({ firstToolId }: { firstToolId: string }): void => {
      setActiveView(firstToolId);
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
    const tool = getTool(activeView);
    if (tool) {
      const Component = tool.component;
      return <Component />;
    }
    return <SettingsView />;
  }, [activeView]);

  // Display name for the header
  const headerTitle =
    activeView === 'settings'
      ? 'Settings'
      : (getTool(activeView)?.name ?? activeView).replace('-', ' ');

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
