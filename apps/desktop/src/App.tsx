import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { CommandPalette } from './ui/CommandPalette';
import { Sidebar, useEnabledTools, type ActiveView } from './ui/Sidebar';
import { SettingsView } from './ui/SettingsView';
import { SearchView } from './ui/SearchView';
import { Toaster } from './ui/Toaster';
import { Separator } from './ui/components/separator';
import { EntityDetailSheetHost } from './ui/components/EntityDetailSheetHost';
import { AddAspectDialogHost } from './ui/components/AddAspectDialogHost';
import { getTool, getToolByEntityType } from './registry/ToolRegistry';
import { eventBus } from './core/events';
import { startBackupScheduler } from './core/backup';
import { useWorkspaceStore, type WorkspaceTool } from './store/workspaceStore';
import { useProfileStore } from './store/profileStore';
import { useSyncStore } from './store/syncStore';
import { useAppLockStore } from './core/lock';
import { LockScreen } from './ui/LockScreen';
import {
  EnterpriseLoginDialog,
  ChangePasswordDialog,
  FirstRunSetupDialog,
} from './ui/AuthDialogs';
import { toast } from './ui/hooks/use-toast';

import type { BaseEntity } from '@syncrohws/shared-types';

export default function App(): React.ReactElement {
  // activeView is now a workspace tool INSTANCE UUID (or 'settings')
  const [activeView, setActiveView] = useState<ActiveView>('settings');
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
    if (activeView === 'settings' || activeView === 'search') return;
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

    // deeplink:received → parse syncrohws:// URLs and route accordingly
    const onDeepLink = ({ path, params }: { path: string; params: Record<string, string> }): void => {
      console.log('[deep-link] App received:', path, params);

      // /entity/<type>/<id> — switch to matching tool tab AND open the universal detail sheet
      const entityMatch = path.match(/^\/entity\/([^/]+)\/([^/]+)/);
      if (entityMatch && entityMatch[1] && entityMatch[2]) {
        const type = entityMatch[1] as BaseEntity['type'];
        const id = entityMatch[2];
        eventBus.emit('nav:open-entity', { id, type });
        eventBus.emit('nav:open-detail-sheet', { id });
        return;
      }

      // /workspace/<id> — switch active workspace (no-op if already active or missing).
      const workspaceMatch = path.match(/^\/workspace\/([^/]+)/);
      if (workspaceMatch && workspaceMatch[1]) {
        const id = workspaceMatch[1];
        const state = useWorkspaceStore.getState();
        if (state.activeWorkspaceId !== id && state.workspaces.some((w) => w.id === id)) {
          void state.switchWorkspace(id);
        } else if (!state.workspaces.some((w) => w.id === id)) {
          eventBus.emit('notification:show', {
            title: 'Workspace not found',
            body: `No workspace with id ${id.slice(0, 8)} in this profile.`,
            type: 'warning',
          });
        }
        return;
      }

      // /share/<token> — Phase M will resolve share-link tokens. For now just notify.
      const shareMatch = path.match(/^\/share\/([^/]+)/);
      if (shareMatch && shareMatch[1]) {
        eventBus.emit('notification:show', {
          title: 'Share link received',
          body: 'Share-link routing arrives in the upcoming portal phase.',
          type: 'info',
        });
        return;
      }

      console.warn('[deep-link] unhandled URL', path, params);
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

    // Phase I: sync conflict — handler will be wired to the DiffEditor in
    // Phase N once the conflict UI is rebuilt around the hybrid model. For
    // now we just log so engine output is visible during testing.
    const onConflict = (event: { kind: string; id: string; server_revision: number }): void => {
      console.warn('[sync] conflict (deferred to Phase N):', event);
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
    if (activeView === 'search') return <SearchView />;
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
      : activeView === 'search'
        ? 'Search & Tags'
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

  // ── Phase T: app lock gate ───────────────────────────────────────────────────
  const lockEnabled = useAppLockStore((s) => s.enabled);
  const locked = useAppLockStore((s) => s.locked);

  // ── Phase S: enterprise auth gate ─────────────────────────────────────────────
  const profiles = useProfileStore((s) => s.profiles);
  const activeProfileMode = activeProfile?.mode;
  const userToken = useSyncStore((s) => s.userToken);
  const mustChangePassword = useSyncStore((s) => s.mustChangePassword);
  const readonly = useSyncStore((s) => s.readonly);

  const showFirstRun = profiles.length === 0;
  const showLoginDialog =
    !showFirstRun && activeProfileMode === 'enterprise' && !userToken;
  const showForcedChange = !!userToken && mustChangePassword;
  const [showVoluntaryChange, setShowVoluntaryChange] = useState(false);

  // Listen for auth:expired events → clear token so login dialog reappears.
  useEffect(() => {
    const onExpired = (): void => {
      // Don't clear during pw change — user is mid-flow.
      if (useSyncStore.getState().mustChangePassword) return;
      useSyncStore.getState().clearUserSession();
      toast({
        title: 'Signed out',
        description: 'Your session expired. Please sign in again.',
        variant: 'warning',
      });
    };
    const onOpenChangePw = (): void => setShowVoluntaryChange(true);
    eventBus.on('auth:expired', onExpired);
    eventBus.on('settings:open-tab', (tab: string) => {
      if (tab === 'change-password') setShowVoluntaryChange(true);
    });
    return () => {
      eventBus.off('auth:expired', onExpired);
      eventBus.off('settings:open-tab', onOpenChangePw);
    };
  }, []);

  // While the app is locked, render only the lock screen — no main UI, no
  // auth dialogs, no command palette, no anything.
  if (locked) {
    return (
      <>
        <LockScreen />
        <Toaster />
      </>
    );
  }

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
          {readonly && (
            <span className="ml-3 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Read-only — sign in to resume sync
            </span>
          )}
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
      <AddAspectDialogHost />      <FirstRunSetupDialog open={showFirstRun} onComplete={() => { /* main.tsx will react to profile creation */ }} />
      <EnterpriseLoginDialog open={showLoginDialog} onClose={() => { /* dialog closes itself on success */ }} />
      <ChangePasswordDialog
        open={showForcedChange || showVoluntaryChange}
        forced={showForcedChange}
        onClose={() => setShowVoluntaryChange(false)}
      />    </div>
  );
}
