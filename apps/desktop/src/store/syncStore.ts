import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SyncState {
  /** Backend URL (e.g. http://localhost:3000) */
  syncUrl: string;
  /** API key / JWT for authenticating with the backend */
  apiKey: string;
  /** Whether sync is currently enabled */
  isSyncActive: boolean;
}

interface SyncActions {
  setSyncUrl: (url: string) => void;
  setApiKey: (key: string) => void;
  setIsSyncActive: (active: boolean) => void;
  /** Reset all sync configuration to defaults */
  resetSync: () => void;
}

const INITIAL_STATE: SyncState = {
  syncUrl: '',
  apiKey: '',
  isSyncActive: false,
};

// ── Store ─────────────────────────────────────────────────────────────────────

export const useSyncStore = create<SyncState & SyncActions>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,

      setSyncUrl: (url: string) => set({ syncUrl: url }),
      setApiKey: (key: string) => set({ apiKey: key }),
      setIsSyncActive: (active: boolean) => set({ isSyncActive: active }),
      resetSync: () => set(INITIAL_STATE),
    }),
    {
      name: 'syncrolws-sync',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
