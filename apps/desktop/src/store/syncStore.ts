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
}

interface SyncActions {
  setSyncUrl: (url: string) => void;
  setIsSyncActive: (active: boolean) => void;
  setPairing: (p: { token: string; deviceId: string; deviceName: string; profileId: string }) => void;
  /** Drop the device JWT (e.g. revoked by owner). Keeps URL. */
  clearPairing: () => void;
  /** Reset all sync configuration to defaults. */
  resetSync: () => void;
}

const INITIAL_STATE: SyncState = {
  syncUrl: '',
  deviceToken: '',
  deviceId: '',
  deviceName: '',
  profileId: '',
  isSyncActive: false,
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
        }),
      resetSync: () => set(INITIAL_STATE),
    }),
    {
      name: 'syncrolws-sync',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
