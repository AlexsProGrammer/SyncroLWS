import { path } from '@tauri-apps/api';
import { copyFile, mkdir } from '@tauri-apps/plugin-fs';

const BACKUP_INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes

/**
 * Starts a periodic SQLite backup scheduler.
 * Copies the live .db file to the configured backup directory.
 *
 * Returns a cleanup function to cancel the interval.
 */
export function startBackupScheduler(): () => void {
  const run = async (): Promise<void> => {
    try {
      const appDataDir = await path.appDataDir();
      const backupDir = await path.join(appDataDir, 'backups');

      await mkdir(backupDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const dbSrc = await path.join(appDataDir, 'syncrohws.db');
      const dbDest = await path.join(backupDir, `syncrohws_${timestamp}.db`);

      await copyFile(dbSrc, dbDest);
      console.log(`[backup] SQLite snapshot saved → ${dbDest}`);
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
