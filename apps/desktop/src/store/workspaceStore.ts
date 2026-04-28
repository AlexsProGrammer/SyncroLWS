import { create } from 'zustand';
import { getDB, loadWorkspaceDB, closeWorkspaceDB, getWorkspaceDB, setProfileSetting, getProfileSetting } from '@/core/db';
import { eventBus } from '@/core/events';
import { getAllTools } from '@/registry/ToolRegistry';
import {
  loadMembershipCache,
  loadWorkspaceViews,
  setWorkspaceViewParent,
  reconcileRemoteWorkspaces,
  SHARED_VIRTUAL_PARENT_ID,
  type MembershipCacheRow,
  type WorkspaceRole,
  type WorkspaceViewRow,
} from '@/core/sharing';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkspaceTool {
  id: string;          // instance UUID (PK)
  tool_id: string;     // e.g. "notes", "calendar"
  name: string;
  config: string;
  sort_order: number;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  parent_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  loading: boolean;
  workspaceTools: WorkspaceTool[];
  /** Phase U — local view-state overlay for shared workspaces. */
  workspaceViews: WorkspaceViewRow[];
  /** Phase U — caller's role per workspace + owner info. */
  membership: MembershipCacheRow[];
}

interface WorkspaceActions {
  /** Load all workspaces from the profile DB. */
  loadWorkspaces: () => Promise<void>;
  /** Create a new workspace and switch to it. */
  createWorkspace: (data: {
    name: string;
    description?: string;
    icon?: string;
    color?: string;
    parent_id?: string | null;
  }) => Promise<Workspace>;
  /** Switch to an existing workspace by ID. */
  switchWorkspace: (id: string) => Promise<void>;
  /** Update workspace metadata. */
  updateWorkspace: (
    id: string,
    data: Partial<Pick<Workspace, 'name' | 'description' | 'icon' | 'color' | 'parent_id' | 'sort_order'>>,
  ) => Promise<void>;
  /** Soft-delete a workspace. */
  deleteWorkspace: (id: string) => Promise<void>;
  /** Batch-update sort_order for a list of workspace IDs (in order). */
  reorderWorkspaces: (orderedIds: string[]) => Promise<void>;
  /** Get the last active workspace ID from profile DB. */
  getLastWorkspaceId: () => Promise<string | null>;
  /** (Re-)load workspace tools for the active workspace DB. */
  loadWorkspaceTools: () => Promise<void>;
  /** Phase U — load view-state + membership cache from DB. */
  loadSharingState: () => Promise<void>;
  /** Phase U — pull remote workspace list, merge into local mirrors. */
  reconcileShares: () => Promise<void>;
  /** Phase U — move a (shared) workspace into a folder; null = back to virtual "Shared with me". */
  moveSharedWorkspaceToFolder: (workspaceId: string, parentId: string | null) => Promise<void>;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useWorkspaceStore = create<WorkspaceState & WorkspaceActions>()(
  (set, get) => ({
    workspaces: [],
    activeWorkspaceId: null,
    loading: false,
    workspaceTools: [],
    workspaceViews: [],
    membership: [],

    loadWorkspaces: async () => {
      const db = getDB();
      const rows = await db.select<Workspace[]>(
        `SELECT * FROM workspaces WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`,
      );
      set({ workspaces: rows });
    },

    createWorkspace: async (data) => {
      const db = getDB();
      const now = new Date().toISOString();
      const id = crypto.randomUUID();

      const workspace: Workspace = {
        id,
        name: data.name,
        description: data.description ?? '',
        icon: data.icon ?? 'folder',
        color: data.color ?? '#6366f1',
        parent_id: data.parent_id ?? null,
        sort_order: get().workspaces.length,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };

      await db.execute(
        `INSERT INTO workspaces (id, name, description, icon, color, parent_id, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          workspace.id,
          workspace.name,
          workspace.description,
          workspace.icon,
          workspace.color,
          workspace.parent_id,
          workspace.sort_order,
          workspace.created_at,
          workspace.updated_at,
        ],
      );

      set((state) => ({
        workspaces: [...state.workspaces, workspace],
      }));

      // Auto-switch to the new workspace (but not for folders)
      if (data.icon !== 'folder-group') {
        await get().switchWorkspace(id);

        // Auto-seed default tools into the new workspace
        try {
          const wsDb = getWorkspaceDB();
          const tools = getAllTools();
          let firstInstanceId = '';
          for (let i = 0; i < tools.length; i++) {
            const tool = tools[i]!;
            const toolInstanceId = crypto.randomUUID();
            if (i === 0) firstInstanceId = toolInstanceId;
            await wsDb.execute(
              `INSERT INTO workspace_tools (id, tool_id, name, description, config, sort_order, created_at)
               VALUES (?, ?, ?, ?, '{}', ?, ?)`,
              [toolInstanceId, tool.id, tool.name, tool.manifest?.description ?? '', i, now],
            );
          }
          // Reload into store so App.tsx's instance map is fresh
          await get().loadWorkspaceTools();
          eventBus.emit('workspace:tool-added', { workspaceId: id, toolInstanceId: '', toolId: '' });
          // Notify App to auto-navigate to the first tool (by instance UUID)
          if (firstInstanceId) {
            eventBus.emit('workspace:tools-seeded', { firstInstanceId });
          }
        } catch (err) {
          console.warn('[workspace] auto-seed tools failed:', err);
        }
      }

      eventBus.emit('workspace:created', { id, name: workspace.name });
      return workspace;
    },

    switchWorkspace: async (id: string) => {
      const ws = get().workspaces.find((w) => w.id === id);
      if (!ws) {
        console.error(`[workspace] cannot switch — workspace ${id} not found`);
        return;
      }

      // Folders don't have a workspace DB — ignore switch
      if (ws.icon === 'folder-group') {
        return;
      }

      set({ loading: true });

      try {
        await loadWorkspaceDB(id);
        set({ activeWorkspaceId: id, loading: false });
        // Persist last active workspace for this profile
        void setProfileSetting('last_workspace_id', id);
        // Load workspace tools into store so App.tsx can resolve instance UUIDs
        void get().loadWorkspaceTools();
        eventBus.emit('workspace:switched', { id, name: ws.name });
      } catch (err) {
        console.error('[workspace] failed to switch:', err);
        set({ loading: false });
      }
    },

    updateWorkspace: async (id, data) => {
      const db = getDB();
      const now = new Date().toISOString();

      const sets: string[] = ['updated_at = ?'];
      const values: unknown[] = [now];

      if (data.name !== undefined) { sets.push('name = ?'); values.push(data.name); }
      if (data.description !== undefined) { sets.push('description = ?'); values.push(data.description); }
      if (data.icon !== undefined) { sets.push('icon = ?'); values.push(data.icon); }
      if (data.color !== undefined) { sets.push('color = ?'); values.push(data.color); }
      if (data.parent_id !== undefined) { sets.push('parent_id = ?'); values.push(data.parent_id); }
      if (data.sort_order !== undefined) { sets.push('sort_order = ?'); values.push(data.sort_order); }

      values.push(id);
      await db.execute(`UPDATE workspaces SET ${sets.join(', ')} WHERE id = ?`, values);

      set((state) => ({
        workspaces: state.workspaces.map((w) =>
          w.id === id ? { ...w, ...data, updated_at: now } : w,
        ),
      }));

      eventBus.emit('workspace:updated', { id });
    },

    deleteWorkspace: async (id: string) => {
      const db = getDB();
      const now = new Date().toISOString();

      await db.execute(`UPDATE workspaces SET deleted_at = ? WHERE id = ?`, [now, id]);

      // If this was the active workspace, close and switch away
      if (get().activeWorkspaceId === id) {
        await closeWorkspaceDB();
        const remaining = get().workspaces.filter((w) => w.id !== id);
        const nextId = remaining[0]?.id ?? null;
        set({
          workspaces: remaining,
          activeWorkspaceId: null,
        });
        if (nextId) {
          await get().switchWorkspace(nextId);
        }
      } else {
        set((state) => ({
          workspaces: state.workspaces.filter((w) => w.id !== id),
        }));
      }

      eventBus.emit('workspace:deleted', { id });
    },

    reorderWorkspaces: async (orderedIds: string[]) => {
      const db = getDB();
      const now = new Date().toISOString();

      // Update sort_order in DB for each workspace
      for (let i = 0; i < orderedIds.length; i++) {
        await db.execute(
          `UPDATE workspaces SET sort_order = ?, updated_at = ? WHERE id = ?`,
          [i, now, orderedIds[i]],
        );
      }

      // Update local state
      set((state) => ({
        workspaces: state.workspaces
          .map((w) => {
            const idx = orderedIds.indexOf(w.id);
            return idx >= 0 ? { ...w, sort_order: idx, updated_at: now } : w;
          })
          .sort((a, b) => a.sort_order - b.sort_order),
      }));
    },

    getLastWorkspaceId: async () => {
      return getProfileSetting('last_workspace_id');
    },

    loadWorkspaceTools: async () => {
      try {
        const db = getWorkspaceDB();
        const rows = await db.select<WorkspaceTool[]>(
          `SELECT id, tool_id, name, config, sort_order FROM workspace_tools ORDER BY sort_order ASC`,
        );
        set({ workspaceTools: rows });
      } catch {
        set({ workspaceTools: [] });
      }
    },

    // ── Phase U sharing actions ────────────────────────────────────────────
    loadSharingState: async () => {
      try {
        const [views, membership] = await Promise.all([
          loadWorkspaceViews(),
          loadMembershipCache(),
        ]);
        set({ workspaceViews: views, membership });
      } catch (err) {
        console.warn('[workspace] loadSharingState failed:', err);
        set({ workspaceViews: [], membership: [] });
      }
    },

    reconcileShares: async () => {
      try {
        await reconcileRemoteWorkspaces();
        // Refresh local mirrors so the Sidebar tree picks up new shares.
        await get().loadWorkspaces();
        await get().loadSharingState();
      } catch (err) {
        console.warn('[workspace] reconcileShares failed:', err);
      }
    },

    moveSharedWorkspaceToFolder: async (workspaceId, parentId) => {
      await setWorkspaceViewParent(workspaceId, parentId);
      const views = await loadWorkspaceViews();
      set({ workspaceViews: views });
    },
  }),
);

// ── Selectors ─────────────────────────────────────────────────────────────────

/** Build a tree structure from the flat workspace list. */
export function buildWorkspaceTree(workspaces: Workspace[]): (Workspace & { children: Workspace[] })[] {
  const map = new Map<string | null, Workspace[]>();

  for (const ws of workspaces) {
    const parentKey = ws.parent_id ?? null;
    if (!map.has(parentKey)) map.set(parentKey, []);
    map.get(parentKey)!.push(ws);
  }

  function buildChildren(parentId: string | null): (Workspace & { children: Workspace[] })[] {
    const children = map.get(parentId) ?? [];
    return children.map((ws) => ({
      ...ws,
      children: buildChildren(ws.id),
    }));
  }

  return buildChildren(null);
}

// ── Phase U selectors ─────────────────────────────────────────────────────────

export { SHARED_VIRTUAL_PARENT_ID };

/** Returns the caller's role for the given workspace, or 'owner' if it isn't
 *  in the membership cache (i.e. personal-mode / locally-owned workspace). */
export function workspaceRole(
  workspaceId: string,
  membership: MembershipCacheRow[],
): WorkspaceRole {
  return membership.find((m) => m.workspace_id === workspaceId)?.role ?? 'owner';
}

/** True when the caller can write to this workspace (owner or editor). */
export function canMutateWorkspace(
  workspaceId: string,
  membership: MembershipCacheRow[],
): boolean {
  const role = workspaceRole(workspaceId, membership);
  return role === 'owner' || role === 'editor';
}

/**
 * Compose the Sidebar tree for an enterprise profile:
 *   - Owned/personal workspaces use `workspaces.parent_id` as before.
 *   - Shared workspaces (caller is editor or viewer) use `workspace_view.parent_id`
 *     when set; otherwise they are grouped under a synthetic "Shared with me"
 *     folder (id = SHARED_VIRTUAL_PARENT_ID).
 */
export function buildSidebarTree(
  workspaces: Workspace[],
  membership: MembershipCacheRow[],
  views: WorkspaceViewRow[],
): (Workspace & { children: Workspace[] })[] {
  const viewByWs = new Map(views.map((v) => [v.workspace_id, v]));
  const roleByWs = new Map(membership.map((m) => [m.workspace_id, m.role]));

  const sharedOrphans: Workspace[] = [];
  const remapped: Workspace[] = [];
  let hasShared = false;

  for (const w of workspaces) {
    const role = roleByWs.get(w.id);
    const isShared = role === 'editor' || role === 'viewer';
    if (!isShared) {
      remapped.push(w);
      continue;
    }
    hasShared = true;
    const view = viewByWs.get(w.id);
    if (view?.hidden) continue;
    if (view && view.parent_id) {
      remapped.push({ ...w, parent_id: view.parent_id });
    } else {
      sharedOrphans.push({ ...w, parent_id: SHARED_VIRTUAL_PARENT_ID });
    }
  }

  if (hasShared && sharedOrphans.length > 0) {
    const synthetic: Workspace = {
      id: SHARED_VIRTUAL_PARENT_ID,
      name: 'Shared with me',
      description: '',
      icon: 'folder-group',
      color: '#64748b',
      parent_id: null,
      sort_order: 9999,
      created_at: '',
      updated_at: '',
      deleted_at: null,
    };
    remapped.push(synthetic, ...sharedOrphans);
  }

  return buildWorkspaceTree(remapped);
}
