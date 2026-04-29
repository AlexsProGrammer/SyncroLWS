import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Per-profile sync configuration snapshot.
 * Each profile stores its own pairing credentials, server URL, and
 * enterprise session independently. New profiles default to all-empty/false.
 */
export interface PerProfileSyncConfig {
  syncUrl: string;
  deviceToken: string;
  deviceId: string;
  deviceName: string;
  profileId: string;
  isSyncActive: boolean;
  encryptAtRest: boolean;
  userToken: string;
  tokenExpiresAt: string | null;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  orgRole: 'admin' | 'member' | '';
  mustChangePassword: boolean;
}

const PER_PROFILE_DEFAULTS: PerProfileSyncConfig = {
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
};

function extractConfig(state: SyncState): PerProfileSyncConfig {
  return {
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
  };
}

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

  /**
   * Per-profile sync configuration map.
   * Keyed by profile UUID. Each profile stores its own credentials
   * independently so switching profiles swaps in the right config.
   */
  profileConfigs: Record<string, PerProfileSyncConfig>;
}

interface SyncActions {
  setSyncUrl: (url: string) => void;
  setIsSyncActive: (active: boolean) => void;
  setEncryptAtRest: (enabled: boolean) => void;
  setPairing: (p: { token: string; deviceId: string; deviceName: string; profileId: string }) => void;
  /** Drop the device JWT (e.g. revoked by owner). Keeps URL. */
  clearPairing: () => void;
  /** Phase S — install an enterprise user session after /auth.login.
   *  Pass `profileStoreId` (useProfileStore.activeProfileId) so the session
   *  is saved under the correct profile UUID key in profileConfigs. */
  setUserSession: (s: {
    serverUrl?: string;
    token: string;
    expiresAt: string | null;
    userId: string;
    email: string;
    displayName: string;
    orgRole: 'admin' | 'member';
    mustChangePassword?: boolean;
    /** The zustand profile store's active profile UUID. Required for
     *  enterprise users who have no device pairing (s.profileId = ''). */
    profileStoreId?: string;
  }) => void;
  /** Phase S — clear the enterprise user session (sign out / token expired).
   *  Pass `profileStoreId` so the entry in profileConfigs is cleared too. */
  clearUserSession: (profileStoreId?: string) => void;
  /** Phase S — mark mustChangePassword (cleared after successful change). */
  setMustChangePassword: (v: boolean) => void;
  /** Phase S — toggle read-only mode. */
  setReadonly: (v: boolean) => void;
  /** Reset all sync configuration to defaults. */
  resetSync: () => void;
  /** Update transient sync status fields (called by the sync engine). */
  setStatus: (patch: Partial<Pick<SyncState, 'inFlight' | 'lastPulledAt' | 'lastPushedAt' | 'pendingChanges' | 'lastError' | 'online' | 'windowVisible'>>) => void;
  /**
   * Load the stored config for the given profile into the flat state fields.
   * Call this whenever the active profile changes (profile switch, boot, create).
   * - Saves the current flat config for the current active profile first.
   * - If the new profile has a stored config, restores it.
   * - Otherwise resets flat fields to clean defaults (sync disabled, no token).
   * Migration: if the old single-profile flat data already matches the new
   * profile's ID it is inherited so existing pairings are not lost.
   */
  loadProfileConfig: (profileId: string) => void;
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
  profileConfigs: {},
};

export const useSyncStore = create<SyncState & SyncActions>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,

      // ── Helper: save current flat config back into the per-profile map ───
      // Called internally by every config-writing action.
      // Not exposed in the public SyncActions interface.

      setSyncUrl: (url) =>
        set((s) => {
          const active = s.profileId || '';
          const updated = { ...extractConfig(s), syncUrl: url };
          return {
            syncUrl: url,
            profileConfigs: active
              ? { ...s.profileConfigs, [active]: updated }
              : s.profileConfigs,
          };
        }),

      setIsSyncActive: (active) =>
        set((s) => {
          const profileKey = s.profileId || '';
          const updated = { ...extractConfig(s), isSyncActive: active };
          return {
            isSyncActive: active,
            profileConfigs: profileKey
              ? { ...s.profileConfigs, [profileKey]: updated }
              : s.profileConfigs,
          };
        }),

      setEncryptAtRest: (enabled) =>
        set((s) => {
          const profileKey = s.profileId || '';
          const updated = { ...extractConfig(s), encryptAtRest: enabled };
          return {
            encryptAtRest: enabled,
            profileConfigs: profileKey
              ? { ...s.profileConfigs, [profileKey]: updated }
              : s.profileConfigs,
          };
        }),

      setPairing: ({ token, deviceId, deviceName, profileId }) =>
        set((s) => {
          const updated: PerProfileSyncConfig = {
            ...extractConfig(s),
            deviceToken: token,
            deviceId,
            deviceName,
            profileId,
            isSyncActive: true,
          };
          return {
            deviceToken: token,
            deviceId,
            deviceName,
            profileId,
            isSyncActive: true,
            profileConfigs: { ...s.profileConfigs, [profileId]: updated },
          };
        }),

      clearPairing: () =>
        set((s) => {
          const profileKey = s.profileId || '';
          const cleared: PerProfileSyncConfig = {
            ...extractConfig(s),
            deviceToken: '',
            deviceId: '',
            deviceName: '',
            profileId: '',
            isSyncActive: false,
          };
          return {
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
            profileConfigs: profileKey
              ? { ...s.profileConfigs, [profileKey]: cleared }
              : s.profileConfigs,
          };
        }),

      setUserSession: ({ serverUrl, token, expiresAt, userId, email, displayName, orgRole, mustChangePassword, profileStoreId }) =>
        set((s) => {
          // Use the caller-supplied profile store UUID first; fall back to the
          // device-pairing profile ID. Enterprise users without pairing have
          // s.profileId = '' so profileStoreId is essential.
          const profileKey = profileStoreId || s.profileId || '';
          const patch = {
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
          };
          const updated: PerProfileSyncConfig = {
            ...extractConfig(s),
            ...patch,
          };
          return {
            ...patch,
            profileConfigs: profileKey
              ? { ...s.profileConfigs, [profileKey]: updated }
              : s.profileConfigs,
          };
        }),

      clearUserSession: (profileStoreId?: string) =>
        set((s) => {
          const profileKey = profileStoreId || s.profileId || '';
          const cleared: PerProfileSyncConfig = {
            ...extractConfig(s),
            userToken: '',
            tokenExpiresAt: null,
            userId: '',
            userEmail: '',
            userDisplayName: '',
            orgRole: '',
            mustChangePassword: false,
            isSyncActive: false,
          };
          return {
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
            profileConfigs: profileKey
              ? { ...s.profileConfigs, [profileKey]: cleared }
              : s.profileConfigs,
          };
        }),

      setMustChangePassword: (v) =>
        set((s) => {
          const profileKey = s.profileId || '';
          const updated = { ...extractConfig(s), mustChangePassword: v };
          return {
            mustChangePassword: v,
            profileConfigs: profileKey
              ? { ...s.profileConfigs, [profileKey]: updated }
              : s.profileConfigs,
          };
        }),

      setReadonly: (v) => set({ readonly: v }),
      resetSync: () => set(INITIAL_STATE),
      setStatus: (patch) => set(patch),

      loadProfileConfig: (profileId: string) =>
        set((s) => {
          // 1. Save the current flat config under whatever profile it belongs to
          //    (identified by s.profileId — the "bound profile" stored in the token).
          const currentKey = s.profileId || '';
          const saved = currentKey
            ? { ...s.profileConfigs, [currentKey]: extractConfig(s) }
            : s.profileConfigs;

          // 2. Look up the stored config for the new profile.
          const stored = saved[profileId];
          if (stored) {
            // Restore the stored config for this profile.
            return { ...stored, profileConfigs: saved };
          }

          // 3. Migration path: if the old flat state was already bound to this
          //    profile (pre-profileConfigs era), inherit it rather than resetting.
          if (s.profileId === profileId && s.deviceToken) {
            const migrated = extractConfig(s);
            return {
              profileConfigs: { ...saved, [profileId]: migrated },
            };
          }

          // 4. Genuinely new profile — reset to clean defaults.
          //    Runtime-only fields (online, windowVisible, readonly, inFlight, etc.)
          //    are left unchanged so connectivity state isn't disrupted.
          return {
            ...PER_PROFILE_DEFAULTS,
            profileConfigs: saved,
          };
        }),
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
        profileConfigs: state.profileConfigs,
      }),
    },
  ),
);
