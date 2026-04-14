/**
 * PowerSync client stub.
 * Real implementation will use @powersync/web or @powersync/react-native
 * once the self-hosted PowerSync service from docker-compose is running.
 *
 * This module exposes a minimal interface so the rest of the app
 * can depend on the contract without a concrete PowerSync SDK at this stage.
 */

export interface SyncStatus {
  connected: boolean;
  last_synced_at: string | null;
  pending_changes: number;
}

class PowerSyncClient {
  private _status: SyncStatus = {
    connected: false,
    last_synced_at: null,
    pending_changes: 0,
  };

  get status(): SyncStatus {
    return { ...this._status };
  }

  async connect(_serverUrl: string): Promise<void> {
    // TODO: implement PowerSync SDK initialisation
    console.warn('[powersync] connect() is a stub — real SDK not yet wired');
  }

  async disconnect(): Promise<void> {
    this._status.connected = false;
  }
}

export const powerSync = new PowerSyncClient();
