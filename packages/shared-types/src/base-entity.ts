import { z } from 'zod';

export type EntityType =
  | 'note'
  | 'task'
  | 'calendar_event'
  | 'time_log'
  | 'project'
  | 'file_attachment'
  | 'workspace_tool';

/** Mandatory fields every Base Entity must carry */
export const BaseEntitySchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['note', 'task', 'calendar_event', 'time_log', 'project', 'file_attachment', 'workspace_tool']),
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
  content_md: z.string(),
  /** Bi-directional links extracted from [[Name]] syntax */
  linked_entity_ids: z.array(z.string().uuid()).default([]),
});

export const TaskPayloadSchema = z.object({
  title: z.string(),
  description: z.string().default(''),
  status: z.enum(['todo', 'in_progress', 'done', 'cancelled']).default('todo'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  due_date: z.string().datetime().nullable().default(null),
  assigned_to: z.string().nullable().default(null),
  file_hashes: z.array(z.string()).default([]),
});

export const CalendarEventPayloadSchema = z.object({
  title: z.string(),
  start: z.string().datetime(),
  end: z.string().datetime(),
  all_day: z.boolean().default(false),
  recurrence_rule: z.string().nullable().default(null),
  location: z.string().default(''),
});

export const TimeLogPayloadSchema = z.object({
  description: z.string(),
  start: z.string().datetime(),
  end: z.string().datetime().nullable().default(null),
  duration_seconds: z.number().int().nonnegative().nullable().default(null),
  window_title: z.string().default(''),
  billable: z.boolean().default(false),
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
export type CalendarEventPayload = z.infer<typeof CalendarEventPayloadSchema>;
export type TimeLogPayload = z.infer<typeof TimeLogPayloadSchema>;
