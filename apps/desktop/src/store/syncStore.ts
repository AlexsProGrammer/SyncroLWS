import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Sync configuration. Phase H pairing model:
 *   - syncUrl: backend base URL.
 *   - deviceToken: long-lived device JWT minted by the owner during pairing.
 *     Owner password is never persisted.
 *   - deviceId / deviceName: returned at pair time, shown in Settings.
 *   - profileId: the profile bound to this device row on the server.
 */
interface SyncState {
  syncUrl: string;
  deviceToken: string;
  deviceId: string;
  deviceName: string;
  profileId: string;
  isSyncActive: boolean;
  // ── Phase I runtime status (NOT persisted) ──────────────────────────────
  /** True while a pull or push is in flight. */
  inFlight: boolean;
  /** ISO timestamp of last successful pull. */
  lastPulledAt: string | null;
  /** ISO timestamp of last successful push. */
  lastPushedAt: string | null;
  /** Number of dirty rows + tombstones waiting to push. */
  pendingChanges: number;
  /** Last sync error message, cleared on next successful round-trip. */
  lastError: string | null;
}

interface SyncActions {
  setSyncUrl: (url: string) => void;
  setIsSyncActive: (active: boolean) => void;
  setPairing: (p: { token: string; deviceId: string; deviceName: string; profileId: string }) => void;
  /** Drop the device JWT (e.g. revoked by owner). Keeps URL. */
  clearPairing: () => void;
  /** Reset all sync configuration to defaults. */
  resetSync: () => void;
  /** Update transient sync status fields (called by the sync engine). */
  setStatus: (patch: Partial<Pick<SyncState, 'inFlight' | 'lastPulledAt' | 'lastPushedAt' | 'pendingChanges' | 'lastError'>>) => void;
}

const INITIAL_STATE: SyncState = {
  syncUrl: '',
  deviceToken: '',
  deviceId: '',
  deviceName: '',
  profileId: '',
  isSyncActive: false,
  inFlight: false,
  lastPulledAt: null,
  lastPushedAt: null,
  pendingChanges: 0,
  lastError: null,
};

export const useSyncStore = create<SyncState & SyncActions>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,
      setSyncUrl: (url) => set({ syncUrl: url }),
      setIsSyncActive: (active) => set({ isSyncActive: active }),
      setPairing: ({ token, deviceId, deviceName, profileId }) =>
        set({
          deviceToken: token,
          deviceId,
          deviceName,
          profileId,
          isSyncActive: true,
        }),
      clearPairing: () =>
        set({
          deviceToken: '',
          deviceId: '',
          deviceName: '',
          profileId: '',
          isSyncActive: false,
          inFlight: false,
          lastPulledAt: null,
          lastPushedAt: null,
          pendingChanges: 0,
          lastError: null,
        }),
      resetSync: () => set(INITIAL_STATE),
      setStatus: (patch) => set(patch),
    }),
    {
      name: 'syncrolws-sync',
      storage: createJSONStorage(() => localStorage),
      // Transient status fields are recomputed at boot — don't persist them.
      partialize: (state) => ({
        syncUrl: state.syncUrl,
        deviceToken: state.deviceToken,
        deviceId: state.deviceId,
        deviceName: state.deviceName,
        profileId: state.profileId,
        isSyncActive: state.isSyncActive,
      }),
    },
  ),
);
