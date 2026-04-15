import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Profile {
  id: string;   // UUID
  name: string;
  avatar_url?: string;
  color?: string;
}

interface ProfileState {
  profiles: Profile[];
  activeProfileId: string | null;
}

interface ProfileActions {
  /** Create a new profile, persist it, and set it as active. */
  createProfile: (name: string) => Promise<Profile>;
  /** Switch to an existing profile by UUID. */
  setActiveProfile: (id: string) => void;
  /** Rename an existing profile. */
  renameProfile: (id: string, name: string) => void;
  /** Delete a profile (does NOT delete files on disk). */
  deleteProfile: (id: string) => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useProfileStore = create<ProfileState & ProfileActions>()(
  persist(
    (set, get) => ({
      profiles: [],
      activeProfileId: null,

      createProfile: async (name: string): Promise<Profile> => {
        const id = crypto.randomUUID();

        // Create the physical folder via Tauri command
        await invoke<string>('create_profile_folder', { uuid: id });

        const profile: Profile = { id, name };
        set((state) => ({
          profiles: [...state.profiles, profile],
          activeProfileId: id,
        }));

        return profile;
      },

      setActiveProfile: (id: string) => {
        const exists = get().profiles.some((p) => p.id === id);
        if (!exists) {
          console.error(`[profile] cannot switch — profile ${id} not found`);
          return;
        }
        set({ activeProfileId: id });
      },

      renameProfile: (id: string, name: string) => {
        set((state) => ({
          profiles: state.profiles.map((p) =>
            p.id === id ? { ...p, name } : p,
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
