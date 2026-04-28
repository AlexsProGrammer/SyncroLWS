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
  /**
   * Phase B — Aspect plugin block. If present, this module registers an
   * aspect type with the entity registry so that any base entity can gain
   * this personality (e.g. a note can become a kanban card).
   */
  aspect: z
    .object({
      /** Aspect type id, e.g. "note", "task", "calendar_event". */
      type: z.string(),
      /** Display label shown on the detail-sheet tab and in AddAspectDialog. */
      label: z.string(),
      /** Default `data` payload when this aspect is freshly attached. */
      defaultData: z.record(z.unknown()).default({}),
      /**
       * Whether this aspect must be scoped to a workspace tool instance
       * (e.g. a kanban card belongs to a specific board). When true the
       * AddAspectDialog forces the user to pick a target instance.
       */
      requiresToolInstance: z.boolean().default(false),
    })
    .optional(),
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

// ═══════════════════════════════════════════════════════════════════════════════
// Hybrid Multi-Aspect Entity Model (Phase A)
// ═══════════════════════════════════════════════════════════════════════════════
//
// A *base entity* now carries shared "core" fields (title, description, color,
// icon, tags) and 0..N *aspects*. Each aspect gives the entity a tool-specific
// personality: a single base entity can simultaneously be a note + a kanban
// card + a calendar event. Editing in any tool edits the same root.
//
// New tools plug in by registering an `aspect_type` and an editor component;
// no schema changes are required.
// ═══════════════════════════════════════════════════════════════════════════════

/** Aspect kinds that can be attached to a base entity. */
export const ASPECT_TYPES = [
  'note',
  'task',
  'calendar_event',
  'time_log',
  'pomodoro_session',
  'habit',
  'bookmark',
] as const;

export type AspectType = (typeof ASPECT_TYPES)[number];

export const AspectTypeSchema = z.enum(ASPECT_TYPES);

/** Shared, tool-agnostic core fields that live on every base entity. */
export const EntityCoreSchema = z.object({
  id: z.string().uuid(),
  title: z.string().default(''),
  description: z.string().default(''),
  /** Rich-text description as TipTap JSON (stringified). */
  description_json: z.string().optional(),
  color: z.string().default('#6366f1'),
  icon: z.string().default('box'),
  tags: z.array(z.string()).default([]),
  /** Optional parent entity for hierarchy (project ↔ task, folder ↔ note, …). */
  parent_id: z.string().uuid().nullable().default(null),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable().default(null),
});

export type EntityCore = z.infer<typeof EntityCoreSchema>;

/**
 * One *personality* of an entity. The shape of `data` is constrained by Zod
 * schemas at the application layer (one per aspect_type). Stored as JSON in
 * the DB to keep the schema stable while modules evolve.
 */
export const EntityAspectSchema = z.object({
  id: z.string().uuid(),
  entity_id: z.string().uuid(),
  aspect_type: AspectTypeSchema,
  /** Aspect-specific payload, validated by the aspect plugin's schema. */
  data: z.record(z.unknown()).default({}),
  /**
   * Tool-instance scope. e.g. which kanban board / calendar this aspect lives
   * on. NULL means the aspect is workspace-wide (notes, habits, bookmarks).
   * The uniqueness key is (entity_id, aspect_type, tool_instance_id), so an
   * entity could even live on two boards simultaneously.
   */
  tool_instance_id: z.string().uuid().nullable().default(null),
  /** Within a tool instance — column ordering, calendar lane, etc. */
  sort_order: z.number().int().default(0),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable().default(null),
});

export type EntityAspect = z.infer<typeof EntityAspectSchema>;

/** Convenience aggregate: a core record together with all of its aspects. */
export interface HybridEntity {
  core: EntityCore;
  aspects: EntityAspect[];
}

/** Kinds of soft links between entities (replaces inline linked_entity_id fields). */
export const RELATION_KINDS = ['wiki_link', 'reference', 'embed'] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];
export const RelationKindSchema = z.enum(RELATION_KINDS);

export const EntityRelationSchema = z.object({
  id: z.string().uuid(),
  from_entity_id: z.string().uuid(),
  to_entity_id: z.string().uuid(),
  kind: RelationKindSchema,
  /** Optional metadata (e.g. anchor offset within a note). */
  metadata: z.record(z.unknown()).default({}),
  created_at: z.string().datetime(),
});

export type EntityRelation = z.infer<typeof EntityRelationSchema>;

// ── Aspect-specific data schemas ─────────────────────────────────────────────
// These describe the SHAPE of `EntityAspect.data` for each aspect_type. The
// shared-core fields (title/description/color/icon/tags) are NOT repeated here
// — they live on EntityCore. New tools add their own *AspectDataSchema.

export const NoteAspectDataSchema = z.object({
  /** TipTap editor JSON, stringified. */
  content_json: z.string().optional(),
  /** Plain-text extract for FTS / preview. */
  content_md: z.string().default(''),
});
export type NoteAspectData = z.infer<typeof NoteAspectDataSchema>;

export const TaskAspectDataSchema = z.object({
  status: z.enum(['todo', 'in_progress', 'done', 'cancelled']).default('todo'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  due_date: z.string().datetime().nullable().default(null),
  assigned_to: z.string().nullable().default(null),
  column_id: z.string().default('todo'),
  labels: z.array(TaskLabelSchema).default([]),
  checklist: z.array(ChecklistItemSchema).default([]),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        hash: z.string(),
        mime_type: z.string().default('application/octet-stream'),
        size_bytes: z.number().default(0),
      }),
    )
    .default([]),
  comments: z.array(TaskCommentSchema).default([]),
});
export type TaskAspectData = z.infer<typeof TaskAspectDataSchema>;

export const CalendarEventAspectDataSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
  all_day: z.boolean().default(false),
  recurrence_rule: z.string().nullable().default(null),
  location: z.string().default(''),
});
export type CalendarEventAspectData = z.infer<typeof CalendarEventAspectDataSchema>;

export const TimeLogAspectDataSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime().nullable().default(null),
  duration_seconds: z.number().int().nonnegative().nullable().default(null),
  window_title: z.string().default(''),
  billable: z.boolean().default(false),
  hourly_rate_cents: z.number().int().nonnegative().default(0),
  project: z.string().default(''),
  manual: z.boolean().default(false),
});
export type TimeLogAspectData = z.infer<typeof TimeLogAspectDataSchema>;

export const PomodoroAspectDataSchema = z.object({
  focus_minutes: z.number().int().positive().default(25),
  short_break_minutes: z.number().int().positive().default(5),
  long_break_minutes: z.number().int().positive().default(15),
  intervals_before_long: z.number().int().positive().default(4),
  current_interval: z.number().int().nonnegative().default(1),
  phase: z.enum(['focus', 'short_break', 'long_break', 'idle']).default('idle'),
  started_at: z.string().datetime().nullable().default(null),
  completed_sessions: z.number().int().nonnegative().default(0),
});
export type PomodoroAspectData = z.infer<typeof PomodoroAspectDataSchema>;

export const HabitAspectDataSchema = z.object({
  frequency: z.enum(['daily', 'weekly']).default('daily'),
  target_count: z.number().int().positive().default(1),
  /** ISO date strings (YYYY-MM-DD) → completion count. */
  completions: z.record(z.number().int().nonnegative()).default({}),
  archived: z.boolean().default(false),
});
export type HabitAspectData = z.infer<typeof HabitAspectDataSchema>;

export const BookmarkAspectDataSchema = z.object({
  url: z.string(),
  favicon_hash: z.string().nullable().default(null),
  pinned: z.boolean().default(false),
});
export type BookmarkAspectData = z.infer<typeof BookmarkAspectDataSchema>;

// ── tRPC context (shared between backend routes; safe to import everywhere) ──

/**
 * tRPC context shape — populated per-request in apps/backend.
 * Exported here so desktop client can mirror the type without pulling in
 * @trpc/server (which is Node-only).
 */
export interface TRPCContext {
  requestId: string;
}

/** Map aspect_type → data schema. Used by entityStore + aspect plugin registry. */
export const ASPECT_DATA_SCHEMAS = {
  note: NoteAspectDataSchema,
  task: TaskAspectDataSchema,
  calendar_event: CalendarEventAspectDataSchema,
  time_log: TimeLogAspectDataSchema,
  pomodoro_session: PomodoroAspectDataSchema,
  habit: HabitAspectDataSchema,
  bookmark: BookmarkAspectDataSchema,
} as const satisfies Record<AspectType, z.ZodType>;
