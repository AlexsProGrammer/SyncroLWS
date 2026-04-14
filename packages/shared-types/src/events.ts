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

  // ── Notifications ─────────────────────────────────────────────────────────
  'notification:show': { title: string; body: string; type: 'info' | 'warning' | 'error' };

  // ── Deep Links ────────────────────────────────────────────────────────────
  'deeplink:received': { path: string; params: Record<string, string> };
};
