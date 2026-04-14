/**
 * Placeholder view components for each module.
 * These render while full module UIs are being built in later phases.
 * Each panel shows its name, purpose, and keyboard shortcut.
 */
import React from 'react';

interface PlaceholderProps {
  title: string;
  description: string;
  shortcut: string;
  icon: React.ReactElement;
}

function ModulePlaceholder({ title, description, shortcut, icon }: PlaceholderProps): React.ReactElement {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-muted text-muted-foreground">
        {icon}
      </div>
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      <kbd className="mt-2 rounded border border-border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
        {shortcut}
      </kbd>
    </div>
  );
}

// ── Notes ────────────────────────────────────────────────────────────────────

export function NotesView(): React.ReactElement {
  return (
    <ModulePlaceholder
      title="Notes"
      description="Markdown notes with [[wikilinks]], full-text search, and bi-directional backlinks. TipTap editor with autosave."
      shortcut="Ctrl+1"
      icon={
        <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      }
    />
  );
}

// ── Tasks ────────────────────────────────────────────────────────────────────

export function TasksView(): React.ReactElement {
  return (
    <ModulePlaceholder
      title="Tasks"
      description="Kanban-style task board. Tasks are stored as base_entities of type=task with due dates and status columns."
      shortcut="Ctrl+2"
      icon={
        <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 11 12 14 22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      }
    />
  );
}

// ── Calendar ─────────────────────────────────────────────────────────────────

export function CalendarView(): React.ReactElement {
  return (
    <ModulePlaceholder
      title="Calendar"
      description="Monthly and weekly calendar views. Events are stored as base_entities of type=calendar_event."
      shortcut="Ctrl+3"
      icon={
        <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      }
    />
  );
}

// ── Time tracker ─────────────────────────────────────────────────────────────

export function TimeTrackerView(): React.ReactElement {
  return (
    <ModulePlaceholder
      title="Time Tracker"
      description="Automatic active-window detection every 60 s. Time logs stored as base_entities of type=time_log."
      shortcut="Ctrl+4"
      icon={
        <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      }
    />
  );
}
