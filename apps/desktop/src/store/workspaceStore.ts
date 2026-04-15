import { create } from 'zustand';
import { getDB, loadWorkspaceDB, closeWorkspaceDB } from '@/core/db';
import { eventBus } from '@/core/events';

// ── Types ─────────────────────────────────────────────────────────────────────

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
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useWorkspaceStore = create<WorkspaceState & WorkspaceActions>()(
  (set, get) => ({
    workspaces: [],
    activeWorkspaceId: null,
    loading: false,

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

      // Auto-switch to the new workspace
      await get().switchWorkspace(id);

      eventBus.emit('workspace:created', { id, name: workspace.name });
      return workspace;
    },

    switchWorkspace: async (id: string) => {
      const ws = get().workspaces.find((w) => w.id === id);
      if (!ws) {
        console.error(`[workspace] cannot switch — workspace ${id} not found`);
        return;
      }

      set({ loading: true });

      try {
        await loadWorkspaceDB(id);
        set({ activeWorkspaceId: id, loading: false });
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
