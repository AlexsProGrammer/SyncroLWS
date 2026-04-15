import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { eventBus } from '@/core/events';
import { getAllTools, type Tool } from '@/registry/ToolRegistry';
import { getDB } from '@/core/db';
import { useProfileStore } from '@/store/profileStore';

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconSearch({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function IconSettings({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconChevron({ className, collapsed }: { className?: string; collapsed: boolean }): React.ReactElement {
  return (
    <svg
      className={cn('transition-transform duration-200', collapsed && 'rotate-180', className)}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

// ── Sidebar component ─────────────────────────────────────────────────────────

export type ActiveView = string; // tool id or 'settings'

interface SidebarProps {
  active: ActiveView;
  onNavigate: (id: ActiveView) => void;
}

/**
 * Hook: loads enabled tool ids from the active_tools DB table.
 * Re-loads whenever the profile changes or tools are toggled.
 */
export function useEnabledTools(): { enabledTools: Tool[]; reload: () => void } {
  const [enabledIds, setEnabledIds] = useState<Set<string> | null>(null);
  const activeProfileId = useProfileStore((s) => s.activeProfileId);

  const reload = useCallback(async () => {
    if (!activeProfileId) {
      setEnabledIds(null);
      return;
    }
    try {
      const db = getDB();
      const rows = await db.select<{ tool_id: string; is_enabled: number }[]>(
        `SELECT tool_id, is_enabled FROM active_tools WHERE profile_id = ?`,
        [activeProfileId],
      );

      // If no rows exist in DB yet → all tools enabled (first-run default)
      if (rows.length === 0) {
        setEnabledIds(null); // null = all enabled
        return;
      }

      const enabled = new Set<string>();
      for (const row of rows) {
        if (row.is_enabled) enabled.add(row.tool_id);
      }
      setEnabledIds(enabled);
    } catch {
      setEnabledIds(null); // fallback: all enabled
    }
  }, [activeProfileId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Listen for tool toggle events from SettingsView
  useEffect(() => {
    const handler = (): void => {
      void reload();
    };
    eventBus.on('settings:tools-changed', handler);
    return () => {
      eventBus.off('settings:tools-changed', handler);
    };
  }, [reload]);

  const allTools = getAllTools();
  const enabledTools = enabledIds === null
    ? allTools
    : allTools.filter((t) => enabledIds.has(t.id));

  return { enabledTools, reload };
}

export function Sidebar({ active, onNavigate }: SidebarProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const { enabledTools } = useEnabledTools();

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-border bg-card transition-all duration-200',
        collapsed ? 'w-14' : 'w-52',
      )}
    >
      {/* Logo / app name */}
      <div className="flex h-14 items-center gap-2.5 border-b border-border px-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary">
          <span className="text-xs font-bold text-primary-foreground">S</span>
        </div>
        {!collapsed && (
          <span className="truncate text-sm font-semibold tracking-tight text-foreground">
            SyncroLWS
          </span>
        )}
      </div>

      {/* Search shortcut */}
      <div className="px-2 pt-3 pb-1">
        <button
          onClick={() => eventBus.emit('nav:open-command-palette', undefined)}
          title="Search (Ctrl+K)"
          className={cn(
            'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground',
            'transition-colors hover:bg-accent hover:text-accent-foreground',
          )}
        >
          <IconSearch className="h-4 w-4 shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Search</span>
              <kbd className="rounded border border-border bg-muted px-1 text-[10px] font-mono text-muted-foreground">
                ⌃K
              </kbd>
            </>
          )}
        </button>
      </div>

      {/* Divider */}
      <div className="mx-3 my-2 border-t border-border" />

      {/* Module nav — dynamically from ToolRegistry filtered by active_tools */}
      <nav className="flex flex-1 flex-col gap-0.5 px-2">
        {enabledTools.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.id}
              onClick={() => onNavigate(tool.id)}
              title={collapsed ? `${tool.name}${tool.shortcut ? ` (Ctrl+${tool.shortcut})` : ''}` : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors',
                active === tool.id
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">{tool.name}</span>
                  {tool.shortcut && (
                    <kbd className="rounded border border-border bg-muted px-1 text-[10px] font-mono text-muted-foreground">
                      ^{tool.shortcut}
                    </kbd>
                  )}
                </>
              )}
            </button>
          );
        })}
      </nav>

      {/* Settings + Collapse */}
      <div className="border-t border-border p-2 space-y-0.5">
        <button
          onClick={() => onNavigate('settings')}
          title={collapsed ? 'Settings' : undefined}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors',
            active === 'settings'
              ? 'bg-accent text-accent-foreground font-medium'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          )}
        >
          <IconSettings className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="flex-1 text-left">Settings</span>}
        </button>
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex w-full items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <IconChevron className="h-4 w-4" collapsed={!collapsed} />
        </button>
      </div>
    </aside>
  );
}
