import React from 'react';
import { NotesView } from '@/modules/notes/NotesView';
import { TasksView } from '@/modules/tasks/TasksView';
import { CalendarView } from '@/ui/ModuleViews';
import { TimeTrackerView } from '@/modules/time-tracker/TimeTrackerView';

// ── Icons (inline SVG — no external CDN, DSGVO compliant) ──────────────────

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

// ── Tool interface ────────────────────────────────────────────────────────────

export interface Tool {
  id: string;
  name: string;
  icon: React.FC<{ className?: string }>;
  component: React.FC;
  /** Keyboard shortcut number (Ctrl+N). Omit for no shortcut. */
  shortcut?: string;
  /** Entity type this tool manages (for nav:open-entity mapping). */
  entityType?: string;
  /** Module init function called at bootstrap. */
  init?: () => void;
}

// ── Registry ──────────────────────────────────────────────────────────────────

const _tools: Map<string, Tool> = new Map();

/**
 * Register a tool in the global registry.
 * Duplicate IDs overwrite — last registration wins.
 */
export function registerTool(tool: Tool): void {
  _tools.set(tool.id, tool);
}

/** Get a tool by id (or undefined if not registered). */
export function getTool(id: string): Tool | undefined {
  return _tools.get(id);
}

/** Get all registered tools as an ordered array. */
export function getAllTools(): Tool[] {
  return [..._tools.values()];
}

// ── Default tool registrations ────────────────────────────────────────────────

import { init as initNotes } from '@/modules/notes';
import { init as initTasks } from '@/modules/tasks';
import { init as initCalendar } from '@/modules/calendar';
import { init as initTimeTracker } from '@/modules/time-tracker';

registerTool({
  id: 'notes',
  name: 'Notes',
  icon: IconNotes,
  component: NotesView,
  shortcut: '1',
  entityType: 'note',
  init: initNotes,
});

registerTool({
  id: 'tasks',
  name: 'Tasks',
  icon: IconTasks,
  component: TasksView,
  shortcut: '2',
  entityType: 'task',
  init: initTasks,
});

registerTool({
  id: 'calendar',
  name: 'Calendar',
  icon: IconCalendar,
  component: CalendarView,
  shortcut: '3',
  entityType: 'calendar_event',
  init: initCalendar,
});

registerTool({
  id: 'time-tracker',
  name: 'Time Tracker',
  icon: IconTimer,
  component: TimeTrackerView,
  shortcut: '4',
  entityType: 'time_log',
  init: initTimeTracker,
});
