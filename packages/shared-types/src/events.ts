import type { BaseEntity, EntityAspect, EntityCore, EntityRelation, AspectType } from './base-entity';

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
  /**
   * Emitted by the entityStore on every local mutation that needs to be
   * pushed. The sync engine listens for this to wake up and schedule a push.
   */
  'sync:dirty': void;
  /** Sync engine status update (last pull/push, pending count, error). */
  'sync:status': {
    connected: boolean;
    last_pulled_at: string | null;
    last_pushed_at: string | null;
    pending_changes: number;
    last_error: string | null;
  };
  /** Fired when the same entity was modified offline AND on the server */
  'sync:conflict': {
    kind: 'core' | 'aspect' | 'relation' | 'delete';
    id: string;
    server_revision: number;
  };

  // ── Hybrid entity model ───────────────────────────────────────────────────
  // Emitted by the entityStore. Phase G.3 removed the legacy `entity:*` events.
  /** A new base entity (with optional initial aspects) was created. */
  'core:created': { core: EntityCore; aspects: EntityAspect[] };
  /** Shared core fields (title/description/color/icon/tags/parent_id) changed. */
  'core:updated': { core: EntityCore };
  /** Soft-deleted (hidden everywhere). */
  'core:deleted': { id: string };
  'aspect:added': { aspect: EntityAspect };
  'aspect:updated': { aspect: EntityAspect };
  'aspect:removed': { id: string; entity_id: string; aspect_type: AspectType };
  'relation:added': { relation: EntityRelation };
  'relation:removed': { id: string; from_entity_id: string; to_entity_id: string };

  // ── Navigation ────────────────────────────────────────────────────────────
  'nav:open-entity': { id: string; type: BaseEntity['type'] };
  /** Phase C — open the universal hybrid-entity detail sheet. */
  'nav:open-detail-sheet': { id: string; initialAspectType?: AspectType };
  /** Phase D — open the AddAspectDialog for a given entity. */
  'nav:add-aspect': { entityId: string; existingTypes: string[]; initialType?: AspectType };
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
  'workspace:tools-seeded': { firstInstanceId: string };

  // ── Profile ───────────────────────────────────────────────────────────────
  'profile:switched': { id: string };

  // ── Auth (Phase S — enterprise mode) ──────────────────────────────────────
  /** User token expired or rejected by server (HTTP 401). UI should prompt
   *  re-login; sync engine pauses pushes. */
  'auth:expired': { reason: 'expired' | 'revoked' | 'rejected' };
  /** Server returned must_change_password during login or a request was
   *  rejected with FORBIDDEN/Password change required. */
  'auth:must-change-password': { userId: string };
  /** Successful sign-in (full-scope token established). */
  'auth:signed-in': { userId: string; orgRole: 'admin' | 'member' };
  /** Sign-out / clearUserSession invoked. */
  'auth:signed-out': void;

  // ── App lock (Phase T) ────────────────────────────────────────────────────
  'lock:locked': void;
  'lock:unlocked': void;
};
