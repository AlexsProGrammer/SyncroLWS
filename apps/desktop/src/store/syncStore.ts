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
  /**
   * Phase J: opt-in toggle for at-rest encryption of sync payloads.
   * Persisted, but the actual encryption pipeline is a future Phase
   * J/N follow-up — for now this is purely a UI flag (no-op in engine).
   */
  encryptAtRest: boolean;

  // ── Phase S: enterprise user session (persisted) ─────────────────────────
  /** Long-lived (full-scope) user JWT minted by /auth.login. Empty when
   *  the active profile is in personal mode or no user is signed in. */
  userToken: string;
  /** ISO expiry of the userToken (best-effort — the server is the source
   *  of truth). */
  tokenExpiresAt: string | null;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  orgRole: 'admin' | 'member' | '';
  /** Set by /auth.login when the server reports must_change_password.
   *  UI must show a forced-change dialog before any other action. */
  mustChangePassword: boolean;

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
  /** True when the OS / browser reports network connectivity. */
  online: boolean;
  /** True when the app window is visible (document.visibilityState === 'visible'). */
  windowVisible: boolean;
  /** Phase S — read-only mode flag. Set when the user token is rejected
   *  (401) and we cannot reach the server to refresh. UI shows a banner;
   *  entityStore mutations are blocked until cleared. */
  readonly: boolean;
}

interface SyncActions {
  setSyncUrl: (url: string) => void;
  setIsSyncActive: (active: boolean) => void;
  setEncryptAtRest: (enabled: boolean) => void;
  setPairing: (p: { token: string; deviceId: string; deviceName: string; profileId: string }) => void;
  /** Drop the device JWT (e.g. revoked by owner). Keeps URL. */
  clearPairing: () => void;
  /** Phase S — install an enterprise user session after /auth.login. */
  setUserSession: (s: {
    serverUrl?: string;
    token: string;
    expiresAt: string | null;
    userId: string;
    email: string;
    displayName: string;
    orgRole: 'admin' | 'member';
    mustChangePassword?: boolean;
  }) => void;
  /** Phase S — clear the enterprise user session (sign out / token expired). */
  clearUserSession: () => void;
  /** Phase S — mark mustChangePassword (cleared after successful change). */
  setMustChangePassword: (v: boolean) => void;
  /** Phase S — toggle read-only mode. */
  setReadonly: (v: boolean) => void;
  /** Reset all sync configuration to defaults. */
  resetSync: () => void;
  /** Update transient sync status fields (called by the sync engine). */
  setStatus: (patch: Partial<Pick<SyncState, 'inFlight' | 'lastPulledAt' | 'lastPushedAt' | 'pendingChanges' | 'lastError' | 'online' | 'windowVisible'>>) => void;
}

const INITIAL_STATE: SyncState = {
  syncUrl: '',
  deviceToken: '',
  deviceId: '',
  deviceName: '',
  profileId: '',
  isSyncActive: false,
  encryptAtRest: false,
  userToken: '',
  tokenExpiresAt: null,
  userId: '',
  userEmail: '',
  userDisplayName: '',
  orgRole: '',
  mustChangePassword: false,
  inFlight: false,
  lastPulledAt: null,
  lastPushedAt: null,
  pendingChanges: 0,
  lastError: null,
  // Defaulted optimistically; the engine refreshes both at boot.
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  windowVisible: typeof document !== 'undefined' ? document.visibilityState !== 'hidden' : true,
  readonly: false,
};

export const useSyncStore = create<SyncState & SyncActions>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,
      setSyncUrl: (url) => set({ syncUrl: url }),
      setIsSyncActive: (active) => set({ isSyncActive: active }),
      setEncryptAtRest: (enabled) => set({ encryptAtRest: enabled }),
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
      setUserSession: ({ serverUrl, token, expiresAt, userId, email, displayName, orgRole, mustChangePassword }) =>
        set((s) => ({
          syncUrl: serverUrl ?? s.syncUrl,
          userToken: token,
          tokenExpiresAt: expiresAt,
          userId,
          userEmail: email,
          userDisplayName: displayName,
          orgRole,
          mustChangePassword: !!mustChangePassword,
          isSyncActive: !mustChangePassword,
          readonly: false,
          lastError: null,
        })),
      clearUserSession: () =>
        set({
          userToken: '',
          tokenExpiresAt: null,
          userId: '',
          userEmail: '',
          userDisplayName: '',
          orgRole: '',
          mustChangePassword: false,
          isSyncActive: false,
          readonly: false,
          inFlight: false,
          pendingChanges: 0,
        }),
      setMustChangePassword: (v) => set({ mustChangePassword: v }),
      setReadonly: (v) => set({ readonly: v }),
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
        encryptAtRest: state.encryptAtRest,
        userToken: state.userToken,
        tokenExpiresAt: state.tokenExpiresAt,
        userId: state.userId,
        userEmail: state.userEmail,
        userDisplayName: state.userDisplayName,
        orgRole: state.orgRole,
        mustChangePassword: state.mustChangePassword,
      }),
    },
  ),
);
