import type { BaseEntity } from './base-entity';

/**
 * All events emitted on the global Event Bus (mitt).
 * Keys follow the pattern  domain:action.
 * Modules MUST only communicate through these events — never via direct imports.
 */
export type AppEvents = {
  // ── Sync ──────────────────────────────────────────────────────────────────
  'sync:start': void;
  'sync:complete': { synced_at: string };
  'sync:error': { message: string };
  /** Fired when the same entity was modified offline AND on the server */
  'sync:conflict': {
    local: BaseEntity;
    server: BaseEntity;
    resolve: (resolved: BaseEntity) => void;
  };

  // ── Entity CRUD ───────────────────────────────────────────────────────────
  'entity:created': { entity: BaseEntity };
  'entity:updated': { entity: BaseEntity };
  'entity:deleted': { id: string; type: BaseEntity['type'] };

  // ── Navigation ────────────────────────────────────────────────────────────
  'nav:open-entity': { id: string; type: BaseEntity['type'] };
  'nav:open-command-palette': void;
  'nav:close-command-palette': void;

  // ── Time Tracker ──────────────────────────────────────────────────────────
  'tracker:window-changed': { window_title: string; timestamp: string };
  'tracker:start': { description: string };
  'tracker:stop': { time_log_id: string };

  // ── Pomodoro ──────────────────────────────────────────────────────────────
  'pomodoro:started': { phase: 'focus' | 'short_break' | 'long_break'; label: string };
  'pomodoro:completed': { phase: 'focus' | 'short_break' | 'long_break'; label: string };
  'pomodoro:stopped': void;

  // ── Notifications ─────────────────────────────────────────────────────────
  'notification:show': { title: string; body: string; type: 'info' | 'warning' | 'error' };

  // ── Deep Links ────────────────────────────────────────────────────────────
  'deeplink:received': { path: string; params: Record<string, string> };

  // ── Settings ──────────────────────────────────────────────────────────────
  /** Emitted when tool toggle state changes in the Settings UI */
  'settings:tools-changed': void;
  /** Emitted to switch to a specific settings tab */
  'settings:open-tab': string;

  // ── Workspace ─────────────────────────────────────────────────────────────
  'workspace:created': { id: string; name: string };
  'workspace:switched': { id: string; name: string };
  'workspace:deleted': { id: string };
  'workspace:updated': { id: string };
  'workspace:tool-added': { workspaceId: string; toolInstanceId: string; toolId: string };
  'workspace:tool-removed': { workspaceId: string; toolInstanceId: string };
  'workspace:tools-seeded': { firstToolId: string };

  // ── Profile ───────────────────────────────────────────────────────────────
  'profile:switched': { id: string };
};
