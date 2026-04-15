import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { eventBus } from '@/core/events';
import { getAllTools, type Tool } from '@/registry/ToolRegistry';
import { getDB, getWorkspaceDB } from '@/core/db';
import { useProfileStore, type Profile } from '@/store/profileStore';
import { useWorkspaceStore, buildWorkspaceTree, type Workspace } from '@/store/workspaceStore';
import { useThemeStore } from '@/store/themeStore';
import { Input } from '@/ui/components/input';
import { Button } from '@/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/components/dropdown-menu';

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

function IconPlus({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconFolder({ className, style }: { className?: string; style?: React.CSSProperties }): React.ReactElement {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconUser({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IconChevronDown({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconFolderPlus({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  );
}

function IconEdit({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconTrash({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function IconMoreVertical({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="19" r="1" />
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

// ── Workspace tree item ───────────────────────────────────────────────────────

interface WorkspaceTreeNode extends Workspace {
  children: WorkspaceTreeNode[];
}

function WorkspaceTreeItem({
  node,
  depth,
  activeId,
  onSelect,
  collapsed: sidebarCollapsed,
  onDrop,
}: {
  node: WorkspaceTreeNode;
  depth: number;
  activeId: string | null;
  onSelect: (id: string) => void;
  collapsed: boolean;
  onDrop?: (dragId: string, targetId: string) => void;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const isFolder = node.icon === 'folder-group';
  const hasChildren = node.children.length > 0;

  const handleDragStart = (e: React.DragEvent): void => {
    e.dataTransfer.setData('text/plain', node.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent): void => {
    if (!isFolder) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent): void => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDropOnFolder = (e: React.DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const dragId = e.dataTransfer.getData('text/plain');
    if (dragId && dragId !== node.id && onDrop) {
      onDrop(dragId, node.id);
    }
  };

  return (
    <div>
      <button
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDropOnFolder}
        onClick={() => isFolder ? setExpanded((v) => !v) : onSelect(node.id)}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors',
          dragOver && 'ring-2 ring-primary/50 bg-accent',
          !isFolder && activeId === node.id
            ? 'bg-accent text-accent-foreground font-medium'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )}
        style={{ paddingLeft: sidebarCollapsed ? undefined : `${8 + depth * 16}px` }}
        title={sidebarCollapsed ? node.name : undefined}
      >
        {isFolder && !sidebarCollapsed && (
          <span className="shrink-0">
            <IconChevronDown className={cn('h-3 w-3 transition-transform', !expanded && '-rotate-90')} />
          </span>
        )}
        {isFolder ? (
          <IconFolder className="h-3.5 w-3.5 shrink-0" style={{ color: node.color }} />
        ) : (
          <span
            className="h-3 w-3 shrink-0 rounded-sm"
            style={{ backgroundColor: node.color }}
          />
        )}
        {!sidebarCollapsed && <span className="truncate flex-1 text-left">{node.name}</span>}
      </button>
      {isFolder && expanded && !sidebarCollapsed && (
        <div>
          {node.children.map((child) => (
            <WorkspaceTreeItem
              key={child.id}
              node={child as WorkspaceTreeNode}
              depth={depth + 1}
              activeId={activeId}
              onSelect={onSelect}
              collapsed={sidebarCollapsed}
              onDrop={onDrop}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Profile switcher ──────────────────────────────────────────────────────────

function ProfileSwitcher({ collapsed: sidebarCollapsed, onNavigate }: { collapsed: boolean; onNavigate: (id: ActiveView) => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const profiles = useProfileStore((s) => s.profiles);
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const setActiveProfile = useProfileStore((s) => s.setActiveProfile);
  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors',
          'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )}
        title={sidebarCollapsed ? activeProfile?.name ?? 'Profile' : undefined}
      >
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ backgroundColor: activeProfile?.color ?? '#6366f1' }}
        >
          {activeProfile?.name?.[0]?.toUpperCase() ?? 'P'}
        </span>
        {!sidebarCollapsed && (
          <>
            <span className="flex-1 truncate text-left font-medium text-foreground">
              {activeProfile?.name ?? 'Profile'}
            </span>
            <IconChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
          </>
        )}
      </button>

      {open && !sidebarCollapsed && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-full rounded-md border border-border bg-popover p-1 shadow-lg">
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => { setActiveProfile(p.id); setOpen(false); }}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors',
                p.id === activeProfileId
                  ? 'bg-accent text-accent-foreground'
                  : 'text-popover-foreground hover:bg-accent',
              )}
            >
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ backgroundColor: p.color ?? '#6366f1' }}
              >
                {p.name[0]?.toUpperCase()}
              </span>
              <span className="truncate">{p.name}</span>
            </button>
          ))}
          {/* Add profile button */}
          <div className="mt-1 border-t border-border pt-1">
            <button
              onClick={() => {
                setOpen(false);
                onNavigate('settings');
                // Small delay then emit to switch to profile tab
                setTimeout(() => eventBus.emit('settings:open-tab', 'profiles'), 50);
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <IconPlus className="h-3.5 w-3.5" />
              <span>Add Profile</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Theme toggle ──────────────────────────────────────────────────────────────

function IconSun({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function IconMoon({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function ThemeToggle({ collapsed: sidebarCollapsed }: { collapsed: boolean }): React.ReactElement {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const cycle = (): void => {
    const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
    setTheme(next);
  };

  const label = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'System';

  return (
    <button
      onClick={cycle}
      title={sidebarCollapsed ? `Theme: ${label}` : undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors',
        'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      {theme === 'dark' ? (
        <IconMoon className="h-4 w-4 shrink-0" />
      ) : (
        <IconSun className="h-4 w-4 shrink-0" />
      )}
      {!sidebarCollapsed && <span className="flex-1 text-left">{label}</span>}
    </button>
  );
}

// ── Add Tool Modal ────────────────────────────────────────────────────────────

interface WorkspaceTool {
  id: string;
  tool_id: string;
  name: string;
  sort_order: number;
  config: string; // JSON with { shortcut?: string }
}

function AddToolModal({
  open,
  onClose,
  onToolAdded,
}: {
  open: boolean;
  onClose: () => void;
  onToolAdded: () => void;
}): React.ReactElement | null {
  const [search, setSearch] = useState('');
  const allTools = getAllTools();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  const filtered = search
    ? allTools.filter(
        (t) =>
          t.name.toLowerCase().includes(search.toLowerCase()) ||
          t.id.toLowerCase().includes(search.toLowerCase()) ||
          (t.manifest?.description ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : allTools;

  const addTool = async (tool: Tool): Promise<void> => {
    if (!activeWorkspaceId) return;
    try {
      const db = getWorkspaceDB();
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      // Count existing tools for sort_order
      const countRows = await db.select<{ cnt: number }[]>(
        `SELECT COUNT(*) as cnt FROM workspace_tools`,
      );
      const sortOrder = countRows[0]?.cnt ?? 0;

      await db.execute(
        `INSERT INTO workspace_tools (id, tool_id, name, description, config, sort_order, created_at)
         VALUES (?, ?, ?, ?, '{}', ?, ?)`,
        [id, tool.id, tool.name, tool.manifest?.description ?? '', sortOrder, now],
      );

      eventBus.emit('workspace:tool-added', {
        workspaceId: activeWorkspaceId,
        toolInstanceId: id,
        toolId: tool.id,
      });

      onToolAdded();
      onClose();
    } catch (err) {
      console.error('[sidebar] add tool failed:', err);
    }
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add Tool to Workspace</DialogTitle>
        </DialogHeader>

        <Input
          placeholder="Search tools…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-3"
          autoFocus
        />

        <div className="flex-1 space-y-1.5 overflow-auto">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No tools found</p>
          ) : (
            filtered.map((tool) => {
              const Icon = tool.icon;
              return (
                <button
                  key={tool.id}
                  onClick={() => void addTool(tool)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/30 hover:bg-accent"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <p className="text-sm font-medium text-foreground">{tool.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {tool.manifest?.description ?? `${tool.id} module`}
                    </p>
                  </div>
                  {tool.shortcut && (
                    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                      ^{tool.shortcut}
                    </kbd>
                  )}
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Sidebar ──────────────────────────────────────────────────────────────

export function Sidebar({ active, onNavigate }: SidebarProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const { enabledTools } = useEnabledTools();
  const [showAddTool, setShowAddTool] = useState(false);
  const [workspaceTools, setWorkspaceTools] = useState<WorkspaceTool[]>([]);

  // Auto-collapse on narrow windows
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const handler = (e: MediaQueryListEvent | MediaQueryList): void => {
      if (e.matches) setCollapsed(true);
    };
    handler(mq);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const switchWorkspace = useWorkspaceStore((s) => s.switchWorkspace);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const updateWorkspace = useWorkspaceStore((s) => s.updateWorkspace);

  const tree = buildWorkspaceTree(workspaces);

  /** Handle drag-and-drop: reparent item to target folder */
  const handleTreeDrop = useCallback(
    (dragId: string, targetFolderId: string) => {
      const dragItem = workspaces.find((w) => w.id === dragId);
      const target = workspaces.find((w) => w.id === targetFolderId);
      if (!dragItem || !target) return;
      // Target must be a folder
      if (target.icon !== 'folder-group') return;
      // Cannot drop a folder into itself
      if (dragId === targetFolderId) return;
      // Cannot drop a parent into its own descendant
      const isDescendant = (parentId: string, checkId: string): boolean => {
        const children = workspaces.filter((w) => w.parent_id === parentId);
        for (const child of children) {
          if (child.id === checkId) return true;
          if (isDescendant(child.id, checkId)) return true;
        }
        return false;
      };
      if (isDescendant(dragId, targetFolderId)) return;

      void updateWorkspace(dragId, { parent_id: targetFolderId });
    },
    [workspaces, updateWorkspace],
  );

  /** Handle drop on root area (unparent item) */
  const handleRootDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const dragId = e.dataTransfer.getData('text/plain');
      if (!dragId) return;
      const item = workspaces.find((w) => w.id === dragId);
      if (item && item.parent_id !== null) {
        void updateWorkspace(dragId, { parent_id: null });
      }
    },
    [workspaces, updateWorkspace],
  );

  // ── Load workspace tools from workspace DB ──────────────────────────────

  const loadWorkspaceTools = useCallback(async () => {
    if (!activeWorkspaceId) {
      setWorkspaceTools([]);
      return;
    }
    try {
      const db = getWorkspaceDB();
      const rows = await db.select<WorkspaceTool[]>(
        `SELECT id, tool_id, name, sort_order, config FROM workspace_tools ORDER BY sort_order ASC`,
      );
      setWorkspaceTools(rows);
    } catch (err) {
      console.warn('[sidebar] loadWorkspaceTools failed, resetting:', err);
      setWorkspaceTools([]);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    void loadWorkspaceTools();
  }, [loadWorkspaceTools]);

  useEffect(() => {
    const handler = (): void => void loadWorkspaceTools();
    eventBus.on('workspace:tool-added', handler);
    eventBus.on('workspace:tool-removed', handler);
    eventBus.on('workspace:switched', handler);
    return () => {
      eventBus.off('workspace:tool-added', handler);
      eventBus.off('workspace:tool-removed', handler);
      eventBus.off('workspace:switched', handler);
    };
  }, [loadWorkspaceTools]);

  // ── Workspace create dialogs ────────────────────────────────────────────

  const [showCreateWs, setShowCreateWs] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [newWsColor, setNewWsColor] = useState('#6366f1');

  const handleCreateWorkspace = async (): Promise<void> => {
    if (!newWsName.trim()) return;
    await createWorkspace({ name: newWsName.trim(), color: newWsColor });
    setNewWsName('');
    setNewWsColor('#6366f1');
    setShowCreateWs(false);
  };

  const handleCreateFolder = async (): Promise<void> => {
    if (!newWsName.trim()) return;
    await createWorkspace({
      name: newWsName.trim(),
      color: newWsColor,
      icon: 'folder-group',
    });
    setNewWsName('');
    setNewWsColor('#6366f1');
    setShowCreateFolder(false);
  };

  // Navigate via workspace tools (map tool_id → registered tool, then navigate)
  const handleToolNav = (toolId: string): void => {
    onNavigate(toolId);
  };

  // ── Tool actions (3-dot menu) ───────────────────────────────────────────

  const [editShortcutToolId, setEditShortcutToolId] = useState<string | null>(null);
  const [shortcutInput, setShortcutInput] = useState('');
  const [confirmResetTool, setConfirmResetTool] = useState<{ id: string; toolId: string; name: string } | null>(null);

  const handleRemoveTool = async (toolInstanceId: string): Promise<void> => {
    if (!activeWorkspaceId) return;
    try {
      const db = getWorkspaceDB();
      await db.execute(`DELETE FROM workspace_tools WHERE id = ?`, [toolInstanceId]);
      eventBus.emit('workspace:tool-removed', {
        workspaceId: activeWorkspaceId,
        toolInstanceId,
      });
      void loadWorkspaceTools();
    } catch (err) {
      console.error('[sidebar] remove tool failed:', err);
    }
  };

  const handleResetTool = async (toolInstanceId: string, toolId: string): Promise<void> => {
    if (!activeWorkspaceId) return;
    try {
      const db = getWorkspaceDB();
      const tool = enabledTools.find((t) => t.id === toolId);
      if (tool?.entityTypes) {
        for (const entityType of tool.entityTypes) {
          await db.execute(
            `DELETE FROM base_entities WHERE type = ?`,
            [entityType],
          );
        }
      }
      // Remove the tool instance
      await db.execute(`DELETE FROM workspace_tools WHERE id = ?`, [toolInstanceId]);
      eventBus.emit('workspace:tool-removed', {
        workspaceId: activeWorkspaceId,
        toolInstanceId,
      });
      void loadWorkspaceTools();
      // Trigger view refresh
      eventBus.emit('entity:deleted', { id: '_reset_', type: 'note' as const });
      eventBus.emit('notification:show', {
        title: 'Tool Reset',
        body: `All data for "${tool?.name ?? toolId}" has been removed.`,
        type: 'info',
      });
    } catch (err) {
      console.error('[sidebar] reset tool failed:', err);
    }
    setConfirmResetTool(null);
  };

  const handleSaveShortcut = async (): Promise<void> => {
    if (!editShortcutToolId) return;
    // Check duplicate shortcut in current workspace
    if (shortcutInput) {
      const duplicate = workspaceTools.find((wt) => {
        if (wt.id === editShortcutToolId) return false;
        try {
          const cfg = JSON.parse(wt.config || '{}');
          return cfg.shortcut === shortcutInput;
        } catch { return false; }
      });
      if (duplicate) {
        eventBus.emit('notification:show', {
          title: 'Shortcut conflict',
          body: `Ctrl+${shortcutInput} is already used by "${duplicate.name}".`,
          type: 'warning',
        });
        return;
      }
    }
    try {
      const db = getWorkspaceDB();
      const configStr = JSON.stringify({ shortcut: shortcutInput || undefined });
      await db.execute(
        `UPDATE workspace_tools SET config = ? WHERE id = ?`,
        [configStr, editShortcutToolId],
      );
      setEditShortcutToolId(null);
      setShortcutInput('');
      void loadWorkspaceTools();
    } catch (err) {
      console.error('[sidebar] save shortcut failed:', err);
    }
  };

  /** Parse workspace tool config JSON to get custom shortcut (default: none) */
  const getToolShortcut = (wt: WorkspaceTool): string | undefined => {
    try {
      const cfg = JSON.parse(wt.config || '{}');
      return cfg.shortcut || undefined;
    } catch {
      return undefined;
    }
  };

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-border bg-card transition-all duration-200',
        collapsed ? 'w-14' : 'w-56',
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

      {/* ── Workspace navigator ──────────────────────────────────────────── */}
      <div className="px-2 pt-2">
        <div className="flex items-center justify-between px-2 pb-1">
          {!collapsed && (
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Workspaces
            </span>
          )}
          <div className="flex items-center gap-0.5">
            {!collapsed && (
              <button
                onClick={() => { setNewWsName(''); setShowCreateFolder(true); }}
                title="New folder"
                className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <IconFolderPlus className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => { setNewWsName(''); setShowCreateWs(true); }}
              title="New workspace"
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <IconPlus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div
          className="max-h-40 overflow-y-auto"
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={handleRootDrop}
        >
          {tree.map((node) => (
            <WorkspaceTreeItem
              key={node.id}
              node={node as WorkspaceTreeNode}
              depth={0}
              activeId={activeWorkspaceId}
              onSelect={(id) => void switchWorkspace(id)}
              collapsed={collapsed}
              onDrop={handleTreeDrop}
            />
          ))}
        </div>
      </div>

      {/* Divider */}
      <div className="mx-3 my-2 border-t border-border" />

      {/* Module nav — workspace tools or enabled tools */}
      <nav className="flex flex-1 flex-col gap-0.5 px-2 overflow-y-auto">
        {activeWorkspaceId && workspaceTools.length > 0 ? (
          <>
            {workspaceTools.map((wt) => {
              const tool = enabledTools.find((t) => t.id === wt.tool_id);
              if (!tool) return null;
              const Icon = tool.icon;
              const shortcut = getToolShortcut(wt);
              return (
                <div key={wt.id} className="group relative flex items-center">
                  <button
                    onClick={() => handleToolNav(tool.id)}
                    title={collapsed ? `${wt.name}${shortcut ? ` (Ctrl+${shortcut})` : ''}` : undefined}
                    className={cn(
                      'flex flex-1 items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors',
                      active === tool.id
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left truncate">{wt.name}</span>
                        {shortcut && (
                          <kbd className="mr-5 rounded border border-border bg-muted px-1 text-[10px] font-mono text-muted-foreground">
                            ^{shortcut}
                          </kbd>
                        )}
                      </>
                    )}
                  </button>
                  {!collapsed && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="absolute right-1 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-foreground hover:bg-accent"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <IconMoreVertical className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem
                          onClick={() => {
                            setEditShortcutToolId(wt.id);
                            setShortcutInput((() => {
                              try { return JSON.parse(wt.config || '{}').shortcut ?? ''; }
                              catch { return ''; }
                            })());
                          }}
                        >
                          <IconEdit className="mr-2 h-3.5 w-3.5" />
                          Edit Shortcut
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => void handleRemoveTool(wt.id)}
                        >
                          <IconPlus className="mr-2 h-3.5 w-3.5 rotate-45" />
                          Remove Tool
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setConfirmResetTool({ id: wt.id, toolId: wt.tool_id, name: wt.name })}
                        >
                          <IconTrash className="mr-2 h-3.5 w-3.5" />
                          Reset Data
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              );
            })}
            {/* Add tool button */}
            <button
              onClick={() => setShowAddTool(true)}
              className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-muted-foreground/60 transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <IconPlus className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="flex-1 text-left">Add Tool</span>}
            </button>
          </>
        ) : activeWorkspaceId ? (
          /* Empty workspace — show prominent add tool */
          <div className={cn('flex flex-col items-center gap-2 py-4', collapsed && 'py-2')}>
            {!collapsed && (
              <p className="text-xs text-muted-foreground text-center">
                No tools added yet
              </p>
            )}
            <button
              onClick={() => setShowAddTool(true)}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                'border border-dashed border-border text-muted-foreground hover:border-primary hover:text-foreground hover:bg-accent',
              )}
            >
              <IconPlus className="h-4 w-4" />
              {!collapsed && <span>Add Tool</span>}
            </button>
          </div>
        ) : (
          /* No workspace selected — show all enabled tools */
          enabledTools.map((tool) => {
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
          })
        )}
      </nav>

      {/* Profile switcher + Theme + Settings + Collapse */}
      <div className="border-t border-border p-2 space-y-0.5">
        <ProfileSwitcher collapsed={collapsed} onNavigate={onNavigate} />
        <ThemeToggle collapsed={collapsed} />
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

      {/* ── Add Tool Modal ─────────────────────────────────────────────── */}
      <AddToolModal
        open={showAddTool}
        onClose={() => setShowAddTool(false)}
        onToolAdded={() => void loadWorkspaceTools()}
      />

      {/* ── Create Workspace Dialog ────────────────────────────────────── */}
      <Dialog open={showCreateWs} onOpenChange={setShowCreateWs}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>New Workspace</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <Input
              placeholder="Workspace name"
              value={newWsName}
              onChange={(e) => setNewWsName(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && void handleCreateWorkspace()}
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Color</label>
              <input
                type="color"
                value={newWsColor}
                onChange={(e) => setNewWsColor(e.target.value)}
                className="h-7 w-7 cursor-pointer rounded border border-border"
              />
            </div>
            <Button onClick={() => void handleCreateWorkspace()} className="w-full" disabled={!newWsName.trim()}>
              Create
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Create Folder Dialog ───────────────────────────────────────── */}
      <Dialog open={showCreateFolder} onOpenChange={setShowCreateFolder}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <Input
              placeholder="Folder name"
              value={newWsName}
              onChange={(e) => setNewWsName(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && void handleCreateFolder()}
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Color</label>
              <input
                type="color"
                value={newWsColor}
                onChange={(e) => setNewWsColor(e.target.value)}
                className="h-7 w-7 cursor-pointer rounded border border-border"
              />
            </div>
            <Button onClick={() => void handleCreateFolder()} className="w-full" disabled={!newWsName.trim()}>
              Create Folder
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit Shortcut Dialog ───────────────────────────────────────── */}
      <Dialog open={editShortcutToolId !== null} onOpenChange={(v) => !v && setEditShortcutToolId(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Edit Shortcut</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <p className="text-sm text-muted-foreground">
              Enter a number (1–9) for Ctrl+Number shortcut, or leave empty to remove.
            </p>
            <Input
              placeholder="e.g. 1"
              value={shortcutInput}
              onChange={(e) => {
                const v = e.target.value.replace(/[^1-9]/g, '').slice(0, 1);
                setShortcutInput(v);
              }}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && void handleSaveShortcut()}
              maxLength={1}
            />
            <div className="flex gap-2">
              <Button onClick={() => void handleSaveShortcut()} className="flex-1">
                Save
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShortcutInput('');
                  void handleSaveShortcut();
                }}
                className="flex-1"
                disabled={!shortcutInput}
              >
                Clear
              </Button>
              <Button variant="ghost" onClick={() => setEditShortcutToolId(null)} className="flex-1">
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Reset Confirmation Dialog ──────────────────────────────────── */}
      <Dialog open={confirmResetTool !== null} onOpenChange={(v) => !v && setConfirmResetTool(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Reset Tool Data</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <p className="text-sm text-muted-foreground">
              This will permanently delete all data for <strong>{confirmResetTool?.name}</strong> and remove the tool from this workspace.
              This action cannot be undone.
            </p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                onClick={() => confirmResetTool && void handleResetTool(confirmResetTool.id, confirmResetTool.toolId)}
                className="flex-1"
              >
                Reset & Remove
              </Button>
              <Button variant="outline" onClick={() => setConfirmResetTool(null)} className="flex-1">
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
