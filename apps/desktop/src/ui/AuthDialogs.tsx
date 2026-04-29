/**
 * Phase S — Enterprise login + forced password-change dialogs.
 *
 * EnterpriseLoginDialog: shown for an enterprise-mode profile when the
 * user is not signed in. Asks for server URL (only on first sign-in,
 * read-only afterwards), email, password.
 *
 * ChangePasswordDialog: shown automatically when the server reports
 * `must_change_password`. Cannot be dismissed without a successful
 * change (the close button is hidden in that mode).
 */
import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/components/dialog';
import { Input } from '@/ui/components/input';
import { Button } from '@/ui/components/button';
import { useSyncStore } from '@/store/syncStore';
import { useProfileStore } from '@/store/profileStore';
import { login, changePassword, logout } from '@/core/auth';

// ── EnterpriseLoginDialog ────────────────────────────────────────────────────

interface EnterpriseLoginDialogProps {
  open: boolean;
  onClose: () => void;
}

export function EnterpriseLoginDialog({ open, onClose }: EnterpriseLoginDialogProps): React.ReactElement {
  const syncUrl = useSyncStore((s) => s.syncUrl);
  // NOTE: setSyncUrl removed — login() calls setUserSession({ serverUrl }) which sets it atomically.

  const [serverUrl, setServerUrl] = useState(syncUrl || 'http://localhost:3000');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset fields only when the dialog opens — not on every syncUrl store change
  // (which would clear email/password mid-request).
  useEffect(() => {
    if (open) {
      setServerUrl(useSyncStore.getState().syncUrl || 'http://localhost:3000');
      setEmail('');
      setPassword('');
      setError(null);
    }
  }, [open]);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const url = serverUrl.replace(/\/+$/, '');
      await login(url, email.trim(), password);
      setPassword('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Sign in to SyncroLWS</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3 mt-2"
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
        >
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Server URL</label>
            <Input
              type="url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="https://syncro.example.com"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Email</label>
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Password</label>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm font-medium text-red-500">{error}</p>}
          <Button
            type="submit"
            className="w-full"
            disabled={busy || !serverUrl || !email || !password}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── ChangePasswordDialog ─────────────────────────────────────────────────────

interface ChangePasswordDialogProps {
  open: boolean;
  /** When true, the dialog cannot be closed without a successful change. */
  forced: boolean;
  onClose: () => void;
}

export function ChangePasswordDialog({ open, forced, onClose }: ChangePasswordDialogProps): React.ReactElement {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError(null);
    }
  }, [open]);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (newPassword !== confirmPassword) {
        throw new Error('New passwords do not match.');
      }
      await changePassword(currentPassword, newPassword);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password change failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // Block dismiss when forced.
        if (forced) return;
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {forced ? 'Set a new password' : 'Change password'}
          </DialogTitle>
        </DialogHeader>
        {forced && (
          <p className="text-xs text-muted-foreground -mt-2 mb-1">
            Your administrator requires a password change before you can use the app.
          </p>
        )}
        <form
          className="space-y-3 mt-2"
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
        >
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Current password</label>
            <Input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">New password</label>
            <Input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">At least 8 characters.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Confirm new password</label>
            <Input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm font-medium text-red-500">{error}</p>}
          <Button
            type="submit"
            className="w-full"
            disabled={busy || !currentPassword || !newPassword || !confirmPassword}
          >
            {busy ? 'Updating…' : forced ? 'Set password' : 'Change password'}
          </Button>
          {forced && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => { logout(); onClose(); }}
            >
              Sign out
            </Button>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── FirstRunSetupDialog (mode picker) ────────────────────────────────────────
//
// Shown on the very first launch when no profiles exist. Lets the user pick
// Personal (offline-first, no server) or Enterprise (sign in to a backend).
// In personal mode we just create a "Default" profile. In enterprise mode
// we create the profile and immediately open EnterpriseLoginDialog.

interface FirstRunSetupDialogProps {
  open: boolean;
  onComplete: () => void;
}

export function FirstRunSetupDialog({ open, onComplete }: FirstRunSetupDialogProps): React.ReactElement {
  const createProfile = useProfileStore((s) => s.createProfile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'pick' | 'login'>('pick');

  const handlePersonal = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await createProfile('Default', '#6366f1', 'personal');
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create profile.');
    } finally {
      setBusy(false);
    }
  };

  const handleEnterprise = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await createProfile('Default', '#6366f1', 'enterprise');
      setPhase('login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create profile.');
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'login') {
    return <EnterpriseLoginDialog open={open} onClose={onComplete} />;
  }

  return (
    <Dialog open={open} onOpenChange={() => { /* must complete */ }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Welcome to SyncroLWS</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground mt-1">
          Choose how you want to use SyncroLWS. You can switch later from the
          Profiles settings.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handlePersonal()}
            className="rounded-lg border border-border p-4 text-left transition hover:border-primary hover:bg-primary/5 disabled:opacity-50"
          >
            <p className="text-sm font-semibold text-foreground">Personal</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Offline-first. All data stays on this device. You can pair with
              your own backend later for sync.
            </p>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleEnterprise()}
            className="rounded-lg border border-border p-4 text-left transition hover:border-primary hover:bg-primary/5 disabled:opacity-50"
          >
            <p className="text-sm font-semibold text-foreground">Enterprise</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Sign in to your organization&apos;s SyncroLWS server. Workspaces
              and shared folders sync across all your devices.
            </p>
          </button>
        </div>
        {error && <p className="mt-3 text-sm font-medium text-red-500">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
