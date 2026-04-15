import { z } from 'zod';

export type EntityType =
  | 'note'
  | 'task'
  | 'calendar_event'
  | 'time_log'
  | 'project'
  | 'file_attachment'
  | 'workspace_tool'
  | 'pomodoro_session'
  | 'habit'
  | 'bookmark';

/** Mandatory fields every Base Entity must carry */
export const BaseEntitySchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['note', 'task', 'calendar_event', 'time_log', 'project', 'file_attachment', 'workspace_tool', 'pomodoro_session', 'habit', 'bookmark']),
  /** Module-specific data serialised to JSON */
  payload: z.record(z.unknown()),
  /** Arbitrary key-value metadata (labels, visibility flags, …) */
  metadata: z.record(z.string()).default({}),
  /** Free-form string tags for filtering and FTS */
  tags: z.array(z.string()).default([]),
  /** Optional parent entity for hierarchy (tasks ↔ project, etc.) */
  parent_id: z.string().uuid().nullable().default(null),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable().default(null),
});

export type BaseEntity = z.infer<typeof BaseEntitySchema>;

/** Payload shapes per entity type */
export const NotePayloadSchema = z.object({
  title: z.string(),
  /** Plain text extract for FTS and preview */
  content_md: z.string(),
  /** TipTap editor JSON (stringified) — primary rich content storage */
  content_json: z.string().optional(),
  /** Bi-directional links extracted from [[Name]] syntax */
  linked_entity_ids: z.array(z.string().uuid()).default([]),
});

export const TaskLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});

export const ChecklistItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  checked: z.boolean().default(false),
});

export const TaskCommentSchema = z.object({
  id: z.string(),
  author: z.string().default(''),
  text: z.string(),
  created_at: z.string().datetime(),
});

export const TaskPayloadSchema = z.object({
  title: z.string(),
  description: z.string().default(''),
  /** Rich text description stored as TipTap JSON (stringified) */
  description_json: z.string().optional(),
  status: z.enum(['todo', 'in_progress', 'done', 'cancelled']).default('todo'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  due_date: z.string().datetime().nullable().default(null),
  assigned_to: z.string().nullable().default(null),
  file_hashes: z.array(z.string()).default([]),
  /** Column identifier for Kanban boards */
  column_id: z.string().default('todo'),
  /** Colored labels */
  labels: z.array(TaskLabelSchema).default([]),
  /** Checklist / subtasks */
  checklist: z.array(ChecklistItemSchema).default([]),
  /** File attachment references */
  attachments: z.array(z.object({
    id: z.string(),
    name: z.string(),
    hash: z.string(),
    mime_type: z.string().default('application/octet-stream'),
    size_bytes: z.number().default(0),
  })).default([]),
  /** Activity comments */
  comments: z.array(TaskCommentSchema).default([]),
});

export const CalendarEventPayloadSchema = z.object({
  title: z.string(),
  description: z.string().default(''),
  start: z.string().datetime(),
  end: z.string().datetime(),
  all_day: z.boolean().default(false),
  recurrence_rule: z.string().nullable().default(null),
  location: z.string().default(''),
  color: z.string().default('#3b82f6'),
  /** Link to another entity (e.g. task id whose due date spawned this event) */
  linked_entity_id: z.string().nullable().default(null),
  linked_entity_type: z.enum(['task', 'time_log', 'note']).nullable().default(null),
});

export const TimeLogPayloadSchema = z.object({
  description: z.string(),
  start: z.string().datetime(),
  end: z.string().datetime().nullable().default(null),
  duration_seconds: z.number().int().nonnegative().nullable().default(null),
  window_title: z.string().default(''),
  billable: z.boolean().default(false),
  /** Hourly rate in cents (e.g. 7500 = $75.00) — 0 means not set */
  hourly_rate_cents: z.number().int().nonnegative().default(0),
  /** Project or client name for grouping in reports */
  project: z.string().default(''),
  /** Whether this entry was manually created vs auto-tracked */
  manual: z.boolean().default(false),
});

// ── Pomodoro ─────────────────────────────────────────────────────────────────

export const PomodoroSessionPayloadSchema = z.object({
  /** Duration of the focus interval in minutes */
  focus_minutes: z.number().int().positive().default(25),
  /** Duration of the short break in minutes */
  short_break_minutes: z.number().int().positive().default(5),
  /** Duration of the long break in minutes */
  long_break_minutes: z.number().int().positive().default(15),
  /** Number of focus intervals before a long break */
  intervals_before_long: z.number().int().positive().default(4),
  /** Current interval number (1-based) */
  current_interval: z.number().int().nonnegative().default(1),
  /** Current phase */
  phase: z.enum(['focus', 'short_break', 'long_break', 'idle']).default('idle'),
  /** ISO timestamp when the current phase started (null if idle) */
  started_at: z.string().datetime().nullable().default(null),
  /** Total completed focus sessions */
  completed_sessions: z.number().int().nonnegative().default(0),
  /** Optional description of what the user is focusing on */
  label: z.string().default(''),
  /** Link to a time_log entity created when session completes */
  linked_time_log_id: z.string().nullable().default(null),
});

// ── Habit ────────────────────────────────────────────────────────────────────

export const HabitPayloadSchema = z.object({
  name: z.string(),
  /** Emoji or short icon string */
  icon: z.string().default('✅'),
  color: z.string().default('#22c55e'),
  /** How often the habit should be done */
  frequency: z.enum(['daily', 'weekly']).default('daily'),
  /** Target count per period (e.g., 3 glasses of water per day) */
  target_count: z.number().int().positive().default(1),
  /** Dates when the habit was completed — ISO date strings (YYYY-MM-DD) mapped to completion count */
  completions: z.record(z.number().int().nonnegative()).default({}),
  /** Whether the habit is currently active */
  archived: z.boolean().default(false),
});

// ── Bookmark ────────────────────────────────────────────────────────────────

export const BookmarkPayloadSchema = z.object({
  url: z.string(),
  title: z.string(),
  description: z.string().default(''),
  /** Favicon or preview image stored as local file hash */
  favicon_hash: z.string().nullable().default(null),
  /** User-assigned color for visual grouping */
  color: z.string().default('#3b82f6'),
  /** Whether the bookmark has been marked as a favorite */
  pinned: z.boolean().default(false),
});

// ── Workspace ────────────────────────────────────────────────────────────────

export const WorkspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().default(''),
  icon: z.string().default('folder'),
  color: z.string().default('#6366f1'),
  parent_id: z.string().uuid().nullable().default(null),
  sort_order: z.number().int().nonnegative().default(0),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable().default(null),
});

export const WorkspaceToolSchema = z.object({
  id: z.string().uuid(),
  tool_id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  config: z.record(z.unknown()).default({}),
  sort_order: z.number().int().nonnegative().default(0),
  created_at: z.string().datetime(),
});

export const ToolManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string().default('1.0.0'),
  description: z.string().default(''),
  icon: z.string().default('box'),
  entityTypes: z.array(z.string()).default([]),
  shortcut: z.string().optional(),
  hasPortalView: z.boolean().default(false),
  portalPermissions: z.array(z.enum(['read', 'write', 'upload'])).default([]),
  configSchema: z.record(z.unknown()).optional(),
});

export type Workspace = z.infer<typeof WorkspaceSchema>;
export type WorkspaceTool = z.infer<typeof WorkspaceToolSchema>;
export type ToolManifest = z.infer<typeof ToolManifestSchema>;

export type NotePayload = z.infer<typeof NotePayloadSchema>;
export type TaskPayload = z.infer<typeof TaskPayloadSchema>;
export type TaskLabel = z.infer<typeof TaskLabelSchema>;
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;
export type TaskComment = z.infer<typeof TaskCommentSchema>;
export type CalendarEventPayload = z.infer<typeof CalendarEventPayloadSchema>;
export type TimeLogPayload = z.infer<typeof TimeLogPayloadSchema>;
export type PomodoroSessionPayload = z.infer<typeof PomodoroSessionPayloadSchema>;
export type HabitPayload = z.infer<typeof HabitPayloadSchema>;
export type BookmarkPayload = z.infer<typeof BookmarkPayloadSchema>;
