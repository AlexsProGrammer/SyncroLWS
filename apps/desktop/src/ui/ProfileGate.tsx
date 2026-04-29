/**
 * ProfileGate — full-screen authentication gate that appears on every
 * application launch (gatePassed === false) before the main UI.
 *
 * Auth matrix per profile:
 *   personal + no localPw        → tap to enter directly
 *   personal + localPw           → local password form
 *   enterprise + valid token      → "Continue as <email>" one-click
 *   enterprise + no token + hash  → email display + password form (offline verify)
 *   enterprise + no token + none  → full login form (serverUrl + email + pw)
 */
import React, { useState, useCallback, useRef } from 'react';
import { useProfileStore, type Profile } from '@/store/profileStore';
import { useSyncStore } from '@/store/syncStore';
import { Button } from '@/ui/components/button';
import { Input } from '@/ui/components/input';
import {
  loginAndCacheHash,
  verifyForStorage,
  hashForStorage,
} from '@/core/auth';

// ── helpers ──────────────────────────────────────────────────────────────────

function isTokenValid(expiresAt: string | null): boolean {
  if (!expiresAt) return false; // treat missing expiry as expired (safe default)
  const exp = Date.parse(expiresAt);
  if (Number.isNaN(exp)) return false;
  return Date.now() < exp - 30_000; // 30 s buffer
}

const PALETTE = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#06b6d4',
];

// ── sub-component: profile avatar card ───────────────────────────────────────

interface ProfileCardProps {
  profile: Profile;
  selected: boolean;
  onClick: () => void;
}

function ProfileCard({ profile, selected, onClick }: ProfileCardProps): React.ReactElement {
  const color = profile.color ?? '#6366f1';
  return (
    <button
      onClick={onClick}
      className={[
        'flex flex-col items-center gap-2 rounded-xl border p-4 transition-all',
        'cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2',
        'focus-visible:ring-ring focus-visible:ring-offset-2',
        selected
          ? 'border-primary bg-primary/10 shadow-md'
          : 'border-border bg-card hover:border-primary/40 hover:bg-accent',
      ].join(' ')}
    >
      <span
        className="flex h-12 w-12 items-center justify-center rounded-full text-xl font-bold text-white shadow"
        style={{ backgroundColor: color }}
      >
        {profile.name[0]?.toUpperCase()}
      </span>
      <span className="max-w-[80px] truncate text-sm font-medium text-foreground">
        {profile.name}
      </span>
      <span
        className={[
          'rounded-full px-2 py-0.5 text-[10px] font-medium',
          profile.mode === 'enterprise'
            ? 'bg-blue-500/15 text-blue-500'
            : 'bg-muted text-muted-foreground',
        ].join(' ')}
      >
        {profile.mode === 'enterprise' ? 'Enterprise' : 'Personal'}
      </span>
    </button>
  );
}

// ── sub-component: "Add profile" inline form ─────────────────────────────────

interface AddProfileFormProps {
  onCreated: (id: string) => void;
  onCancel: () => void;
}

function AddProfileForm({ onCreated, onCancel }: AddProfileFormProps): React.ReactElement {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[0]!);
  const [mode, setMode] = useState<'personal' | 'enterprise'>('personal');
  const [serverUrl, setServerUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const { createProfile } = useProfileStore.getState();

  const handleSubmit = async (): Promise<void> => {
    if (!name.trim()) { setError('Profile name is required.'); return; }
    if (mode === 'enterprise') {
      if (!serverUrl.trim()) { setError('Server URL is required.'); return; }
      if (!email.trim()) { setError('Email is required.'); return; }
      if (!password) { setError('Password is required.'); return; }
    }
    setError('');
    setBusy(true);
    try {
      const profile = await createProfile(name.trim(), color, mode);
      if (mode === 'enterprise') {
        await loginAndCacheHash(serverUrl.trim(), email.trim(), password, profile.id);
      }
      onCreated(profile.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <h3 className="text-base font-semibold text-foreground">New profile</h3>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="pg-new-name">Name</label>
        <Input
          id="pg-new-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Profile"
          autoFocus
        />
      </div>

      {/* Color picker */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">Colour</label>
        <div className="flex gap-2 flex-wrap">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={[
                'h-7 w-7 rounded-full transition-transform',
                color === c ? 'ring-2 ring-offset-2 ring-primary scale-110' : '',
              ].join(' ')}
              style={{ backgroundColor: c }}
              aria-label={c}
            />
          ))}
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">Mode</label>
        <div className="flex gap-2">
          {(['personal', 'enterprise'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={[
                'rounded-md border px-3 py-1.5 text-sm font-medium capitalize transition-colors',
                mode === m
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-foreground hover:bg-accent',
              ].join(' ')}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Enterprise fields */}
      {mode === 'enterprise' && (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pg-new-url">Server URL</label>
            <Input
              id="pg-new-url"
              type="url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="https://sync.example.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pg-new-email">Email</label>
            <Input
              id="pg-new-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pg-new-pw">Password</label>
            <Input
              id="pg-new-pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button onClick={handleSubmit} disabled={busy} className="flex-1">
          {busy ? 'Creating…' : 'Create profile'}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── sub-component: per-profile auth panel ────────────────────────────────────

interface AuthPanelProps {
  profile: Profile;
  onSuccess: () => void;
  onBack: () => void;
}

type AuthState =
  | 'continue'          // enterprise + valid token
  | 'offline-pw'        // enterprise + no token + cached hash
  | 'full-login'        // enterprise + no token + no cache
  | 'local-pw'          // personal + localPwHash set
  | 'direct';           // personal + no localPwHash

function resolveAuthState(profile: Profile, syncState: ReturnType<typeof useSyncStore.getState>): AuthState {
  if (profile.mode === 'enterprise') {
    // "Require enterprise password at login" → always ask for password, even
    // when a valid token is cached. Gives an extra factor every launch.
    if (
      profile.useEnterprisePwAtLogin &&
      profile.enterprisePwHash &&
      profile.enterprisePwSalt
    ) return 'offline-pw';
    if (syncState.userToken && isTokenValid(syncState.tokenExpiresAt)) return 'continue';
    if (profile.enterprisePwHash && profile.enterprisePwSalt) return 'offline-pw';
    return 'full-login';
  }
  // Personal profiles: no local pw UI — always direct.
  return 'direct';
}

function AuthPanel({ profile, onSuccess, onBack }: AuthPanelProps): React.ReactElement {
  const { loadProfileConfig } = useSyncStore.getState();
  const syncState = useSyncStore.getState();

  // Load this profile's sync config to get the right token state
  React.useEffect(() => {
    loadProfileConfig(profile.id);
  }, [profile.id, loadProfileConfig]);

  // Re-read sync state after config load
  const [syncSnap, setSyncSnap] = useState(() => useSyncStore.getState());
  React.useEffect(() => {
    // Re-snapshot once the config has been loaded
    setSyncSnap(useSyncStore.getState());
    return useSyncStore.subscribe((s) => setSyncSnap(s));
  }, [profile.id]);

  const authState = resolveAuthState(profile, syncSnap);

  const { setActiveProfile, setGatePassed } = useProfileStore.getState();
  const [password, setPassword] = useState('');
  const [serverUrl, setServerUrl] = useState(() => syncSnap.syncUrl || '');
  const [email, setEmail] = useState(() => syncSnap.userEmail || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const finishAuth = useCallback(async () => {
    // setActiveProfile handles loadProfileDB + loadProfileConfig + workspaces
    await setActiveProfile(profile.id);
    setGatePassed(true);
    onSuccess();
  }, [profile.id, setActiveProfile, setGatePassed, onSuccess]);

  const handleDirect = useCallback(async () => {
    setBusy(true);
    try { await finishAuth(); } catch { setBusy(false); }
  }, [finishAuth]);

  const handleContinue = useCallback(async () => {
    setBusy(true);
    try { await finishAuth(); } catch { setBusy(false); }
  }, [finishAuth]);

  const handleLocalPw = useCallback(async () => {
    if (!profile.localPwHash || !profile.localPwSalt) return;
    setBusy(true);
    setError('');
    try {
      const ok = await verifyForStorage(password, profile.localPwHash, profile.localPwSalt);
      if (!ok) {
        setAttempts((a) => a + 1);
        setError('Incorrect password.');
        setPassword('');
        return;
      }
      await finishAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [profile, password, finishAuth]);

  const handleOfflinePw = useCallback(async () => {
    if (!profile.enterprisePwHash || !profile.enterprisePwSalt) return;
    setBusy(true);
    setError('');
    try {
      const ok = await verifyForStorage(password, profile.enterprisePwHash, profile.enterprisePwSalt);
      if (!ok) {
        setAttempts((a) => a + 1);
        setError('Incorrect password. If the server is reachable, you can sign in online instead.');
        setPassword('');
        return;
      }
      // Local verify passed — mark gate passed without server round-trip.
      // The sync engine will attempt a token refresh in the background.
      await finishAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [profile, password, finishAuth]);

  const handleFullLogin = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await loginAndCacheHash(serverUrl.trim(), email.trim(), password, profile.id);
      await finishAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [serverUrl, email, password, profile.id, finishAuth]);

  const color = profile.color ?? '#6366f1';

  return (
    <div className="flex w-full max-w-sm flex-col gap-5">
      {/* Profile header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Back"
        >
          ←
        </button>
        <span
          className="flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {profile.name[0]?.toUpperCase()}
        </span>
        <div>
          <p className="text-sm font-semibold text-foreground">{profile.name}</p>
          <p className="text-xs text-muted-foreground capitalize">
            {profile.mode ?? 'personal'} profile
          </p>
        </div>
      </div>

      {/* Auth form */}
      {authState === 'direct' && (
        <Button onClick={handleDirect} disabled={busy} className="w-full">
          {busy ? 'Opening…' : 'Enter profile'}
        </Button>
      )}

      {authState === 'continue' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{syncSnap.userEmail}</span>
          </p>
          <Button onClick={handleContinue} disabled={busy} className="w-full">
            {busy ? 'Loading…' : `Continue as ${syncSnap.userDisplayName || syncSnap.userEmail}`}
          </Button>
          <button
            onClick={() => {
              // Switch to full-login by clearing cached token indicator
              // (don't actually clear — just show login form)
              setSyncSnap((s) => ({ ...s, userToken: '' }));
            }}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Switch account
          </button>
        </div>
      )}

      {(authState === 'local-pw' || authState === 'offline-pw') && (
        <div className="flex flex-col gap-3">
          {authState === 'offline-pw' && (
            <p className="text-xs text-muted-foreground">
              Enter your enterprise password to verify offline.
              {syncSnap.userEmail && (
                <> Signed in as <span className="font-medium text-foreground">{syncSnap.userEmail}</span>.</>
              )}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pg-auth-pw">
              {authState === 'offline-pw' ? 'Enterprise password' : 'Profile password'}
            </label>
            <Input
              ref={inputRef}
              id="pg-auth-pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void (authState === 'offline-pw' ? handleOfflinePw() : handleLocalPw());
                }
              }}
              disabled={busy}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button
            onClick={authState === 'offline-pw' ? handleOfflinePw : handleLocalPw}
            disabled={busy || !password}
            className="w-full"
          >
            {busy ? 'Verifying…' : 'Unlock'}
          </Button>
          {/* Offer full online login if server available (enterprise offline-pw only) */}
          {authState === 'offline-pw' && attempts >= 1 && (
            <button
              onClick={() => setSyncSnap((s) => ({ ...s, userToken: '', enterprisePwHash: undefined as unknown as string }))}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Sign in online instead
            </button>
          )}
        </div>
      )}

      {authState === 'full-login' && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Enter your enterprise credentials to sign in.
          </p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pg-fl-url">Server URL</label>
            <Input
              id="pg-fl-url"
              type="url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="https://sync.example.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pg-fl-email">Email</label>
            <Input
              id="pg-fl-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pg-fl-pw">Password</label>
            <Input
              ref={inputRef}
              id="pg-fl-pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleFullLogin(); }}
              disabled={busy}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button
            onClick={handleFullLogin}
            disabled={busy || !serverUrl || !email || !password}
            className="w-full"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export function ProfileGate(): React.ReactElement {
  const profiles = useProfileStore((s) => s.profiles);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const selectedProfile = profiles.find((p) => p.id === selected) ?? null;

  const handleSuccess = useCallback(() => {
    // gatePassed was set inside AuthPanel — nothing else needed
  }, []);

  const handleProfileCreated = useCallback((id: string) => {
    setAdding(false);
    // After creating an enterprise profile, loginAndCacheHash already called
    // setActiveProfile via createProfile. Gate was set inside finishAuth.
    // For personal profiles we need to open the auth panel.
    const profile = useProfileStore.getState().profiles.find((p) => p.id === id);
    if (profile?.mode !== 'enterprise') {
      setSelected(id);
    }
    // enterprise: finishAuth already ran inside AddProfileForm → gate passed
  }, []);

  // Auto-select when only one personal profile (no password gate — direct entry).
  React.useEffect(() => {
    if (profiles.length === 1 && !selected && !adding) {
      const p = profiles[0]!;
      if (p.mode !== 'enterprise') {
        setSelected(p.id);
      }
    }
  }, [profiles, selected, adding]);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="flex w-full max-w-xl flex-col items-center gap-8 p-8">
        {/* Logo / title */}
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">SyncroLWS</h1>
          <p className="text-sm text-muted-foreground">
            {profiles.length === 0
              ? 'Create a profile to get started.'
              : selected
                ? 'Authenticate to continue.'
                : 'Select a profile to continue.'}
          </p>
        </div>

        {/* Add-profile form */}
        {adding && (
          <AddProfileForm
            onCreated={handleProfileCreated}
            onCancel={() => setAdding(false)}
          />
        )}

        {/* Auth panel for selected profile */}
        {!adding && selected && selectedProfile && (
          <AuthPanel
            profile={selectedProfile}
            onSuccess={handleSuccess}
            onBack={() => setSelected(null)}
          />
        )}

        {/* Profile grid + add button */}
        {!adding && !selected && (
          <div className="flex flex-col items-center gap-6 w-full">
            <div className="flex flex-wrap justify-center gap-4">
              {profiles.map((p) => (
                <ProfileCard
                  key={p.id}
                  profile={p}
                  selected={false}
                  onClick={() => setSelected(p.id)}
                />
              ))}
              {/* Add profile card */}
              <button
                onClick={() => setAdding(true)}
                className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-4 transition-colors hover:border-primary/40 hover:bg-accent cursor-pointer"
                style={{ minWidth: 100 }}
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/40 text-2xl text-muted-foreground">
                  +
                </span>
                <span className="text-sm text-muted-foreground">Add profile</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
