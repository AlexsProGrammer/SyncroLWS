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
  const apiKey = useSyncStore((s) => s.apiKey);
  const isSyncActive = useSyncStore((s) => s.isSyncActive);
  const setSyncUrl = useSyncStore((s) => s.setSyncUrl);
  const setApiKey = useSyncStore((s) => s.setApiKey);
  const setIsSyncActive = useSyncStore((s) => s.setIsSyncActive);

  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');

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
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
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
  }, [syncUrl, apiKey]);

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
            <TabsTrigger value="sync" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              Sync
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

            {/* API Key */}
            <div className="space-y-1.5">
              <label htmlFor="sync-api-key" className="text-sm font-medium text-foreground">
                API Key
              </label>
              <Input
                id="sync-api-key"
                type="password"
                placeholder="Enter your API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
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
          </section>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
