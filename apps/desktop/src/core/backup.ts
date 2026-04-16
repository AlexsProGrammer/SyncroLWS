import { path } from '@tauri-apps/api';
import { copyFile, mkdir } from '@tauri-apps/plugin-fs';
import { getCurrentProfileId, getCurrentWorkspaceId } from './db';

const BACKUP_INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes

/**
 * Starts a periodic SQLite backup scheduler.
 * Copies the active profile + workspace DB files to a timestamped backup folder.
 *
 * Returns a cleanup function to cancel the interval.
 */
export function startBackupScheduler(): () => void {
  const run = async (): Promise<void> => {
    const profileId = getCurrentProfileId();
    if (!profileId) return; // no profile loaded yet

    try {
      const appDataDir = await path.appDataDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = await path.join(appDataDir, 'backups', profileId, timestamp);

      await mkdir(backupDir, { recursive: true });

      // Back up profile DB
      const profileDbSrc = await path.join(appDataDir, 'profiles', profileId, 'data.sqlite');
      const profileDbDest = await path.join(backupDir, 'profile.sqlite');
      await copyFile(profileDbSrc, profileDbDest);

      // Back up active workspace DB if one is loaded
      const workspaceId = getCurrentWorkspaceId();
      if (workspaceId) {
        const wsDbSrc = await path.join(
          appDataDir, 'profiles', profileId, 'workspaces', workspaceId, 'data.sqlite',
        );
        const wsDbDest = await path.join(backupDir, `workspace_${workspaceId}.sqlite`);
        try {
          await copyFile(wsDbSrc, wsDbDest);
        } catch {
          // Workspace DB may not exist yet — skip silently
        }
      }

      console.log(`[backup] Snapshot saved → ${backupDir}`);
    } catch (err) {
      // Backup failure must never crash the app
      console.error('[backup] Failed to create backup:', err);
    }
  };

  // Run immediately on startup, then on interval
  void run();
  const id = setInterval(() => void run(), BACKUP_INTERVAL_MS);

  return () => clearInterval(id);
}
