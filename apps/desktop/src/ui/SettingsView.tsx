import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Switch } from '@/ui/components/switch';
import { Input } from '@/ui/components/input';
import { Button } from '@/ui/components/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/ui/components/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/select';
import { Separator } from '@/ui/components/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/dialog';
import { getAllTools } from '@/registry/ToolRegistry';
import { getDB } from '@/core/db';
import { eventBus } from '@/core/events';
import { useProfileStore, type Profile } from '@/store/profileStore';
import { useSyncStore } from '@/store/syncStore';
import { useThemeStore } from '@/store/themeStore';
import { syncEngine } from '@/core/sync';
import {
  type BackupConfig,
  DEFAULT_BACKUP_CONFIG,
  getBackupConfig,
  setBackupConfig,
  runBackupNow,
  listAvailableBackups,
  restoreFromBackup,
} from '@/core/backup';
import { exportWorkspace, importWorkspace, downloadJsonBundle, pickJsonBundle, type ImportPolicy } from '@/core/workspaceIO';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { getAISettings, saveAISettings, ai } from '@/core/ai';
import { logout as authLogout } from '@/core/auth';
import { useAppLockStore } from '@/core/lock';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ToolToggleState {
  tool_id: string;
  is_enabled: boolean;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconSettings({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export { IconSettings };

// ── Component ─────────────────────────────────────────────────────────────────

export function SettingsView(): React.ReactElement {
  const [toolStates, setToolStates] = useState<ToolToggleState[]>([]);
  const [activeTab, setActiveTab] = useState('general');
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const profiles = useProfileStore((s) => s.profiles);
  const createProfile = useProfileStore((s) => s.createProfile);
  const updateProfile = useProfileStore((s) => s.updateProfile);
  const deleteProfile = useProfileStore((s) => s.deleteProfile);
  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const tools = getAllTools();
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  // ── Profile edit modal ─────────────────────────────────────────────────────
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [profileName, setProfileName] = useState('');
  const [profileColor, setProfileColor] = useState('#6366f1');
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);

  const openEditProfile = (profile: Profile): void => {
    setEditingProfile(profile);
    setProfileName(profile.name);
    setProfileColor(profile.color ?? '#6366f1');
    setIsCreatingProfile(false);
  };

  const openCreateProfile = (): void => {
    setEditingProfile(null);
    setProfileName('');
    setProfileColor('#6366f1');
    setIsCreatingProfile(true);
  };

  const handleSaveProfile = async (): Promise<void> => {
    if (!profileName.trim()) return;
    if (isCreatingProfile) {
      await createProfile(profileName.trim(), profileColor);
    } else if (editingProfile) {
      updateProfile(editingProfile.id, { name: profileName.trim(), color: profileColor });
    }
    setEditingProfile(null);
    setIsCreatingProfile(false);
  };

  // ── Listen for tab switch events from sidebar ProfileSwitcher ──────────────
  useEffect(() => {
    const handler = (tab: string): void => setActiveTab(tab);
    eventBus.on('settings:open-tab', handler);
    return () => { eventBus.off('settings:open-tab', handler); };
  }, []);

  // ── Sync store ─────────────────────────────────────────────────────────────
  const syncUrl = useSyncStore((s) => s.syncUrl);
  const deviceToken = useSyncStore((s) => s.deviceToken);
  const deviceName = useSyncStore((s) => s.deviceName);
  const deviceId = useSyncStore((s) => s.deviceId);
  const pairedProfileId = useSyncStore((s) => s.profileId);
  const isSyncActive = useSyncStore((s) => s.isSyncActive);
  const setSyncUrl = useSyncStore((s) => s.setSyncUrl);
  const setIsSyncActive = useSyncStore((s) => s.setIsSyncActive);
  const encryptAtRest = useSyncStore((s) => s.encryptAtRest);
  const setEncryptAtRest = useSyncStore((s) => s.setEncryptAtRest);
  const setPairing = useSyncStore((s) => s.setPairing);
  const clearPairing = useSyncStore((s) => s.clearPairing);

  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');

  // ── Pairing dialog state ───────────────────────────────────────────────────
  const [isPairing, setIsPairing] = useState(false);
  const [pairEmail, setPairEmail] = useState('');
  const [pairPassword, setPairPassword] = useState('');
  const [pairDeviceName, setPairDeviceName] = useState('');
  const [pairStatus, setPairStatus] = useState<'idle' | 'working' | 'error'>('idle');
  const [pairError, setPairError] = useState('');

  // ── Load tool toggle states from DB ────────────────────────────────────────
  const loadToolStates = useCallback(async () => {
    if (!activeProfileId) return;
    try {
      const db = getDB();
      const rows = await db.select<{ tool_id: string; is_enabled: number }[]>(
        `SELECT tool_id, is_enabled FROM active_tools WHERE profile_id = ?`,
        [activeProfileId],
      );

      // Build state: start with all tools enabled, then apply DB overrides
      const stateMap = new Map<string, boolean>();
      for (const tool of tools) {
        stateMap.set(tool.id, true); // default: enabled
      }
      for (const row of rows) {
        stateMap.set(row.tool_id, Boolean(row.is_enabled));
      }

      setToolStates(
        [...stateMap.entries()].map(([tool_id, is_enabled]) => ({ tool_id, is_enabled })),
      );
    } catch (err) {
      console.error('[settings] failed to load tool states:', err);
      // Fallback: all enabled
      setToolStates(tools.map((t) => ({ tool_id: t.id, is_enabled: true })));
    }
  }, [activeProfileId, tools]);

  useEffect(() => {
    void loadToolStates();
  }, [loadToolStates]);

  // ── Toggle a tool ──────────────────────────────────────────────────────────
  const toggleTool = useCallback(
    async (toolId: string, enabled: boolean) => {
      if (!activeProfileId) return;

      // Optimistic UI update
      setToolStates((prev) =>
        prev.map((s) => (s.tool_id === toolId ? { ...s, is_enabled: enabled } : s)),
      );

      try {
        const db = getDB();
        // Upsert: delete + insert (SQLite doesn't have native ON CONFLICT for composite non-PK)
        await db.execute(
          `DELETE FROM active_tools WHERE profile_id = ? AND tool_id = ?`,
          [activeProfileId, toolId],
        );
        await db.execute(
          `INSERT INTO active_tools (profile_id, tool_id, is_enabled) VALUES (?, ?, ?)`,
          [activeProfileId, toolId, enabled ? 1 : 0],
        );
        // Notify sidebar to re-render
        eventBus.emit('settings:tools-changed', undefined);
      } catch (err) {
        console.error('[settings] failed to toggle tool:', err);
        // Revert on failure
        void loadToolStates();
      }
    },
    [activeProfileId, loadToolStates],
  );

  // ── Test backend connection ────────────────────────────────────────────────
  const testConnection = useCallback(async () => {
    if (!syncUrl) {
      setConnectionStatus('error');
      setConnectionMessage('Please enter a sync URL first.');
      return;
    }

    setConnectionStatus('testing');
    setConnectionMessage('');

    try {
      // Normalise URL — strip trailing slash, hit the tRPC health check
      const base = syncUrl.replace(/\/+$/, '');
      const res = await fetch(`${base}/trpc/health`, {
        method: 'GET',
        headers: deviceToken ? { Authorization: `Bearer ${deviceToken}` } : {},
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        throw new Error(`Server responded with ${res.status}`);
      }

      const data = await res.json();
      if (data?.result?.data?.status === 'ok') {
        setConnectionStatus('success');
        setConnectionMessage('Connection successful!');
      } else {
        throw new Error('Unexpected response format');
      }
    } catch (err) {
      setConnectionStatus('error');
      setConnectionMessage(
        err instanceof Error ? err.message : 'Connection failed',
      );
    }
  }, [syncUrl, deviceToken]);

  // ── Pairing flow ─────────────────────────────────────────────────────────
  const startPairing = useCallback(() => {
    setPairEmail('');
    setPairPassword('');
    setPairDeviceName(deviceName || `Device ${navigator.platform || ''}`.trim());
    setPairStatus('idle');
    setPairError('');
    setIsPairing(true);
  }, [deviceName]);

  const submitPairing = useCallback(async () => {
    if (!syncUrl || !pairEmail || !pairPassword || !pairDeviceName.trim() || !activeProfileId) {
      setPairStatus('error');
      setPairError('All fields are required.');
      return;
    }
    setPairStatus('working');
    setPairError('');
    try {
      const base = syncUrl.replace(/\/+$/, '');
      // 1) ownerLogin → owner JWT (kept in memory only)
      const loginRes = await fetch(`${base}/trpc/auth.ownerLogin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pairEmail, password: pairPassword }),
        signal: AbortSignal.timeout(15000),
      });
      if (!loginRes.ok) throw new Error(`Login failed (${loginRes.status})`);
      const loginJson = await loginRes.json();
      const ownerToken: string | undefined = loginJson?.result?.data?.token;
      if (!ownerToken) throw new Error('No token returned from login.');

      // 2) auth.devices.pair → device JWT
      const pairRes = await fetch(`${base}/trpc/auth.devices.pair`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({ deviceName: pairDeviceName.trim(), profileId: activeProfileId }),
        signal: AbortSignal.timeout(15000),
      });
      if (!pairRes.ok) throw new Error(`Pairing failed (${pairRes.status})`);
      const pairJson = await pairRes.json();
      const data = pairJson?.result?.data;
      const token: string | undefined = data?.token;
      const device = data?.device;
      if (!token || !device?.id) throw new Error('Malformed pairing response.');

      setPairing({
        token,
        deviceId: device.id,
        deviceName: device.name,
        profileId: device.profile_id,
      });
      setPairStatus('idle');
      setIsPairing(false);
      // owner password: never persisted
      setPairPassword('');
    } catch (err) {
      setPairStatus('error');
      setPairError(err instanceof Error ? err.message : 'Pairing failed.');
    }
  }, [syncUrl, pairEmail, pairPassword, pairDeviceName, activeProfileId, setPairing]);

  const unpair = useCallback(() => {
    clearPairing();
  }, [clearPairing]);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* ── Profile info ──────────────────────────────────────────────── */}
      <div className="border-b border-border px-6 pt-6 pb-4">
        <h2 className="text-lg font-semibold text-foreground">Profile</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {activeProfile ? activeProfile.name : 'No active profile'}{' '}
          {activeProfileId && (
            <span className="font-mono text-xs text-muted-foreground/60">
              ({activeProfileId.slice(0, 8)})
            </span>
          )}
        </p>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-border px-6">
          <TabsList className="h-10 bg-transparent p-0">
            <TabsTrigger value="general" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              General
            </TabsTrigger>
            <TabsTrigger value="profiles" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              Profiles
            </TabsTrigger>
            <TabsTrigger value="tools" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              Tools
            </TabsTrigger>
            <TabsTrigger value="backup" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              Backup
            </TabsTrigger>
            <TabsTrigger value="sync" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              Sync
            </TabsTrigger>
            <TabsTrigger value="sharing" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              Sharing
            </TabsTrigger>
            <TabsTrigger value="account" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              Account
            </TabsTrigger>
            <TabsTrigger value="security" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              Security
            </TabsTrigger>
            <TabsTrigger value="ai" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              AI
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* ── General tab ─────────────────────────────────────────── */}
          <TabsContent value="general">
            <section className="max-w-lg space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Appearance</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Customize the look and feel of the application.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Theme</label>
                <Select value={theme} onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'system')}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Select theme" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                    <SelectItem value="system">System</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Select your preferred color scheme.
                </p>
              </div>

              <Separator />

              <div>
                <h2 className="text-lg font-semibold text-foreground">About</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  SyncroLWS v0.1.0 — Local-first workspace manager.
                </p>
              </div>
            </section>
          </TabsContent>

          {/* ── Profiles tab ────────────────────────────────────────── */}
          <TabsContent value="profiles">
          <section className="max-w-lg space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Profiles</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Manage your profiles. Each profile has its own set of tools,
                  workspaces, and data.
                </p>
              </div>
              <Button onClick={openCreateProfile} size="sm">
                Add Profile
              </Button>
            </div>

            <div className="space-y-3">
              {profiles.map((profile) => (
                <div
                  key={profile.id}
                  className="flex items-center justify-between rounded-lg border border-border p-3"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                      style={{ backgroundColor: profile.color ?? '#6366f1' }}
                    >
                      {profile.name[0]?.toUpperCase()}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-foreground">{profile.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {profile.id.slice(0, 8)}…
                        {profile.id === activeProfileId && (
                          <span className="ml-1 text-primary font-sans">(active)</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditProfile(profile)}
                    >
                      Edit
                    </Button>
                    {profiles.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteProfile(profile.id)}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Profile edit/create modal */}
          <Dialog
            open={isCreatingProfile || editingProfile !== null}
            onOpenChange={(v) => {
              if (!v) { setEditingProfile(null); setIsCreatingProfile(false); }
            }}
          >
            <DialogContent className="max-w-xs">
              <DialogHeader>
                <DialogTitle>{isCreatingProfile ? 'New Profile' : 'Edit Profile'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 mt-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Name</label>
                  <Input
                    placeholder="Profile name"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && void handleSaveProfile()}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-foreground">Color</label>
                  <input
                    type="color"
                    value={profileColor}
                    onChange={(e) => setProfileColor(e.target.value)}
                    className="h-7 w-7 cursor-pointer rounded border border-border"
                  />
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: profileColor }}
                  >
                    {profileName?.[0]?.toUpperCase() ?? 'P'}
                  </span>
                </div>
                <Button
                  onClick={() => void handleSaveProfile()}
                  className="w-full"
                  disabled={!profileName.trim()}
                >
                  {isCreatingProfile ? 'Create' : 'Save'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          </TabsContent>

          {/* ── Tools tab ───────────────────────────────────────────── */}
          <TabsContent value="tools">
          <section>
            <h2 className="text-lg font-semibold text-foreground">Tools</h2>
            <p className="mt-1 mb-4 text-sm text-muted-foreground">
              Enable or disable tools for this profile. Disabled tools are hidden
              from the sidebar and their routes become inaccessible.
            </p>

            <div className="space-y-3">
              {tools.map((tool) => {
                const state = toolStates.find((s) => s.tool_id === tool.id);
                const isEnabled = state?.is_enabled ?? true;
                const Icon = tool.icon;

                return (
                  <div
                    key={tool.id}
                    className="flex items-center justify-between rounded-lg border border-border p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{tool.name}</p>
                        {tool.shortcut && (
                          <p className="text-xs text-muted-foreground">Ctrl+{tool.shortcut}</p>
                        )}
                      </div>
                    </div>
                    <Switch
                      checked={isEnabled}
                      onCheckedChange={(checked) => toggleTool(tool.id, checked)}
                    />
                  </div>
                );
              })}
            </div>
          </section>
          </TabsContent>

          {/* ── Backup tab ──────────────────────────────────────────── */}
          <TabsContent value="backup">
            <BackupSettingsPanel />
          </TabsContent>

          {/* ── Sync tab ────────────────────────────────────────────── */}
          <TabsContent value="sync">
          <section className="max-w-lg space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Sync Configuration</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Connect to a SyncroLWS backend to enable cloud synchronisation.
                All data stays local until you explicitly enable sync.
              </p>
            </div>

            {/* Enable / disable sync */}
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Enable Sync</p>
                <p className="text-xs text-muted-foreground">
                  When disabled, all data is stored locally only.
                </p>
              </div>
              <Switch
                checked={isSyncActive}
                onCheckedChange={setIsSyncActive}
                disabled={!deviceToken}
              />
            </div>

            {/* Server URL */}
            <div className="space-y-1.5">
              <label htmlFor="sync-url" className="text-sm font-medium text-foreground">
                Server URL
              </label>
              <Input
                id="sync-url"
                type="url"
                placeholder="http://localhost:3000"
                value={syncUrl}
                onChange={(e) => setSyncUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The base URL of your SyncroLWS backend instance.
              </p>
            </div>

            {/* Pairing */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Device Pairing</label>
              {deviceToken ? (
                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">Paired</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{deviceName || deviceId.slice(0, 8)}</span>
                      {pairedProfileId && pairedProfileId !== activeProfileId && (
                        <span className="ml-2 text-amber-500">
                          (bound to a different profile)
                        </span>
                      )}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={unpair}>
                    Unpair this device
                  </Button>
                </div>
              ) : (
                <div className="rounded-lg border border-border p-3 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Pair this device by signing in with the owner credentials. The
                    owner password is never stored — only a long-lived device token.
                  </p>
                  <Button size="sm" onClick={startPairing} disabled={!syncUrl || !activeProfileId}>
                    Pair this device
                  </Button>
                </div>
              )}
            </div>

            {/* Test Connection */}
            <div className="flex items-center gap-3">
              <Button
                onClick={testConnection}
                disabled={connectionStatus === 'testing' || !syncUrl}
                variant={connectionStatus === 'success' ? 'outline' : 'default'}
              >
                {connectionStatus === 'testing' ? 'Testing…' : 'Test Connection'}
              </Button>

              {connectionStatus === 'success' && (
                <span className="text-sm font-medium text-green-500">
                  {connectionMessage}
                </span>
              )}
              {connectionStatus === 'error' && (
                <span className="text-sm font-medium text-red-500">
                  {connectionMessage}
                </span>
              )}
            </div>

            {/* Phase I: live sync status + manual trigger */}
            <SyncStatusPanel />

            {/* Phase J: at-rest encryption (spec only — engine no-op for now) */}
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Encrypt sync payloads at rest</p>
                <p className="text-xs text-muted-foreground">
                  Reserved. When enabled, future sync rounds will AES-GCM-encrypt
                  payload bodies with a passphrase-derived key before upload.
                  No-op until the encryption pipeline ships.
                </p>
              </div>
              <Switch
                checked={encryptAtRest}
                onCheckedChange={setEncryptAtRest}
              />
            </div>

            {/* Pairing dialog */}
            <Dialog open={isPairing} onOpenChange={(v) => { if (!v) setIsPairing(false); }}>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>Pair this device</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 mt-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">Owner email</label>
                    <Input
                      type="email"
                      autoComplete="email"
                      value={pairEmail}
                      onChange={(e) => setPairEmail(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">Owner password</label>
                    <Input
                      type="password"
                      autoComplete="current-password"
                      value={pairPassword}
                      onChange={(e) => setPairPassword(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Used once to mint a device token. Not stored.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">Device name</label>
                    <Input
                      value={pairDeviceName}
                      onChange={(e) => setPairDeviceName(e.target.value)}
                      placeholder="My Laptop"
                    />
                  </div>
                  {pairStatus === 'error' && (
                    <p className="text-sm font-medium text-red-500">{pairError}</p>
                  )}
                  <Button
                    onClick={() => void submitPairing()}
                    disabled={pairStatus === 'working'}
                    className="w-full"
                  >
                    {pairStatus === 'working' ? 'Pairing…' : 'Pair'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </section>
          </TabsContent>

          <TabsContent value="sharing">
            <ShareLinksPanel />
          </TabsContent>

          <TabsContent value="account">
            <AccountPanel />
          </TabsContent>

          <TabsContent value="security">
            <SecurityPanel />
          </TabsContent>

          <TabsContent value="ai">
            <AISettingsPanel />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

// ── Phase I: sync status panel ────────────────────────────────────────────────

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'never';
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86_400) return `${Math.round(sec / 3600)}h ago`;
  return new Date(iso).toLocaleString();
}

function SyncStatusPanel(): React.ReactElement | null {
  const isSyncActive = useSyncStore((s) => s.isSyncActive);
  const deviceToken = useSyncStore((s) => s.deviceToken);
  const inFlight = useSyncStore((s) => s.inFlight);
  const lastPulledAt = useSyncStore((s) => s.lastPulledAt);
  const lastPushedAt = useSyncStore((s) => s.lastPushedAt);
  const pendingChanges = useSyncStore((s) => s.pendingChanges);
  const lastError = useSyncStore((s) => s.lastError);
  const online = useSyncStore((s) => s.online);
  const [, force] = useState(0);

  // Refresh "Xs ago" labels each second.
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Initial pending count refresh on mount.
  useEffect(() => {
    void syncEngine.refreshPending();
  }, []);

  if (!deviceToken) return null;

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">Sync status</p>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              online
                ? 'bg-green-500/10 text-green-600'
                : 'bg-amber-500/10 text-amber-600'
            }`}
            title={online ? 'Connected' : 'Offline — sync paused'}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                online ? 'bg-green-500' : 'bg-amber-500'
              }`}
            />
            {online ? 'Online' : 'Offline'}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void syncEngine.syncNow()}
            disabled={!isSyncActive || inFlight || !online}
          >
            {inFlight ? 'Syncing…' : 'Sync now'}
          </Button>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <dt>Last pull</dt>
        <dd className="font-mono text-foreground">{formatRelative(lastPulledAt)}</dd>
        <dt>Last push</dt>
        <dd className="font-mono text-foreground">{formatRelative(lastPushedAt)}</dd>
        <dt>Pending changes</dt>
        <dd className="font-mono text-foreground">{pendingChanges}</dd>
      </dl>
      {lastError && (
        <p className="text-xs font-medium text-red-500 break-all">
          Error: {lastError}
        </p>
      )}
    </div>
  );
}

// ── BackupSettingsPanel ───────────────────────────────────────────────────────

function BackupSettingsPanel(): React.ReactElement {
  const [config, setConfig] = useState<BackupConfig>(DEFAULT_BACKUP_CONFIG);
  const [snapshots, setSnapshots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [importPolicy, setImportPolicy] = useState<ImportPolicy>('skip');

  const refresh = useCallback(async (): Promise<void> => {
    const [c, snaps] = await Promise.all([getBackupConfig(), listAvailableBackups()]);
    setConfig(c);
    setSnapshots(snaps);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const updateConfig = async (next: BackupConfig): Promise<void> => {
    setConfig(next);
    await setBackupConfig(next);
  };

  const handleScheduleKindChange = async (kind: BackupConfig['schedule']['kind']): Promise<void> => {
    let schedule: BackupConfig['schedule'];
    if (kind === 'on_open') schedule = { kind: 'on_open' };
    else if (kind === 'every_n_hours') schedule = { kind: 'every_n_hours', intervalHours: 6 };
    else schedule = { kind: 'daily_at', hhmm: '03:00' };
    await updateConfig({ ...config, schedule });
  };

  const onBackupNow = async (): Promise<void> => {
    setBusy(true);
    try {
      await runBackupNow();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onRestore = async (timestamp: string): Promise<void> => {
    if (!window.confirm(`Restore from snapshot ${timestamp}? This overwrites the current databases.`)) return;
    setBusy(true);
    try {
      await restoreFromBackup(timestamp);
    } finally {
      setBusy(false);
    }
  };

  const onExport = async (): Promise<void> => {
    setBusy(true);
    try {
      const bundle = await exportWorkspace();
      downloadJsonBundle(bundle);
    } catch (err) {
      eventBus.emit('notification:show', {
        title: 'Export failed',
        body: err instanceof Error ? err.message : String(err),
        type: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const onImport = async (): Promise<void> => {
    const bundle = await pickJsonBundle();
    if (!bundle) return;
    setBusy(true);
    try {
      await importWorkspace(bundle, importPolicy);
    } catch (err) {
      eventBus.emit('notification:show', {
        title: 'Import failed',
        body: err instanceof Error ? err.message : String(err),
        type: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="max-w-2xl space-y-8">
      {/* Schedule */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Backup schedule</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Snapshots copy your profile + active workspace SQLite files into <code className="rounded bg-muted px-1 text-xs">$APPDATA/backups</code>.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-medium text-foreground">Automatic backups</p>
            <p className="text-xs text-muted-foreground">Disable to take snapshots manually only.</p>
          </div>
          <Switch
            checked={config.enabled}
            onCheckedChange={(v) => void updateConfig({ ...config, enabled: v })}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Frequency</label>
          <Select value={config.schedule.kind} onValueChange={(v) => void handleScheduleKindChange(v as BackupConfig['schedule']['kind'])}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="on_open">On app start</SelectItem>
              <SelectItem value="every_n_hours">Every N hours</SelectItem>
              <SelectItem value="daily_at">Daily at fixed time</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {config.schedule.kind === 'every_n_hours' && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Interval (hours)</label>
            <Input
              type="number"
              min={1}
              max={168}
              value={config.schedule.intervalHours}
              onChange={(e) => {
                const intervalHours = Math.max(1, Number(e.target.value) || 1);
                void updateConfig({ ...config, schedule: { kind: 'every_n_hours', intervalHours } });
              }}
            />
          </div>
        )}

        {config.schedule.kind === 'daily_at' && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Time of day</label>
            <Input
              type="time"
              value={config.schedule.hhmm}
              onChange={(e) => {
                void updateConfig({ ...config, schedule: { kind: 'daily_at', hhmm: e.target.value || '03:00' } });
              }}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Retention (snapshots to keep)</label>
          <Input
            type="number"
            min={0}
            max={500}
            value={config.retentionCount}
            onChange={(e) => {
              const retentionCount = Math.max(0, Number(e.target.value) || 0);
              void updateConfig({ ...config, retentionCount });
            }}
          />
          <p className="text-xs text-muted-foreground">Set to 0 to disable pruning.</p>
        </div>
      </div>

      <Separator />

      {/* Manual */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Manual</h3>
        <div className="flex gap-2">
          <Button onClick={() => void onBackupNow()} disabled={busy} variant="default">
            Backup now
          </Button>
          <Button onClick={() => void refresh()} disabled={busy} variant="outline">
            Refresh list
          </Button>
        </div>

        <div className="rounded-lg border border-border">
          <div className="border-b border-border bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
            Snapshots ({snapshots.length})
          </div>
          {snapshots.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">No snapshots yet.</p>
          ) : (
            <ul className="max-h-64 divide-y divide-border overflow-y-auto">
              {snapshots.map((ts) => (
                <li key={ts} className="flex items-center justify-between px-3 py-2 text-xs">
                  <span className="font-mono">{ts}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void onRestore(ts)}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Separator />

      {/* Export / Import */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Export &amp; Import</h3>
          <p className="text-xs text-muted-foreground">
            Export the active workspace as a JSON bundle (entities, aspects, relations, file metadata). Import to merge into the current workspace.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Import collision policy</label>
          <Select value={importPolicy} onValueChange={(v) => setImportPolicy(v as ImportPolicy)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="skip">Skip rows whose id already exists</SelectItem>
              <SelectItem value="overwrite">Overwrite existing rows</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2">
          <Button onClick={() => void onExport()} disabled={busy} variant="default">
            Export workspace
          </Button>
          <Button onClick={() => void onImport()} disabled={busy} variant="outline">
            Import workspace
          </Button>
        </div>
      </div>
    </section>
  );
}

// ── Phase M: share-link manager ──────────────────────────────────────────────

interface ShareLinkRow {
  id: string;
  parent_entity_id: string | null;
  profile_id: string;
  workspace_id: string;
  label: string;
  can_upload: number;
  can_submit: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

function ShareLinksPanel(): React.ReactElement {
  const syncUrl = useSyncStore((s) => s.syncUrl);
  const deviceToken = useSyncStore((s) => s.deviceToken);
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  const [links, setLinks] = useState<ShareLinkRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newWorkspaceId, setNewWorkspaceId] = useState<string>(activeWorkspaceId ?? '');
  const [newCanUpload, setNewCanUpload] = useState(false);
  const [newCanSubmit, setNewCanSubmit] = useState(false);
  const [newExpiryDays, setNewExpiryDays] = useState<string>('30');
  const [lastMintedToken, setLastMintedToken] = useState<string | null>(null);

  useEffect(() => {
    if (!newWorkspaceId && activeWorkspaceId) setNewWorkspaceId(activeWorkspaceId);
  }, [activeWorkspaceId, newWorkspaceId]);

  const reload = useCallback(async (): Promise<void> => {
    if (!syncUrl || !deviceToken) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${syncUrl.replace(/\/$/, '')}/share-links`, {
        headers: { Authorization: `Bearer ${deviceToken}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const j = (await res.json()) as { links: ShareLinkRow[] };
      setLinks(j.links);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [syncUrl, deviceToken]);

  useEffect(() => { void reload(); }, [reload]);

  const onCreate = async (): Promise<void> => {
    if (!syncUrl || !deviceToken || !activeProfileId || !newWorkspaceId) return;
    setCreating(true); setError(null); setLastMintedToken(null);
    try {
      const expiresInSec = newExpiryDays.trim()
        ? Math.max(60, Math.round(Number(newExpiryDays) * 86_400))
        : undefined;
      const res = await fetch(`${syncUrl.replace(/\/$/, '')}/share-links`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${deviceToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: activeProfileId,
          workspace_id: newWorkspaceId,
          label: newLabel.trim() || 'Untitled share',
          can_upload: newCanUpload,
          can_submit: newCanSubmit,
          expires_in_seconds: expiresInSec,
        }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      const j = (await res.json()) as { token: string };
      setLastMintedToken(j.token);
      setNewLabel('');
      void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const onRevoke = async (id: string): Promise<void> => {
    if (!syncUrl || !deviceToken) return;
    try {
      await fetch(`${syncUrl.replace(/\/$/, '')}/share-links/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${deviceToken}` },
      });
      void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const portalUrl = (token: string): string =>
    `${syncUrl.replace(/\/$/, '')}/portal/?token=${encodeURIComponent(token)}`;

  if (!deviceToken) {
    return (
      <section className="max-w-lg space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Share Links</h2>
        <p className="text-sm text-muted-foreground">
          Pair this device with the backend (Sync tab) to mint client-portal share links.
        </p>
      </section>
    );
  }

  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Share Links</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Mint a token-gated portal URL scoped to a single workspace. Recipients
          see read-only data unless you grant uploads or submissions. Zero CDN —
          all assets are served by your backend.
        </p>
      </div>

      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Label</label>
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Client preview — Acme Co."
            maxLength={120}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Workspace</label>
          <Select value={newWorkspaceId} onValueChange={setNewWorkspaceId}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a workspace…" />
            </SelectTrigger>
            <SelectContent>
              {workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Allow uploads</p>
            <p className="text-xs text-muted-foreground">Recipient can attach files.</p>
          </div>
          <Switch checked={newCanUpload} onCheckedChange={setNewCanUpload} />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Allow submissions</p>
            <p className="text-xs text-muted-foreground">Recipient can post a note back to you.</p>
          </div>
          <Switch checked={newCanSubmit} onCheckedChange={setNewCanSubmit} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Expires in (days)</label>
          <Input
            type="number"
            min={1}
            value={newExpiryDays}
            onChange={(e) => setNewExpiryDays(e.target.value)}
            placeholder="30"
          />
          <p className="text-xs text-muted-foreground">Leave blank for no expiry.</p>
        </div>
        <Button onClick={() => void onCreate()} disabled={creating || !newWorkspaceId}>
          {creating ? 'Creating…' : 'Mint share link'}
        </Button>
        {lastMintedToken && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3 text-xs">
            <p className="font-medium text-green-600 mb-1">Link minted — copy it now (it will not be shown again):</p>
            <code className="break-all text-foreground select-all">{portalUrl(lastMintedToken)}</code>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => { void navigator.clipboard.writeText(portalUrl(lastMintedToken)); }}
            >
              Copy URL
            </Button>
          </div>
        )}
        {error && <p className="text-sm font-medium text-red-500">{error}</p>}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Active share links</h3>
          <Button size="sm" variant="outline" onClick={() => void reload()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active share links.</p>
        ) : (
          <ul className="space-y-2">
            {links.map((l) => {
              const ws = workspaces.find((w) => w.id === l.workspace_id);
              return (
                <li key={l.id} className="rounded-lg border border-border p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{l.label || 'Untitled share'}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {ws?.name ?? l.workspace_id.slice(0, 8)}
                      {l.can_upload ? ' · uploads' : ''}
                      {l.can_submit ? ' · submit' : ''}
                      {l.expires_at ? ` · expires ${new Date(l.expires_at).toLocaleDateString()}` : ' · no expiry'}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => void onRevoke(l.id)}>Revoke</Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

// ── Phase N.1: AI settings panel ─────────────────────────────────────────────

function AISettingsPanel(): React.ReactElement {
  const [enabled, setEnabled] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [model, setModel] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'err'>('idle');
  const [testMsg, setTestMsg] = useState<string>('');

  useEffect(() => {
    void (async (): Promise<void> => {
      const s = await getAISettings();
      setEnabled(s.enabled);
      setEndpoint(s.endpoint);
      setModel(s.model);
      setLoaded(true);
    })();
  }, []);

  const onSave = async (): Promise<void> => {
    await saveAISettings({ enabled, endpoint: endpoint.trim(), model: model.trim() });
    setSavedAt(Date.now());
  };

  const onTest = async (): Promise<void> => {
    setTestStatus('testing'); setTestMsg('');
    try {
      await saveAISettings({ enabled: true, endpoint: endpoint.trim(), model: model.trim() });
      const reply = await ai.chat([
        { role: 'system', content: 'Reply with exactly: ok' },
        { role: 'user', content: 'ping' },
      ]);
      setTestStatus('ok');
      setTestMsg(`Model replied: "${reply.slice(0, 60)}"`);
    } catch (err) {
      setTestStatus('err');
      setTestMsg(err instanceof Error ? err.message : String(err));
    }
  };

  if (!loaded) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <section className="max-w-lg space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Local AI</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Optional integration with an OpenAI/Ollama-compatible chat endpoint.
          Off by default — your notes never leave the machine until you explicitly
          enable this and point it at an endpoint.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <div>
          <p className="text-sm font-medium text-foreground">Enable AI features</p>
          <p className="text-xs text-muted-foreground">Adds &ldquo;Summarize&rdquo; and similar actions.</p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Endpoint URL</label>
        <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="http://localhost:11434/v1/chat/completions" />
        <p className="text-xs text-muted-foreground">Default: local Ollama. Any OpenAI-compatible URL works.</p>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Model</label>
        <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="llama3.2" />
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={() => void onSave()}>Save</Button>
        <Button variant="outline" onClick={() => void onTest()} disabled={testStatus === 'testing'}>
          {testStatus === 'testing' ? 'Testing…' : 'Test connection'}
        </Button>
        {savedAt && <span className="text-xs text-muted-foreground">Saved.</span>}
      </div>
      {testStatus === 'ok' && <p className="text-sm font-medium text-green-500">{testMsg}</p>}
      {testStatus === 'err' && <p className="text-sm font-medium text-red-500">{testMsg}</p>}
    </section>
  );
}


// ── Phase S: AccountPanel ────────────────────────────────────────────────────
//
// Shown only when the active profile is in enterprise mode. Lets the user see
// the signed-in identity, change their password, sign out, or convert this
// profile to/from enterprise mode.

function AccountPanel(): React.ReactElement {
  const profiles = useProfileStore((s) => s.profiles);
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const updateProfile = useProfileStore((s) => s.updateProfile);
  const profile = profiles.find((p) => p.id === activeProfileId);
  const mode = profile?.mode ?? 'personal';

  const userEmail = useSyncStore((s) => s.userEmail);
  const userDisplayName = useSyncStore((s) => s.userDisplayName);
  const orgRole = useSyncStore((s) => s.orgRole);
  const userToken = useSyncStore((s) => s.userToken);
  const syncUrl = useSyncStore((s) => s.syncUrl);
  const clearUserSession = useSyncStore((s) => s.clearUserSession);

  const handleSignOut = (): void => {
    authLogout();
  };

  const handleConvertToEnterprise = (): void => {
    if (!profile) return;
    if (!window.confirm(
      'Convert this profile to Enterprise mode?\n\nYou will be prompted to sign in to a server. ' +
      'Local data stays on this device — sync becomes server-driven once signed in.',
    )) return;
    updateProfile(profile.id, { mode: 'enterprise' });
  };

  const handleConvertToPersonal = (): void => {
    if (!profile) return;
    if (!window.confirm(
      'Switch this profile back to Personal mode?\n\nThis signs you out of the server. ' +
      'Local data is kept; sync via device pairing remains available.',
    )) return;
    clearUserSession();
    updateProfile(profile.id, { mode: 'personal' });
  };

  return (
    <section className="max-w-lg space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage the user identity used by sync for this profile.
        </p>
      </div>

      <div className="rounded-lg border border-border p-3 space-y-1">
        <p className="text-sm font-medium text-foreground">Profile mode</p>
        <p className="text-xs text-muted-foreground">
          {mode === 'enterprise'
            ? 'Enterprise — signed in to a SyncroLWS server.'
            : 'Personal — offline-first; pair a device to sync with your own backend.'}
        </p>
        <div className="pt-2">
          {mode === 'personal' ? (
            <Button size="sm" variant="outline" onClick={handleConvertToEnterprise}>
              Convert to Enterprise
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={handleConvertToPersonal}>
              Switch to Personal
            </Button>
          )}
        </div>
      </div>

      {mode === 'enterprise' && (
        <>
          <div className="rounded-lg border border-border p-3 space-y-1">
            <p className="text-sm font-medium text-foreground">Signed in as</p>
            {userToken ? (
              <>
                <p className="text-sm text-foreground">
                  {userDisplayName || userEmail || '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {userEmail} · {orgRole || 'member'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Server: <span className="font-mono">{syncUrl}</span>
                </p>
                <div className="pt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => eventBus.emit('settings:open-tab', 'change-password')}
                  >
                    Change password
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleSignOut}>
                    Sign out
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Not signed in. The sign-in dialog opens automatically when this
                profile is active.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// ── Phase T: SecurityPanel ──────────────────────────────────────────────────
//
// Manages the app-level lock password (PBKDF2 hash in localStorage). The
// password gates the entire app; it is independent of profile/user identity.

function SecurityPanel(): React.ReactElement {
  const enabled = useAppLockStore((s) => s.enabled);
  const idleMinutes = useAppLockStore((s) => s.idleMinutes);
  const enable = useAppLockStore((s) => s.enable);
  const disable = useAppLockStore((s) => s.disable);
  const changeLockPw = useAppLockStore((s) => s.changePassword);
  const setIdleMinutes = useAppLockStore((s) => s.setIdleMinutes);
  const lockNow = useAppLockStore((s) => s.lockNow);

  // Enable form
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [enableIdle, setEnableIdle] = useState(15);

  // Change form
  const [curPw, setCurPw] = useState('');
  const [changeNewPw, setChangeNewPw] = useState('');
  const [changeConfirm, setChangeConfirm] = useState('');

  // Disable form
  const [disablePw, setDisablePw] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const flash = (kind: 'info' | 'error', msg: string): void => {
    setError(kind === 'error' ? msg : null);
    setInfo(kind === 'info' ? msg : null);
    setTimeout(() => { setError(null); setInfo(null); }, 4000);
  };

  const handleEnable = async (): Promise<void> => {
    setBusy(true);
    try {
      if (newPw !== confirmPw) throw new Error('Passwords do not match.');
      await enable(newPw, enableIdle);
      setNewPw(''); setConfirmPw('');
      flash('info', 'App lock enabled.');
    } catch (e) {
      flash('error', e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const handleChange = async (): Promise<void> => {
    setBusy(true);
    try {
      if (changeNewPw !== changeConfirm) throw new Error('New passwords do not match.');
      await changeLockPw(curPw, changeNewPw);
      setCurPw(''); setChangeNewPw(''); setChangeConfirm('');
      flash('info', 'App password changed.');
    } catch (e) {
      flash('error', e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const handleDisable = async (): Promise<void> => {
    setBusy(true);
    try {
      await disable(disablePw);
      setDisablePw('');
      flash('info', 'App lock disabled.');
    } catch (e) {
      flash('error', e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <section className="max-w-lg space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">App lock</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Require a password to open SyncroLWS on this device. The password is
          stored as a PBKDF2-SHA256 hash in local storage and never leaves
          this machine.
        </p>
      </div>

      {error && <p className="text-sm font-medium text-red-500">{error}</p>}
      {info && <p className="text-sm font-medium text-green-500">{info}</p>}

      {!enabled ? (
        <div className="rounded-lg border border-border p-3 space-y-3">
          <p className="text-sm font-medium text-foreground">Enable app lock</p>
          <div className="space-y-1.5">
            <label className="text-sm text-foreground">New password</label>
            <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            <p className="text-xs text-muted-foreground">At least 6 characters.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm text-foreground">Confirm password</label>
            <Input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm text-foreground">Idle lock (minutes, 0 = never)</label>
            <Input
              type="number"
              min={0}
              max={1440}
              value={enableIdle}
              onChange={(e) => setEnableIdle(Math.max(0, Math.min(1440, Number(e.target.value) || 0)))}
            />
          </div>
          <Button onClick={() => void handleEnable()} disabled={busy || !newPw}>
            Enable app lock
          </Button>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-border p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">App lock is enabled</p>
                <p className="text-xs text-muted-foreground">
                  Auto-lock after {idleMinutes === 0 ? 'never' : `${idleMinutes} min`} of inactivity.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={lockNow}>Lock now</Button>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-foreground">Idle lock (minutes, 0 = never)</label>
              <Input
                type="number"
                min={0}
                max={1440}
                value={idleMinutes}
                onChange={(e) => setIdleMinutes(Math.max(0, Math.min(1440, Number(e.target.value) || 0)))}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border p-3 space-y-3">
            <p className="text-sm font-medium text-foreground">Change app password</p>
            <div className="space-y-1.5">
              <label className="text-sm text-foreground">Current password</label>
              <Input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-foreground">New password</label>
              <Input type="password" value={changeNewPw} onChange={(e) => setChangeNewPw(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-foreground">Confirm new password</label>
              <Input type="password" value={changeConfirm} onChange={(e) => setChangeConfirm(e.target.value)} />
            </div>
            <Button
              onClick={() => void handleChange()}
              disabled={busy || !curPw || !changeNewPw || !changeConfirm}
            >
              Change password
            </Button>
          </div>

          <div className="rounded-lg border border-destructive/30 p-3 space-y-3">
            <p className="text-sm font-medium text-foreground">Disable app lock</p>
            <p className="text-xs text-muted-foreground">
              Removes the password requirement entirely. Anyone with access to this
              device will be able to open the app.
            </p>
            <div className="space-y-1.5">
              <label className="text-sm text-foreground">Current password</label>
              <Input type="password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} />
            </div>
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => void handleDisable()}
              disabled={busy || !disablePw}
            >
              Disable app lock
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

// ── Phase S: AccountPanel ────────────────────────────────────────────────────
//
// Shown only when the active profile is in enterprise mode. Lets the user see
// the signed-in identity, change their password, sign out, or convert this
// profile to/from enterprise mode.

function AccountPanel(): React.ReactElement {
  const profiles = useProfileStore((s) => s.profiles);
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const updateProfile = useProfileStore((s) => s.updateProfile);
  const profile = profiles.find((p) => p.id === activeProfileId);
  const mode = profile?.mode ?? 'personal';

  const userEmail = useSyncStore((s) => s.userEmail);
  const userDisplayName = useSyncStore((s) => s.userDisplayName);
  const orgRole = useSyncStore((s) => s.orgRole);
  const userToken = useSyncStore((s) => s.userToken);
  const syncUrl = useSyncStore((s) => s.syncUrl);
  const clearUserSession = useSyncStore((s) => s.clearUserSession);

  const handleSignOut = (): void => {
    authLogout();
  };

  const handleConvertToEnterprise = (): void => {
    if (!profile) return;
    if (!window.confirm(
      'Convert this profile to Enterprise mode?\n\nYou will be prompted to sign in to a server. ' +
      'Local data stays on this device — sync becomes server-driven once signed in.',
    )) return;
    updateProfile(profile.id, { mode: 'enterprise' });
  };

  const handleConvertToPersonal = (): void => {
    if (!profile) return;
    if (!window.confirm(
      'Switch this profile back to Personal mode?\n\nThis signs you out of the server. ' +
      'Local data is kept; sync via device pairing remains available.',
    )) return;
    clearUserSession();
    updateProfile(profile.id, { mode: 'personal' });
  };

  return (
    <section className="max-w-lg space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage the user identity used by sync for this profile.
        </p>
      </div>

      <div className="rounded-lg border border-border p-3 space-y-1">
        <p className="text-sm font-medium text-foreground">Profile mode</p>
        <p className="text-xs text-muted-foreground">
          {mode === 'enterprise'
            ? 'Enterprise — signed in to a SyncroLWS server.'
            : 'Personal — offline-first; pair a device to sync with your own backend.'}
        </p>
        <div className="pt-2">
          {mode === 'personal' ? (
            <Button size="sm" variant="outline" onClick={handleConvertToEnterprise}>
              Convert to Enterprise
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={handleConvertToPersonal}>
              Switch to Personal
            </Button>
          )}
        </div>
      </div>

      {mode === 'enterprise' && (
        <>
          <div className="rounded-lg border border-border p-3 space-y-1">
            <p className="text-sm font-medium text-foreground">Signed in as</p>
            {userToken ? (
              <>
                <p className="text-sm text-foreground">
                  {userDisplayName || userEmail || '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {userEmail} · {orgRole || 'member'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Server: <span className="font-mono">{syncUrl}</span>
                </p>
                <div className="pt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => eventBus.emit('settings:open-tab', 'change-password')}
                  >
                    Change password
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleSignOut}>
                    Sign out
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Not signed in. The sign-in dialog opens automatically when this
                profile is active.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// ── Phase T: SecurityPanel ──────────────────────────────────────────────────
//
// Manages the app-level lock password (PBKDF2 hash in localStorage). The
// password gates the entire app; it is independent of profile/user identity.

function SecurityPanel(): React.ReactElement {
  const enabled = useAppLockStore((s) => s.enabled);
  const idleMinutes = useAppLockStore((s) => s.idleMinutes);
  const enable = useAppLockStore((s) => s.enable);
  const disable = useAppLockStore((s) => s.disable);
  const changeLockPw = useAppLockStore((s) => s.changePassword);
  const setIdleMinutes = useAppLockStore((s) => s.setIdleMinutes);
  const lockNow = useAppLockStore((s) => s.lockNow);

  // Enable form
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [enableIdle, setEnableIdle] = useState(15);

  // Change form
  const [curPw, setCurPw] = useState('');
  const [changeNewPw, setChangeNewPw] = useState('');
  const [changeConfirm, setChangeConfirm] = useState('');

  // Disable form
  const [disablePw, setDisablePw] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const flash = (kind: 'info' | 'error', msg: string): void => {
    setError(kind === 'error' ? msg : null);
    setInfo(kind === 'info' ? msg : null);
    setTimeout(() => { setError(null); setInfo(null); }, 4000);
  };

  const handleEnable = async (): Promise<void> => {
    setBusy(true);
    try {
      if (newPw !== confirmPw) throw new Error('Passwords do not match.');
      await enable(newPw, enableIdle);
      setNewPw(''); setConfirmPw('');
      flash('info', 'App lock enabled.');
    } catch (e) {
      flash('error', e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const handleChange = async (): Promise<void> => {
    setBusy(true);
    try {
      if (changeNewPw !== changeConfirm) throw new Error('New passwords do not match.');
      await changeLockPw(curPw, changeNewPw);
      setCurPw(''); setChangeNewPw(''); setChangeConfirm('');
      flash('info', 'App password changed.');
    } catch (e) {
      flash('error', e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const handleDisable = async (): Promise<void> => {
    setBusy(true);
    try {
      await disable(disablePw);
      setDisablePw('');
      flash('info', 'App lock disabled.');
    } catch (e) {
      flash('error', e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <section className="max-w-lg space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">App lock</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Require a password to open SyncroLWS on this device. The password is
          stored as a PBKDF2-SHA256 hash in local storage and never leaves
          this machine.
        </p>
      </div>

      {error && <p className="text-sm font-medium text-red-500">{error}</p>}
      {info && <p className="text-sm font-medium text-green-500">{info}</p>}

      {!enabled ? (
        <div className="rounded-lg border border-border p-3 space-y-3">
          <p className="text-sm font-medium text-foreground">Enable app lock</p>
          <div className="space-y-1.5">
            <label className="text-sm text-foreground">New password</label>
            <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            <p className="text-xs text-muted-foreground">At least 6 characters.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm text-foreground">Confirm password</label>
            <Input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm text-foreground">Idle lock (minutes, 0 = never)</label>
            <Input
              type="number"
              min={0}
              max={1440}
              value={enableIdle}
              onChange={(e) => setEnableIdle(Math.max(0, Math.min(1440, Number(e.target.value) || 0)))}
            />
          </div>
          <Button onClick={() => void handleEnable()} disabled={busy || !newPw}>
            Enable app lock
          </Button>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-border p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">App lock is enabled</p>
                <p className="text-xs text-muted-foreground">
                  Auto-lock after {idleMinutes === 0 ? 'never' : `${idleMinutes} min`} of inactivity.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={lockNow}>Lock now</Button>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-foreground">Idle lock (minutes, 0 = never)</label>
              <Input
                type="number"
                min={0}
                max={1440}
                value={idleMinutes}
                onChange={(e) => setIdleMinutes(Math.max(0, Math.min(1440, Number(e.target.value) || 0)))}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border p-3 space-y-3">
            <p className="text-sm font-medium text-foreground">Change app password</p>
            <div className="space-y-1.5">
              <label className="text-sm text-foreground">Current password</label>
              <Input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-foreground">New password</label>
              <Input type="password" value={changeNewPw} onChange={(e) => setChangeNewPw(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-foreground">Confirm new password</label>
              <Input type="password" value={changeConfirm} onChange={(e) => setChangeConfirm(e.target.value)} />
            </div>
            <Button
              onClick={() => void handleChange()}
              disabled={busy || !curPw || !changeNewPw || !changeConfirm}
            >
              Change password
            </Button>
          </div>

          <div className="rounded-lg border border-destructive/30 p-3 space-y-3">
            <p className="text-sm font-medium text-foreground">Disable app lock</p>
            <p className="text-xs text-muted-foreground">
              Removes the password requirement entirely. Anyone with access to this
              device will be able to open the app.
            </p>
            <div className="space-y-1.5">
              <label className="text-sm text-foreground">Current password</label>
              <Input type="password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} />
            </div>
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => void handleDisable()}
              disabled={busy || !disablePw}
            >
              Disable app lock
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
