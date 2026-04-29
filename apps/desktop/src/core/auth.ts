/**
 * Phase S — Enterprise auth client.
 *
 * Wraps the backend auth.* tRPC routes for the desktop app. Manages the
 * user JWT in syncStore and emits auth:* events the rest of the UI
 * listens for.
 *
 * Personal-mode profiles never invoke this module — they keep using the
 * Phase H pairing flow (auth.devices.pair → device JWT in syncStore).
 */
import { useSyncStore } from '@/store/syncStore';
import { useProfileStore } from '@/store/profileStore';
import { eventBus } from '@/core/events';

// ── Types ────────────────────────────────────────────────────────────────────

export interface LoginResult {
  token: string;
  expiresAt: string | null;
  mustChangePassword: boolean;
  user: {
    id: string;
    email: string;
    display_name: string;
    org_role: 'admin' | 'member';
  };
}

// ── tRPC helpers (no auth required for login) ────────────────────────────────

function trpcUrl(serverUrl: string, route: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/trpc/${route}`;
}

async function postUnauthenticated<T>(
  serverUrl: string,
  route: string,
  input: unknown,
): Promise<T> {
  const res = await fetch(trpcUrl(serverUrl, route), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(15_000),
  });
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

async function postAuthed<T>(
  serverUrl: string,
  route: string,
  token: string,
  input: unknown,
): Promise<T> {
  const res = await fetch(trpcUrl(serverUrl, route), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
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

/**
 * Sign in to an enterprise server. Stores the user token in syncStore and
 * emits 'auth:signed-in' (or 'auth:must-change-password' if the server
 * forces a password change).
 */
export async function login(
  serverUrl: string,
  email: string,
  password: string,
): Promise<LoginResult> {
  if (!serverUrl) throw new Error('Server URL is required.');
  if (!email || !password) throw new Error('Email and password are required.');

  const data = await postUnauthenticated<{
    token: string;
    must_change_password?: boolean;
    user: {
      id: string;
      email: string;
      display_name: string;
      org_role: 'admin' | 'member';
    };
  }>(serverUrl, 'auth.login', { email, password });

  if (!data?.token || !data?.user?.id) {
    throw new Error('Malformed login response.');
  }

  const result: LoginResult = {
    token: data.token,
    expiresAt: null,
    mustChangePassword: !!data.must_change_password,
    user: data.user,
  };

  useSyncStore.getState().setUserSession({
    serverUrl: serverUrl.replace(/\/+$/, ''),
    token: result.token,
    expiresAt: result.expiresAt,
    userId: result.user.id,
    email: result.user.email,
    displayName: result.user.display_name,
    orgRole: result.user.org_role,
    mustChangePassword: result.mustChangePassword,
    profileStoreId: useProfileStore.getState().activeProfileId ?? undefined,
  });

  if (result.mustChangePassword) {
    eventBus.emit('auth:must-change-password', { userId: result.user.id });
  } else {
    eventBus.emit('auth:signed-in', {
      userId: result.user.id,
      orgRole: result.user.org_role,
    });
  }

  return result;
}

/**
 * Submit a new password. On success the server returns a fresh full-scope
 * token. Used both for the forced first-login flow and voluntary changes
 * from the Account settings.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const { syncUrl, userToken } = useSyncStore.getState();
  if (!syncUrl) throw new Error('Server URL not configured.');
  if (!userToken) throw new Error('Not signed in.');
  if (newPassword.length < 8) {
    throw new Error('New password must be at least 8 characters.');
  }

  const data = await postAuthed<{
    token: string;
  }>(syncUrl, 'auth.changePassword', userToken, {
    currentPassword,
    newPassword,
  });

  if (!data?.token) throw new Error('Malformed change-password response.');

  // Refresh the stored token + clear must-change-password flag.
  const s = useSyncStore.getState();
  useSyncStore.getState().setUserSession({
    serverUrl: s.syncUrl,
    token: data.token,
    expiresAt: null,
    userId: s.userId,
    email: s.userEmail,
    displayName: s.userDisplayName,
    orgRole: (s.orgRole || 'member') as 'admin' | 'member',
    mustChangePassword: false,
    profileStoreId: useProfileStore.getState().activeProfileId ?? undefined,
  });
  eventBus.emit('auth:signed-in', {
    userId: s.userId,
    orgRole: (s.orgRole || 'member') as 'admin' | 'member',
  });
}

/** Local sign-out — clears the user session in syncStore. */
export function logout(): void {
  const profileStoreId = useProfileStore.getState().activeProfileId ?? undefined;
  useSyncStore.getState().clearUserSession(profileStoreId);
  eventBus.emit('auth:signed-out', undefined);
}

/**
 * Return the bearer token to use for sync of the active profile, or empty
 * string if the profile is unauthenticated. Enterprise profiles return
 * the user token; personal profiles return the device token.
 */
export function getActiveBearerToken(): string {
  const profileStore = useProfileStore.getState();
  const profile = profileStore.profiles.find(
    (p) => p.id === profileStore.activeProfileId,
  );
  const sync = useSyncStore.getState();
  if (profile?.mode === 'enterprise') return sync.userToken;
  return sync.deviceToken;
}

/** True when the active profile is enterprise mode. */
export function isEnterpriseMode(): boolean {
  const profileStore = useProfileStore.getState();
  const profile = profileStore.profiles.find(
    (p) => p.id === profileStore.activeProfileId,
  );
  return profile?.mode === 'enterprise';
}

// ── Token expiry watcher ─────────────────────────────────────────────────────

let expiryTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start a periodic check that compares tokenExpiresAt against now and
 * emits 'auth:expired' when crossed. Idempotent.
 */
export function startTokenExpiryWatcher(): void {
  if (expiryTimer) return;
  const tick = (): void => {
    const { tokenExpiresAt, userToken } = useSyncStore.getState();
    if (!userToken || !tokenExpiresAt) return;
    const exp = Date.parse(tokenExpiresAt);
    if (Number.isNaN(exp)) return;
    if (Date.now() >= exp) {
      eventBus.emit('auth:expired', { reason: 'expired' });
    }
  };
  expiryTimer = setInterval(tick, 60_000);
}

export function stopTokenExpiryWatcher(): void {
  if (expiryTimer) {
    clearInterval(expiryTimer);
    expiryTimer = null;
  }
}

// ── Per-profile offline auth crypto ─────────────────────────────────────────
// Same PBKDF2-SHA256 / 250k iterations as the app-lock in core/lock.ts.

const PBKDF2_ITER = 250_000;
const HASH_BYTES = 32;
const SALT_BYTES = 16;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('invalid hex string');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt.buffer.slice(
        salt.byteOffset,
        salt.byteOffset + salt.byteLength,
      ) as ArrayBuffer,
      iterations: PBKDF2_ITER,
      hash: 'SHA-256',
    },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function constTimeEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i += 1) r |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return r === 0;
}

/**
 * Hash a password for local storage. Returns hex-encoded hash + salt.
 * Used for both per-profile local passwords and cached enterprise passwords.
 */
export async function hashForStorage(
  password: string,
): Promise<{ hash_hex: string; salt_hex: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(password, salt);
  return { hash_hex: bytesToHex(hash), salt_hex: bytesToHex(salt) };
}

/**
 * Verify a password against a stored hash + salt.
 */
export async function verifyForStorage(
  password: string,
  hash_hex: string,
  salt_hex: string,
): Promise<boolean> {
  try {
    const salt = hexToBytes(salt_hex);
    const expected = hexToBytes(hash_hex);
    const actual = await pbkdf2(password, salt);
    return constTimeEq(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Login to an enterprise server AND cache the password hash locally for
 * offline authentication on the next boot.
 */
export async function loginAndCacheHash(
  serverUrl: string,
  email: string,
  password: string,
  profileId: string,
): Promise<LoginResult> {
  // Authenticate with the server first.
  const result = await login(serverUrl, email, password);

  // Cache the password hash for offline auth.
  const { hash_hex, salt_hex } = await hashForStorage(password);
  const { setProfileEnterprisePwHash } = useProfileStore.getState();
  setProfileEnterprisePwHash(profileId, hash_hex, salt_hex);

  return result;
}
