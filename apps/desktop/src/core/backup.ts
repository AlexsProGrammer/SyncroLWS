import { path } from '@tauri-apps/api';
import { copyFile, mkdir, readDir, remove } from '@tauri-apps/plugin-fs';
import {
  getCurrentProfileId,
  getCurrentWorkspaceId,
  getProfileSetting,
  setProfileSetting,
} from './db';
import { eventBus } from './events';

// ── Backup config ────────────────────────────────────────────────────────────

export type BackupSchedule =
  | { kind: 'on_open' }
  | { kind: 'every_n_hours'; intervalHours: number }
  | { kind: 'daily_at'; hhmm: string }; // "HH:MM" 24h

export interface BackupConfig {
  enabled: boolean;
  schedule: BackupSchedule;
  /** How many timestamped snapshots to keep per profile. 0 = keep all. */
  retentionCount: number;
}

export const DEFAULT_BACKUP_CONFIG: BackupConfig = {
  enabled: true,
  schedule: { kind: 'every_n_hours', intervalHours: 6 },
  retentionCount: 14,
};

const SETTING_KEY = 'backup.config';
/** Re-evaluate scheduled backups every minute. */
const TICK_MS = 60 * 1000;

export async function getBackupConfig(): Promise<BackupConfig> {
  const raw = await getProfileSetting(SETTING_KEY);
  if (!raw) return DEFAULT_BACKUP_CONFIG;
  try {
    const parsed = JSON.parse(raw) as Partial<BackupConfig>;
    return { ...DEFAULT_BACKUP_CONFIG, ...parsed };
  } catch {
    return DEFAULT_BACKUP_CONFIG;
  }
}

export async function setBackupConfig(config: BackupConfig): Promise<void> {
  await setProfileSetting(SETTING_KEY, JSON.stringify(config));
}

// ── Internals ────────────────────────────────────────────────────────────────

interface RunResult {
  ok: boolean;
  backupDir?: string;
  error?: string;
}

async function appBackupsRoot(profileId: string): Promise<string> {
  const appDataDir = await path.appDataDir();
  return path.join(appDataDir, 'backups', profileId);
}

async function profileDbPath(profileId: string): Promise<string> {
  const appDataDir = await path.appDataDir();
  return path.join(appDataDir, 'profiles', profileId, 'data.sqlite');
}

async function workspaceDbPath(profileId: string, workspaceId: string): Promise<string> {
  const appDataDir = await path.appDataDir();
  return path.join(appDataDir, 'profiles', profileId, 'workspaces', workspaceId, 'data.sqlite');
}

/** Run one backup snapshot and return the destination dir. */
export async function runBackupNow(): Promise<RunResult> {
  const profileId = getCurrentProfileId();
  if (!profileId) return { ok: false, error: 'No active profile.' };

  try {
    const root = await appBackupsRoot(profileId);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = await path.join(root, timestamp);
    await mkdir(backupDir, { recursive: true });

    // Profile DB.
    const profileSrc = await profileDbPath(profileId);
    const profileDest = await path.join(backupDir, 'profile.sqlite');
    await copyFile(profileSrc, profileDest);

    // Active workspace DB if any.
    const workspaceId = getCurrentWorkspaceId();
    if (workspaceId) {
      try {
        const wsSrc = await workspaceDbPath(profileId, workspaceId);
        const wsDest = await path.join(backupDir, `workspace_${workspaceId}.sqlite`);
        await copyFile(wsSrc, wsDest);
      } catch {
        // Workspace DB may not exist yet — non-fatal.
      }
    }

    // Mark last backup time.
    await setProfileSetting('backup.lastRunAt', new Date().toISOString());
    eventBus.emit('notification:show', {
      title: 'Backup complete',
      body: `Snapshot saved (${timestamp.slice(0, 16).replace('T', ' ')}).`,
      type: 'info',
    });

    // Best-effort retention prune.
    const config = await getBackupConfig();
    if (config.retentionCount > 0) {
      void pruneOldBackups(profileId, config.retentionCount).catch(() => undefined);
    }

    console.log(`[backup] Snapshot saved → ${backupDir}`);
    return { ok: true, backupDir };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[backup] Failed to create backup:', err);
    return { ok: false, error: message };
  }
}

async function listBackups(profileId: string): Promise<string[]> {
  try {
    const root = await appBackupsRoot(profileId);
    const entries = await readDir(root);
    return entries
      .filter((e) => e.isDirectory)
      .map((e) => e.name)
      .filter((n): n is string => Boolean(n))
      .sort(); // ISO timestamps sort lexicographically
  } catch {
    return [];
  }
}

async function pruneOldBackups(profileId: string, keep: number): Promise<void> {
  const all = await listBackups(profileId);
  if (all.length <= keep) return;
  const root = await appBackupsRoot(profileId);
  const stale = all.slice(0, all.length - keep);
  for (const name of stale) {
    try {
      const dir = await path.join(root, name);
      await remove(dir, { recursive: true });
    } catch (err) {
      console.warn(`[backup] failed to prune ${name}:`, err);
    }
  }
}

/** Public: list available snapshots (timestamp folder names) for the active profile. */
export async function listAvailableBackups(): Promise<string[]> {
  const profileId = getCurrentProfileId();
  if (!profileId) return [];
  const all = await listBackups(profileId);
  return all.slice().reverse(); // newest first
}

/**
 * Restore from a previously-taken snapshot.
 *
 * Copies `profile.sqlite` and the matching `workspace_<id>.sqlite` (if it
 * matches the currently-active workspace) over the live DB files, then
 * fires `profile:switched` so the app re-loads its data layer.
 *
 * The app should be considered "in maintenance" while this runs; in
 * practice a full window reload after this call is the safest option —
 * the backup module emits `notification:show` to nudge the user.
 */
export async function restoreFromBackup(timestamp: string): Promise<RunResult> {
  const profileId = getCurrentProfileId();
  if (!profileId) return { ok: false, error: 'No active profile.' };
  try {
    const root = await appBackupsRoot(profileId);
    const backupDir = await path.join(root, timestamp);

    // Profile DB.
    const profileBackup = await path.join(backupDir, 'profile.sqlite');
    const profileLive = await profileDbPath(profileId);
    await copyFile(profileBackup, profileLive);

    // Workspace DB (if currently loaded).
    const workspaceId = getCurrentWorkspaceId();
    if (workspaceId) {
      try {
        const wsBackup = await path.join(backupDir, `workspace_${workspaceId}.sqlite`);
        const wsLive = await workspaceDbPath(profileId, workspaceId);
        await copyFile(wsBackup, wsLive);
      } catch {
        // Workspace snapshot missing — leave existing live DB untouched.
      }
    }

    eventBus.emit('notification:show', {
      title: 'Restore complete',
      body: 'Reload the app to see restored data.',
      type: 'warning',
    });
    return { ok: true, backupDir };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[backup] Failed to restore backup:', err);
    return { ok: false, error: message };
  }
}

// ── Scheduler ────────────────────────────────────────────────────────────────

function shouldRun(config: BackupConfig, lastRunIso: string | null, nowMs: number): boolean {
  if (!config.enabled) return false;
  switch (config.schedule.kind) {
    case 'on_open':
      // Already handled by the on-startup invocation; never re-fire on tick.
      return false;
    case 'every_n_hours': {
      const hours = Math.max(0.1, config.schedule.intervalHours);
      if (!lastRunIso) return true;
      const last = Date.parse(lastRunIso);
      if (Number.isNaN(last)) return true;
      return nowMs - last >= hours * 60 * 60 * 1000;
    }
    case 'daily_at': {
      const [hStr, mStr] = config.schedule.hhmm.split(':');
      const targetH = Number(hStr ?? '0');
      const targetM = Number(mStr ?? '0');
      if (Number.isNaN(targetH) || Number.isNaN(targetM)) return false;
      const now = new Date(nowMs);
      // Run if we're inside the 1-minute scheduling window AND haven't already run today.
      if (now.getHours() !== targetH || now.getMinutes() !== targetM) return false;
      if (!lastRunIso) return true;
      const last = new Date(lastRunIso);
      return last.toDateString() !== now.toDateString();
    }
  }
}

/**
 * Starts the periodic backup scheduler.
 *
 * Behaviour:
 *   - Reads the active profile's backup config from `profile_settings` each tick.
 *   - On startup (after first profile load), runs once if `schedule.kind === 'on_open'`.
 *   - Then ticks every minute and re-evaluates the schedule.
 *
 * Returns a cleanup function to cancel the interval.
 */
export function startBackupScheduler(): () => void {
  let firedOnOpenForProfileId: string | null = null;

  const tick = async (): Promise<void> => {
    const profileId = getCurrentProfileId();
    if (!profileId) return;

    let config: BackupConfig;
    try {
      config = await getBackupConfig();
    } catch {
      return;
    }
    if (!config.enabled) return;

    // One-time on-open run per profile load.
    if (config.schedule.kind === 'on_open' && firedOnOpenForProfileId !== profileId) {
      firedOnOpenForProfileId = profileId;
      void runBackupNow();
      return;
    }

    const lastRun = await getProfileSetting('backup.lastRunAt');
    if (shouldRun(config, lastRun, Date.now())) {
      void runBackupNow();
    }
  };

  // Run an initial tick shortly after boot (gives profile time to load).
  const bootTimer = setTimeout(() => void tick(), 5_000);
  const intervalId = setInterval(() => void tick(), TICK_MS);

  return () => {
    clearTimeout(bootTimer);
    clearInterval(intervalId);
  };
}
