/**
 * Phase U — Workspace sharing client.
 *
 * Wraps the backend `auth.workspaces.*` tRPC routes for the desktop app
 * and reconciles remote membership into local mirrors:
 *   - `workspaces` (so shared workspaces appear in the Sidebar tree)
 *   - `workspace_membership_cache` (role + member list for the rights badge)
 *   - `workspace_view`            (per-profile parent-folder override; defaults
 *                                  to NULL → virtual "Shared with me" group)
 *
 * Personal-mode profiles never invoke this module.
 */
import { getDB } from '@/core/db';
import { useSyncStore } from '@/store/syncStore';
import { eventBus } from '@/core/events';

// ── Types ────────────────────────────────────────────────────────────────────

export type WorkspaceRole = 'owner' | 'editor' | 'viewer';

export interface RemoteWorkspace {
  id: string;
  name: string;
  icon: string;
  color: string;
  created_at: string;
  role: WorkspaceRole;
  is_owner: boolean;
  owner: { id: string; email: string; display_name: string };
}

export interface RemoteMember {
  user_id: string;
  email: string;
  display_name: string;
  org_role: 'admin' | 'member';
  role: WorkspaceRole;
  invited_by: string | null;
  accepted_at: string | null;
  created_at: string;
  disabled: boolean;
}

// Sentinel parent id for the synthetic "Shared with me" folder rendered in
// the Sidebar. NEVER persisted to the workspaces table — it lives only in
// memory and is the default rendering bucket for shared workspaces whose
// `workspace_view.parent_id` is NULL.
export const SHARED_VIRTUAL_PARENT_ID = '__shared__';

// ── tRPC plumbing ────────────────────────────────────────────────────────────

function trpcUrl(serverUrl: string, route: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/trpc/${route}`;
}

async function call<T>(route: string, input: unknown, method: 'query' | 'mutation'): Promise<T> {
  const { syncUrl, userToken } = useSyncStore.getState();
  if (!syncUrl) throw new Error('Server URL not configured.');
  if (!userToken) throw new Error('Not signed in.');

  const url = method === 'query'
    ? `${trpcUrl(syncUrl, route)}?input=${encodeURIComponent(JSON.stringify(input))}`
    : trpcUrl(syncUrl, route);

  const res = await fetch(url, {
    method: method === 'query' ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userToken}`,
    },
    body: method === 'mutation' ? JSON.stringify(input) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 401) {
    eventBus.emit('auth:expired', { reason: 'rejected' });
    throw new Error('Authentication expired.');
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body?.error?.message ?? body?.error?.json?.message ?? message;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  const json = await res.json();
  return json?.result?.data as T;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function listRemoteWorkspaces(): Promise<RemoteWorkspace[]> {
  const data = await call<RemoteWorkspace[]>('auth.workspaces.list', undefined, 'query');
  return Array.isArray(data) ? data : [];
}

export async function listMembers(workspace_id: string): Promise<RemoteMember[]> {
  const data = await call<RemoteMember[]>('auth.workspaces.members', { workspace_id }, 'query');
  return Array.isArray(data) ? data : [];
}

export async function inviteMember(
  workspace_id: string,
  email: string,
  role: 'editor' | 'viewer',
): Promise<void> {
  await call('auth.workspaces.invite', { workspace_id, email, role }, 'mutation');
}

export async function setMemberRole(
  workspace_id: string,
  user_id: string,
  role: WorkspaceRole,
): Promise<void> {
  await call('auth.workspaces.setMemberRole', { workspace_id, user_id, role }, 'mutation');
}

export async function removeMember(workspace_id: string, user_id: string): Promise<void> {
  await call('auth.workspaces.removeMember', { workspace_id, user_id }, 'mutation');
}

export async function leaveWorkspace(workspace_id: string): Promise<void> {
  await call('auth.workspaces.leave', { workspace_id }, 'mutation');
}

export async function createRemoteWorkspace(input: {
  id: string;
  name: string;
  icon?: string;
  color?: string;
}): Promise<void> {
  await call('auth.workspaces.create', input, 'mutation');
}

// ── Reconcile ────────────────────────────────────────────────────────────────

/**
 * Pulls `auth.workspaces.list`, then merges into the local profile DB:
 *   - inserts/updates rows in `workspaces` for any remote workspace not yet
 *     present locally (so the Sidebar tree can show them).
 *   - replaces `workspace_membership_cache` for the calling user.
 *   - leaves `workspace_view` untouched (defaults to NULL parent → virtual
 *     "Shared with me" folder for new shares).
 *
 * Returns the remote list so callers can refresh local UI without a second
 * round trip.
 */
export async function reconcileRemoteWorkspaces(): Promise<RemoteWorkspace[]> {
  const remote = await listRemoteWorkspaces();
  const db = getDB();
  const now = new Date().toISOString();

  // 1. Upsert workspaces row for each remote one we don't already have.
  //    For shared (non-owner) workspaces we set parent_id = NULL so the
  //    Sidebar's tree builder treats them as roots; the virtual folder
  //    layering happens in the renderer based on the membership cache.
  for (const w of remote) {
    const existing = await db.select<{ id: string }[]>(
      `SELECT id FROM workspaces WHERE id = ?`,
      [w.id],
    );
    if (existing.length === 0) {
      await db.execute(
        `INSERT INTO workspaces
           (id, name, description, icon, color, parent_id, sort_order, created_at, updated_at)
         VALUES (?, ?, '', ?, ?, NULL, 0, ?, ?)`,
        [w.id, w.name, w.icon || 'folder', w.color || '#6366f1', w.created_at, now],
      );
    } else {
      // Refresh name/icon/color but DON'T touch parent_id — that's user-controlled.
      await db.execute(
        `UPDATE workspaces SET name = ?, icon = ?, color = ?, updated_at = ?, deleted_at = NULL
         WHERE id = ?`,
        [w.name, w.icon || 'folder', w.color || '#6366f1', now, w.id],
      );
    }
  }

  // 2. Refresh membership cache. We don't have member_user_ids in the list
  //    response (it's per-workspace); store [owner_id] as a placeholder and
  //    let ManageMembersDialog fetch the full list lazily.
  await db.execute(`DELETE FROM workspace_membership_cache`);
  for (const w of remote) {
    await db.execute(
      `INSERT INTO workspace_membership_cache
         (workspace_id, owner_user_id, owner_display_name, role, member_user_ids, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        w.id,
        w.owner.id,
        w.owner.display_name || w.owner.email || '',
        w.role,
        JSON.stringify([w.owner.id]),
        now,
      ],
    );
  }

  // 3. Mark workspaces no longer in the remote list as hidden in local view
  //    (don't delete — user may still be browsing cached data).
  if (remote.length > 0) {
    const remoteIds = remote.map((w) => w.id);
    const placeholders = remoteIds.map(() => '?').join(',');
    await db.execute(
      `UPDATE workspace_view SET hidden = 1
       WHERE workspace_id NOT IN (${placeholders})`,
      remoteIds,
    );
  }

  eventBus.emit('sharing:reconciled', { count: remote.length });
  return remote;
}

// ── Local view-state helpers ────────────────────────────────────────────────

export interface WorkspaceViewRow {
  workspace_id: string;
  parent_id: string | null;
  sort_order: number;
  hidden: boolean;
}

export async function loadWorkspaceViews(): Promise<WorkspaceViewRow[]> {
  const db = getDB();
  const rows = await db.select<{
    workspace_id: string;
    parent_id: string | null;
    sort_order: number;
    hidden: number;
  }[]>(`SELECT workspace_id, parent_id, sort_order, hidden FROM workspace_view`);
  return rows.map((r) => ({
    workspace_id: r.workspace_id,
    parent_id: r.parent_id,
    sort_order: r.sort_order,
    hidden: !!r.hidden,
  }));
}

export async function setWorkspaceViewParent(
  workspace_id: string,
  parent_id: string | null,
): Promise<void> {
  const db = getDB();
  // Treat the synthetic shared parent as NULL on disk — it's the default.
  const persistedParent = parent_id === SHARED_VIRTUAL_PARENT_ID ? null : parent_id;
  await db.execute(
    `INSERT INTO workspace_view (workspace_id, parent_id, sort_order, hidden)
     VALUES (?, ?, 0, 0)
     ON CONFLICT(workspace_id) DO UPDATE SET parent_id = excluded.parent_id`,
    [workspace_id, persistedParent],
  );
}

export interface MembershipCacheRow {
  workspace_id: string;
  owner_user_id: string;
  owner_display_name: string;
  role: WorkspaceRole;
  member_user_ids: string[];
}

export async function loadMembershipCache(): Promise<MembershipCacheRow[]> {
  const db = getDB();
  const rows = await db.select<{
    workspace_id: string;
    owner_user_id: string;
    owner_display_name: string;
    role: string;
    member_user_ids: string;
  }[]>(
    `SELECT workspace_id, owner_user_id, owner_display_name, role, member_user_ids
     FROM workspace_membership_cache`,
  );
  return rows.map((r) => {
    let ids: string[] = [];
    try { ids = JSON.parse(r.member_user_ids || '[]'); } catch { /* ignore */ }
    return {
      workspace_id: r.workspace_id,
      owner_user_id: r.owner_user_id,
      owner_display_name: r.owner_display_name,
      role: r.role as WorkspaceRole,
      member_user_ids: Array.isArray(ids) ? ids : [],
    };
  });
}
