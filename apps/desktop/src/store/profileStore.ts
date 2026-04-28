import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { loadProfileDB } from '@/core/db';
import { eventBus } from '@/core/events';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProfileMode = 'personal' | 'enterprise';

export interface Profile {
  id: string;   // UUID
  name: string;
  avatar_url?: string;
  color?: string;
  /** Phase S — controls the auth + sync model used by this profile.
   *  Defaults to 'personal' for back-compat with pre-Phase-S profiles. */
  mode?: ProfileMode;
}

interface ProfileState {
  profiles: Profile[];
  activeProfileId: string | null;
}

interface ProfileActions {
  /** Create a new profile, persist it, and set it as active. */
  createProfile: (name: string, color?: string, mode?: ProfileMode) => Promise<Profile>;
  /** Switch to an existing profile — reloads DBs and workspaces. */
  setActiveProfile: (id: string) => Promise<void>;
  /** Whether a profile switch is in progress. */
  switching: boolean;
  /** Rename an existing profile. */
  renameProfile: (id: string, name: string) => void;
  /** Update profile fields (name, color, avatar_url, mode). */
  updateProfile: (id: string, data: Partial<Pick<Profile, 'name' | 'color' | 'avatar_url' | 'mode'>>) => void;
  /** Delete a profile (does NOT delete files on disk). */
  deleteProfile: (id: string) => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useProfileStore = create<ProfileState & ProfileActions>()(
  persist(
    (set, get) => ({
      profiles: [],
      activeProfileId: null,
      switching: false,

      createProfile: async (name: string, color?: string, mode: ProfileMode = 'personal'): Promise<Profile> => {
        const id = crypto.randomUUID();

        // Create the physical folder via Tauri command
        await invoke<string>('create_profile_folder', { uuid: id });

        const profile: Profile = { id, name, color: color ?? '#6366f1', mode };
        set((state) => ({
          profiles: [...state.profiles, profile],
          activeProfileId: id,
        }));

        return profile;
      },

      setActiveProfile: async (id: string) => {
        const exists = get().profiles.some((p) => p.id === id);
        if (!exists) {
          console.error(`[profile] cannot switch — profile ${id} not found`);
          return;
        }
        if (id === get().activeProfileId) return;

        set({ switching: true });

        try {
          // Import workspaceStore lazily to avoid circular dependency
          const { useWorkspaceStore } = await import('./workspaceStore');

          // 1. Load the new profile's database (closes old profile + workspace DBs)
          await loadProfileDB(id);

          // 2. Update active profile in store
          set({ activeProfileId: id });

          // 3. Reload workspaces from the new profile DB
          const wsStore = useWorkspaceStore.getState();
          // Reset workspace state before loading
          useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
          await wsStore.loadWorkspaces();

          // 4. Switch to the first non-folder workspace (if any)
          const workspaces = useWorkspaceStore.getState().workspaces;
          const firstReal = workspaces.find((w) => w.icon !== 'folder-group');
          if (firstReal) {
            await wsStore.switchWorkspace(firstReal.id);
          }

          // 5. Emit event so App.tsx can react (reset view, etc.)
          eventBus.emit('profile:switched', { id });

          console.log(`[profile] switched to: ${id}`);
        } catch (err) {
          console.error('[profile] switch failed:', err);
          eventBus.emit('notification:show', {
            title: 'Profile switch failed',
            body: err instanceof Error ? err.message : String(err),
            type: 'error',
          });
        } finally {
          set({ switching: false });
        }
      },

      renameProfile: (id: string, name: string) => {
        set((state) => ({
          profiles: state.profiles.map((p) =>
            p.id === id ? { ...p, name } : p,
          ),
        }));
      },

      updateProfile: (id: string, data: Partial<Pick<Profile, 'name' | 'color' | 'avatar_url' | 'mode'>>) => {
        set((state) => ({
          profiles: state.profiles.map((p) =>
            p.id === id ? { ...p, ...data } : p,
          ),
        }));
      },

      deleteProfile: (id: string) => {
        set((state) => {
          const profiles = state.profiles.filter((p) => p.id !== id);
          const activeProfileId =
            state.activeProfileId === id
              ? (profiles[0]?.id ?? null)
              : state.activeProfileId;
          return { profiles, activeProfileId };
        });
      },
    }),
    {
      name: 'syncrolws-profiles',
      storage: createJSONStorage(() => localStorage),
      // Only persist the data, not the action functions
      partialize: (state) => ({
        profiles: state.profiles,
        activeProfileId: state.activeProfileId,
      }),
    },
  ),
);
