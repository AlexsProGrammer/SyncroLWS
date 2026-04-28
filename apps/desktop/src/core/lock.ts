/**
 * Phase T — App-lock store + crypto.
 *
 * Stores a PBKDF2-SHA256 password hash + idle timeout in localStorage.
 * On boot, App.tsx checks `useAppLockStore.locked` before rendering the
 * main UI. The lock is global (covers all profiles) and lives in
 * localStorage so the OS user identity is the trust boundary, not the
 * profile.
 *
 * Hash storage:
 *   { enabled, salt_hex, hash_hex, iter, idle_minutes, version }
 * The salt is 16 random bytes; iter is 250_000 (PBKDF2-SHA256, web-crypto).
 */
import { create } from 'zustand';

const STORAGE_KEY = 'syncrolws-app-lock';
const PBKDF2_ITER = 250_000;
const HASH_BYTES = 32;
const SALT_BYTES = 16;
const VERSION = 1;

interface PersistedLock {
  enabled: boolean;
  salt_hex: string;
  hash_hex: string;
  iter: number;
  idle_minutes: number;
  version: number;
}

interface AppLockState {
  /** True when an app password has been set. Even when enabled the screen
   *  may already be unlocked for the current session. */
  enabled: boolean;
  /** True when the lock screen must be shown before the app can be used. */
  locked: boolean;
  idleMinutes: number;
  /** Number of consecutive failed unlock attempts in this session. Used
   *  to scale the backoff window. Reset on successful unlock. */
  failedAttempts: number;
  /** Re-evaluate persisted state from localStorage. */
  reload: () => void;
  /** Enable lock with a fresh password. */
  enable: (password: string, idleMinutes: number) => Promise<void>;
  /** Disable lock entirely (requires the current password). */
  disable: (currentPassword: string) => Promise<void>;
  /** Change the password (requires the current password). */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Verify a password and unlock if correct. */
  unlock: (password: string) => Promise<boolean>;
  /** Lock the app immediately. */
  lockNow: () => void;
  /** Update idle minutes; persists immediately. */
  setIdleMinutes: (min: number) => void;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('invalid hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function deriveHash(
  password: string,
  salt: Uint8Array,
  iter: number,
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  // ``deriveBits`` accepts a Uint8Array directly per the WebCrypto spec.
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      // BufferSource is acceptable; the underlying ArrayBuffer is the salt.
      salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
      iterations: iter,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** Constant-time comparison of two byte arrays of equal length. */
function constTimeEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i += 1) r |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return r === 0;
}

function loadPersisted(): PersistedLock | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as PersistedLock;
    if (typeof obj?.hash_hex !== 'string' || typeof obj?.salt_hex !== 'string') {
      return null;
    }
    return obj;
  } catch {
    return null;
  }
}

function savePersisted(p: PersistedLock | null): void {
  if (p === null) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

// ── store ────────────────────────────────────────────────────────────────────

export const useAppLockStore = create<AppLockState>((set, get) => {
  const initial = loadPersisted();
  return {
    enabled: !!initial?.enabled,
    locked: !!initial?.enabled, // start locked when a password exists
    idleMinutes: initial?.idle_minutes ?? 15,
    failedAttempts: 0,

    reload: () => {
      const p = loadPersisted();
      set({
        enabled: !!p?.enabled,
        locked: !!p?.enabled && get().locked,
        idleMinutes: p?.idle_minutes ?? 15,
      });
    },

    enable: async (password: string, idleMinutes: number) => {
      if (password.length < 6) {
        throw new Error('App password must be at least 6 characters.');
      }
      const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
      const hash = await deriveHash(password, salt, PBKDF2_ITER);
      const persisted: PersistedLock = {
        enabled: true,
        salt_hex: bytesToHex(salt),
        hash_hex: bytesToHex(hash),
        iter: PBKDF2_ITER,
        idle_minutes: idleMinutes,
        version: VERSION,
      };
      savePersisted(persisted);
      set({ enabled: true, locked: false, idleMinutes, failedAttempts: 0 });
    },

    disable: async (currentPassword: string) => {
      const p = loadPersisted();
      if (!p?.enabled) return;
      const computed = await deriveHash(
        currentPassword,
        hexToBytes(p.salt_hex),
        p.iter,
      );
      if (!constTimeEq(computed, hexToBytes(p.hash_hex))) {
        throw new Error('Incorrect password.');
      }
      savePersisted(null);
      set({ enabled: false, locked: false, failedAttempts: 0 });
    },

    changePassword: async (currentPassword: string, newPassword: string) => {
      const p = loadPersisted();
      if (!p?.enabled) throw new Error('App lock is not enabled.');
      const computed = await deriveHash(
        currentPassword,
        hexToBytes(p.salt_hex),
        p.iter,
      );
      if (!constTimeEq(computed, hexToBytes(p.hash_hex))) {
        throw new Error('Incorrect current password.');
      }
      if (newPassword.length < 6) {
        throw new Error('New password must be at least 6 characters.');
      }
      const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
      const hash = await deriveHash(newPassword, salt, PBKDF2_ITER);
      savePersisted({
        ...p,
        salt_hex: bytesToHex(salt),
        hash_hex: bytesToHex(hash),
        iter: PBKDF2_ITER,
        version: VERSION,
      });
      set({ failedAttempts: 0 });
    },

    unlock: async (password: string) => {
      const p = loadPersisted();
      if (!p?.enabled) {
        set({ locked: false });
        return true;
      }
      const computed = await deriveHash(
        password,
        hexToBytes(p.salt_hex),
        p.iter,
      );
      const ok = constTimeEq(computed, hexToBytes(p.hash_hex));
      if (ok) {
        set({ locked: false, failedAttempts: 0 });
      } else {
        set((s) => ({ failedAttempts: s.failedAttempts + 1 }));
      }
      return ok;
    },

    lockNow: () => {
      if (get().enabled) set({ locked: true });
    },

    setIdleMinutes: (min: number) => {
      const p = loadPersisted();
      if (p?.enabled) {
        savePersisted({ ...p, idle_minutes: min });
      }
      set({ idleMinutes: min });
    },
  };
});

// ── idle watcher ─────────────────────────────────────────────────────────────
//
// Bumps a "last activity" timestamp on user input and locks the app once
// idleMinutes have passed without input. Wired up once at boot.

let idleTimer: ReturnType<typeof setInterval> | null = null;
let lastActivity = Date.now();

function bumpActivity(): void {
  lastActivity = Date.now();
}

/** Wire up idle detection. Idempotent. Call once at app boot. */
export function startIdleWatcher(): void {
  if (idleTimer) return;

  // Bump on user input.
  ['mousemove', 'keydown', 'pointerdown', 'wheel', 'touchstart'].forEach((evt) => {
    window.addEventListener(evt, bumpActivity, { passive: true });
  });

  // Tick every 30s — the resolution doesn't need to be tighter than that.
  idleTimer = setInterval(() => {
    const s = useAppLockStore.getState();
    if (!s.enabled || s.locked) return;
    const idleMs = s.idleMinutes * 60 * 1000;
    if (idleMs <= 0) return; // 0 = never
    if (Date.now() - lastActivity >= idleMs) {
      s.lockNow();
    }
  }, 30_000);
}

/** Returns the suggested unlock cooldown (ms) given the current attempt count.
 *  Backoff: 0,0,0,1s,2s,5s,10s,30s,60s,60s,... */
export function unlockBackoffMs(failedAttempts: number): number {
  if (failedAttempts < 3) return 0;
  if (failedAttempts === 3) return 1_000;
  if (failedAttempts === 4) return 2_000;
  if (failedAttempts === 5) return 5_000;
  if (failedAttempts === 6) return 10_000;
  if (failedAttempts === 7) return 30_000;
  return 60_000;
}
