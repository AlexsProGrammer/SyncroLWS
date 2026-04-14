import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { eventBus } from '@/core/events';

// ── Icons (inline SVG — no external icon CDN) ─────────────────────────────────

function IconNotes({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function IconTasks({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function IconCalendar({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function IconTimer({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconSearch({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
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

// ── Module definitions ────────────────────────────────────────────────────────

export type ModuleId = 'notes' | 'tasks' | 'calendar' | 'time-tracker';

interface NavItem {
  id: ModuleId;
  label: string;
  Icon: React.FC<{ className?: string }>;
  shortcut: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'notes', label: 'Notes', Icon: IconNotes, shortcut: '1' },
  { id: 'tasks', label: 'Tasks', Icon: IconTasks, shortcut: '2' },
  { id: 'calendar', label: 'Calendar', Icon: IconCalendar, shortcut: '3' },
  { id: 'time-tracker', label: 'Time Tracker', Icon: IconTimer, shortcut: '4' },
];

// ── Sidebar component ─────────────────────────────────────────────────────────

interface SidebarProps {
  active: ModuleId;
  onNavigate: (id: ModuleId) => void;
}

export function Sidebar({ active, onNavigate }: SidebarProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);

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

      {/* Module nav */}
      <nav className="flex flex-1 flex-col gap-0.5 px-2">
        {NAV_ITEMS.map(({ id, label, Icon, shortcut }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            title={collapsed ? `${label} (Ctrl+${shortcut})` : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors',
              active === id
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">{label}</span>
                <kbd className="rounded border border-border bg-muted px-1 text-[10px] font-mono text-muted-foreground">
                  ^{shortcut}
                </kbd>
              </>
            )}
          </button>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-border p-2">
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
